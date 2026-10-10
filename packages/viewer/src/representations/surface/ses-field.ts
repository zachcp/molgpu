// The solvent-excluded-surface scalar field on the GPU: a WGSL port of Mol*
// 5.11's calcMolecularSurface (mol-math/geometry/molecular-surface.js,
// MIT-licensed; field method by Fred Ludlow after AstexViewer, from NGL).
// It reads packed GPU coordinates, so a moving structure never round-trips
// its atoms through the CPU; only a 32-byte bounds summary and the torus
// probe count are read back. The CPU field from @molgpu/io stays the
// reference and the static path.
//
// Mol*'s two passes are both minima, so they port as order-independent
// gathers and atomics:
// 1. points: every grid sample inside some atom's probe-inflated sphere is
//    "visited" (+1001, else -1001); its value is the least (r − d) over atoms
//    whose projection of the sample onto their sphere no other sphere hides.
// 2. torii: for every overlapping atom pair, `probePositions` points on the
//    circle where their spheres meet; each point no third sphere hides lowers
//    the visited samples in Mol*'s index box around it to their distance.
// Raw WebGPU, not use.gpu Kernel: one build is a cancellable job across
// several submissions, with the grid sized from a bounds readback and the
// probe list from a count readback; Kernel dispatches once per frame in the
// frame's compute pass and has neither (see docs/findings/2026-10-02-native-compute-audit.md).
//
// Samples, grid origin and dimensions follow Mol*'s arithmetic exactly; f32
// evaluation can flip an "is this point hidden" test that sits on a sphere
// boundary, which the browser suite bounds against the CPU field.
import { cellListWgsl } from "@molgpu/dynamics/wgsl";
import { assertGridBudget } from "../../internal/geometry-job.ts";
import { COPY_POSITIONS } from "../../internal/copy-positions-wgsl.ts";
import {
  dispatchFolded,
  encodeExclusiveScan,
} from "../../internal/gpu-scan.ts";

const MAP_READ = 0x0001;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;
const STORAGE = 0x0080;
const GROUP = 64;
const NONE = 0xffffffff;

// Unvisited samples hold UNVISITED until the last pass writes Mol*'s -1001.
// Visited samples are positive f32 bits, which order as u32, so atomicMin is
// the f32 minimum.
const UNVISITED = 0xffffffff;
/** Neighbour lists kept in workgroup memory, per atom. */
const NEIGHBOURS = 512;
/** Mol*'s upper bound on probe positions per torus. */
const MAX_PROBE_POSITIONS = 90;
const PARAMS_BYTES = 80 + MAX_PROBE_POSITIONS * 8;

// Shared by the SES stages:
// grid = (nx, ny, nz, selected), cells = (cnx, cny, cnz, probeCapacity),
// origin = (cell origin xyz, 1 / cell width), field = (field min xyz, 1 / resolution),
// probe = (ngTorus, probePositions, 0, 0), angles = Mol*'s (cos, sin) table,
// two per vec4.
const PARAMS = `
struct Ses {
  grid: vec4<u32>,
  cells: vec4<u32>,
  origin: vec4<f32>,
  field: vec4<f32>,
  probe: vec4<u32>,
  angles: array<vec4<f32>, ${MAX_PROBE_POSITIONS / 2}>,
};
@group(0) @binding(0) var<uniform> ses: Ses;
`;

// One workgroup per selected atom, as Mol* iterates. Its neighbours — every
// other sphere that can hide a point on its own, which includes every sphere
// it overlaps — are gathered once into workgroup memory from the 5³ cells
// around it (cells are one search radius wide; overlapping centres are up to
// two apart). `state[1]` reports a list that did not fit.
const ATOM = `${PARAMS}
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> radius: array<f32>;
@group(0) @binding(3) var<storage, read> offsets: array<u32>;
@group(0) @binding(4) var<storage, read> sortedRows: array<u32>;
@group(0) @binding(5) var<storage, read> rowMap: array<u32>;
@group(0) @binding(9) var<storage, read_write> state: array<atomic<u32>>;

var<workgroup> nbPos: array<vec4<f32>, ${NEIGHBOURS}>;
var<workgroup> nbRow: array<u32, ${NEIGHBOURS}>;
var<workgroup> nbAppend: atomic<u32>;
var<workgroup> nbCount: u32;

fn atomAt(row: u32) -> vec3<f32> {
  return vec3<f32>(positions[row * 3u], positions[row * 3u + 1u], positions[row * 3u + 2u]);
}

// Append every row k ≠ self with |c_k − c| − r_k ≤ r (Mol*'s lookup test).
// Returns the list length, or ${NEIGHBOURS + 1} when it overflowed.
fn gatherNeighbours(own: u32, c: vec3<f32>, r: f32, lane: u32) -> u32 {
  if (lane == 0u) { atomicStore(&nbAppend, 0u); }
  workgroupBarrier();
  let q = clamp(
    vec3<i32>(floor((c - ses.origin.xyz) * ses.origin.w)),
    vec3<i32>(0),
    vec3<i32>(ses.cells.xyz) - vec3<i32>(1)
  );
  for (var w = lane; w < 125u; w += 64u) {
    let cx = q.x + i32(w % 5u) - 2;
    let cy = q.y + i32((w / 5u) % 5u) - 2;
    let cz = q.z + i32(w / 25u) - 2;
    if (cx < 0 || cy < 0 || cz < 0 || cx >= i32(ses.cells.x) ||
        cy >= i32(ses.cells.y) || cz >= i32(ses.cells.z)) { continue; }
    let cell = u32(cx) + ses.cells.x * (u32(cy) + ses.cells.y * u32(cz));
    for (var slot = offsets[cell]; slot < offsets[cell + 1u]; slot++) {
      let k = sortedRows[slot];
      if (k == own) { continue; }
      let rk = radius[k];
      let p = atomAt(k);
      let v = p - c;
      if (sqrt(dot(v, v)) - rk > r) { continue; }
      let entry = atomicAdd(&nbAppend, 1u);
      if (entry < ${NEIGHBOURS}u) {
        nbPos[entry] = vec4<f32>(p, rk);
        nbRow[entry] = k;
      }
    }
  }
  workgroupBarrier();
  if (lane == 0u) {
    let total = atomicLoad(&nbAppend);
    nbCount = select(total, ${NEIGHBOURS + 1}u, total > ${NEIGHBOURS}u);
    if (total > ${NEIGHBOURS}u) { atomicStore(&state[1], 1u); }
  }
  return workgroupUniformLoad(&nbCount);
}

// Mol*'s obscured(): the list entry whose sphere strictly contains p, other
// than skip, or ${NONE}. Like Mol*'s lastClip, the previous hit is tried
// first: neighbouring points are usually hidden by the same sphere.
fn hidden(p: vec3<f32>, count: u32, skip: u32, hint: u32) -> u32 {
  if (hint < count && hint != skip) {
    let s = nbPos[hint];
    let d = s.xyz - p;
    if (dot(d, d) < s.w * s.w) { return hint; }
  }
  for (var k = 0u; k < count; k++) {
    if (k == skip) { continue; }
    let s = nbPos[k];
    let d = s.xyz - p;
    if (dot(d, d) < s.w * s.w) { return k; }
  }
  return ${NONE}u;
}

fn atomIndex(group: vec3<u32>, groups: vec3<u32>) -> u32 {
  return group.y * groups.x + group.x;
}
`;

const points = `${ATOM}
@group(0) @binding(6) var<storage, read> axes: array<f32>;
@group(0) @binding(7) var<storage, read_write> field: array<atomic<u32>>;
@compute @workgroup_size(64)
fn main(
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  let atom = atomIndex(group, groups);
  if (atom >= ses.grid.w) { return; }
  let j = rowMap[atom];
  let c = atomAt(j);
  let r = radius[j];
  let count = gatherNeighbours(j, c, r, local.x);
  if (count > ${NEIGHBOURS}u) { return; }
  // Mol*'s sample box around the atom.
  let ng = i32(ceil(r * ses.field.w));
  let ia = vec3<i32>(floor(ses.field.w * (c - ses.field.xyz)));
  let lo = max(vec3<i32>(0), ia - vec3<i32>(ng));
  let hi = min(vec3<i32>(ses.grid.xyz), ia + vec3<i32>(ng + 2));
  if (any(hi <= lo)) { return; }
  let extent = vec3<u32>(hi - lo);
  let total = extent.x * extent.y * extent.z;
  let nx = ses.grid.x;
  let ny = ses.grid.y;
  var hint = ${NONE}u;
  for (var s = local.x; s < total; s += 64u) {
    let xi = u32(lo.x) + s % extent.x;
    let yi = u32(lo.y) + (s / extent.x) % extent.y;
    let zi = u32(lo.z) + s / (extent.x * extent.y);
    let v = vec3<f32>(axes[xi], axes[nx + yi], axes[nx + ny + zi]) - c;
    let d2 = dot(v, v);
    if (d2 >= r * r) { continue; }
    let index = xi + nx * (yi + ny * zi);
    let d = sqrt(d2);
    let value = bitcast<u32>(r - d);
    // A sample already at or below this value is visited and keeps it.
    if (atomicLoad(&field[index]) <= value) { continue; }
    // A sample at the centre projects to NaN on the CPU, which no sphere hides.
    if (d > 0.0) {
      let hit = hidden(v * (r / d) + c, count, ${NONE}u, hint);
      if (hit != ${NONE}u) {
        hint = hit;
        atomicMin(&field[index], bitcast<u32>(1001.0));
        continue;
      }
    }
    atomicMin(&field[index], value);
  }
}`;

const probes = `${ATOM}
@group(0) @binding(7) var<storage, read_write> probeOut: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> probeCount: array<atomic<u32>>;

var<workgroup> pairAppend: atomic<u32>;
var<workgroup> pairList: array<u32, ${NEIGHBOURS}>;
var<workgroup> pairCount: u32;

fn normalToLine(p: vec3<f32>) -> vec3<f32> {
  var out = vec3<f32>(1.0);
  if (p.x != 0.0) {
    out.x = (p.y + p.z) / -p.x;
  } else if (p.y != 0.0) {
    out.y = (p.x + p.z) / -p.y;
  } else if (p.z != 0.0) {
    out.z = (p.x + p.y) / -p.z;
  }
  return out;
}

@compute @workgroup_size(64)
fn main(
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  let atom = atomIndex(group, groups);
  if (atom >= ses.grid.w) { return; }
  let a = rowMap[atom];
  let pa = atomAt(a);
  let rA = radius[a];
  let count = gatherNeighbours(a, pa, rA, local.x);
  if (count > ${NEIGHBOURS}u) { return; }
  // Each pair once, from its lower row; coincident centres draw no circle.
  if (local.x == 0u) { atomicStore(&pairAppend, 0u); }
  workgroupBarrier();
  for (var k = local.x; k < count; k += 64u) {
    if (nbRow[k] > a && any(nbPos[k].xyz != pa)) {
      pairList[atomicAdd(&pairAppend, 1u)] = k;
    }
  }
  workgroupBarrier();
  if (local.x == 0u) { pairCount = atomicLoad(&pairAppend); }
  let pairs = workgroupUniformLoad(&pairCount);
  let perPair = ses.probe.y;
  var hint = ${NONE}u;
  for (var item = local.x; item < pairs * perPair; item += 64u) {
    let k = pairList[item / perPair];
    let t = item % perPair;
    let pair = ses.angles[t / 2u];
    let angle = select(pair.xy, pair.zw, (t & 1u) == 1u);
    let rB = nbPos[k].w;
    let ab = nbPos[k].xyz - pa;
    let d = sqrt(dot(ab, ab));
    let cosA = (rA * rA + d * d - rB * rB) / (2.0 * rA * d);
    let dmp = rA * cosA;
    let rInt2 = rA * rA - dmp * dmp;
    // One sphere inside the other: NaN on the CPU, no circle.
    if (rInt2 < 0.0) { continue; }
    let rInt = sqrt(rInt2);
    let axis = normalize(ab);
    let n1 = normalize(normalToLine(axis));
    let n2 = normalize(cross(axis, n1));
    let p = pa + axis * dmp + angle.x * (n1 * rInt) + angle.y * (n2 * rInt);
    let hit = hidden(p, count, k, hint);
    if (hit != ${NONE}u) {
      hint = hit;
      continue;
    }
    let slot = atomicAdd(&probeCount[0], 1u);
    if (slot < ses.cells.w) { probeOut[slot] = vec4<f32>(p, 0.0); }
  }
}`;

const torii = `${PARAMS}
@group(0) @binding(6) var<storage, read> axes: array<f32>;
@group(0) @binding(7) var<storage, read_write> field: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read> probeIn: array<vec4<f32>>;
@group(0) @binding(9) var<storage, read> probeCount: array<u32>;
@compute @workgroup_size(64)
fn main(
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  let probe = group.y * groups.x + group.x;
  if (probe >= min(probeCount[0], ses.cells.w)) { return; }
  let p = probeIn[probe].xyz;
  let ng = i32(ses.probe.x);
  let ia = vec3<i32>(floor(ses.field.w * (p - ses.field.xyz)));
  let lo = max(vec3<i32>(0), ia - vec3<i32>(ng));
  let hi = min(vec3<i32>(ses.grid.xyz), ia + vec3<i32>(ng + 2));
  if (any(hi <= lo)) { return; }
  let extent = vec3<u32>(hi - lo);
  let total = extent.x * extent.y * extent.z;
  let nx = ses.grid.x;
  let ny = ses.grid.y;
  for (var s = local.x; s < total; s += 64u) {
    let xi = u32(lo.x) + s % extent.x;
    let yi = u32(lo.y) + (s / extent.x) % extent.y;
    let zi = u32(lo.z) + s / (extent.x * extent.y);
    let d = p - vec3<f32>(axes[xi], axes[nx + yi], axes[nx + ny + zi]);
    let d2 = dot(d, d);
    let index = xi + nx * (yi + ny * zi);
    let raw = atomicLoad(&field[index]);
    if (raw == ${UNVISITED}u) { continue; }
    let current = bitcast<f32>(raw);
    // Values only fall and stay positive once visited, so an atomic minimum
    // after this test equals Mol*'s sequential update in any order.
    if (current > 0.0 && d2 < current * current) {
      atomicMin(&field[index], bitcast<u32>(sqrt(d2)));
    }
  }
}`;

// Fill every sample UNVISITED, or (finish) lower UNVISITED to Mol*'s -1001.
const fill = `${PARAMS}
@group(0) @binding(1) var<storage, read_write> field: array<u32>;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  let samples = ses.grid.x * ses.grid.y * ses.grid.z;
  for (var i = id.x + id.y * groups.x * 64u; i < samples; i += groups.x * groups.y * 64u) {
    VALUE
  }
}`;
const start = fill.replace("VALUE", `field[i] = ${UNVISITED}u;`);
const finish = fill.replace(
  "VALUE",
  `if (field[i] == ${UNVISITED}u) { field[i] = bitcast<u32>(-1001.0); }`,
);

const STAGES = {
  points,
  probes,
  torii,
  start,
  finish,
  copyPositions: COPY_POSITIONS,
  bounds: cellListWgsl.bounds,
  mergeBounds: cellListWgsl.mergeBounds,
  count: cellListWgsl.count,
  scatter: cellListWgsl.scatter,
} as const;
type Stage = keyof typeof STAGES;

const pipelines = new WeakMap<GPUDevice, Map<Stage, GPUComputePipeline>>();
function pipeline(device: GPUDevice, name: Stage): GPUComputePipeline {
  let cache = pipelines.get(device);
  if (!cache) pipelines.set(device, cache = new Map());
  let result = cache.get(name);
  if (!result) {
    result = device.createComputePipeline({
      layout: "auto",
      compute: {
        module: device.createShaderModule({
          code: STAGES[name],
          label: `molgpu:ses:${name}`,
        }),
        entryPoint: "main",
      },
      label: `molgpu:ses:${name}`,
    });
    cache.set(name, result);
  }
  return result;
}

/** Mol*'s angle table: theta accumulated in f64, stored as f32. */
function angleTable(count: number): Float32Array {
  const out = new Float32Array(count * 2);
  const step = 2 * Math.PI / count;
  let theta = 0;
  for (let i = 0; i < count; i++) {
    out[i * 2] = Math.cos(theta);
    out[i * 2 + 1] = Math.sin(theta);
    theta += step;
  }
  return out;
}

/** The SES grid for an atom bounding box, with Mol*'s exact arithmetic. */
export interface SesGrid {
  readonly min: readonly [number, number, number];
  readonly dims: readonly [number, number, number];
  /** Grid sample coordinates per axis (x, then y, then z), as Mol* stores them. */
  readonly axes: Float32Array;
  /** Column-major grid-index-to-world scale + translate. */
  readonly transform: Float32Array;
}

/**
 * Grid placement for `calcMolecularSurface`: the atom box padded by the
 * largest van der Waals radius plus one resolution step, `ceil` of its
 * scaled size per axis, and samples at `min + resolution · i`.
 */
function sesGrid(
  low: ArrayLike<number>,
  high: ArrayLike<number>,
  maxRadius: number,
  resolution: number,
): SesGrid {
  const pad = maxRadius + resolution;
  const scale = 1 / resolution;
  const min = [0, 1, 2].map((a) => low[a] - pad) as [number, number, number];
  const dims = [0, 1, 2].map((a) =>
    Math.ceil((high[a] + pad) * scale - min[a] * scale)
  ) as [number, number, number];
  const axes = new Float32Array(dims[0] + dims[1] + dims[2]);
  let k = 0;
  for (let a = 0; a < 3; a++) {
    for (let i = 0; i < dims[a]; i++) axes[k++] = min[a] + resolution * i;
  }
  const transform = new Float32Array(16);
  transform[0] = transform[5] = transform[10] = resolution;
  transform[12] = min[0];
  transform[13] = min[1];
  transform[14] = min[2];
  transform[15] = 1;
  return { min, dims, axes, transform };
}

export interface GpuSesOptions {
  /** Atom count of the packed positions buffer (rows). */
  readonly atomCount: number;
  /** Selected atom rows, ascending. */
  readonly rows: Uint32Array;
  /** Van der Waals radius per row (atomRadii). */
  readonly radii: Float32Array;
  readonly probeRadius?: number;
  readonly resolution?: number;
  readonly probePositions?: number;
  /** Field byte budget; defaults to assertGridBudget's. */
  readonly maxBytes?: number;
  /** Initial torus-probe capacity; grows and reruns that stage on overflow. */
  readonly probeCapacity?: number;
  readonly signal?: AbortSignal;
  /** Also return the frozen coordinates and atom cell list (see `cells`). */
  readonly retainCells?: boolean;
}

/**
 * The coordinate generation and uniform cell list a field was computed from,
 * for later stages over the same atoms (vertex attribution). Cells are
 * `width` wide from `origin`, x fastest; atoms of cell c are
 * `sortedRows[offsets[c] .. offsets[c + 1])`. The caller destroys `buffers`.
 */
export interface SesCells {
  /** Packed xyz of every row, frozen for this generation. */
  readonly frame: GPUBuffer;
  /** The selected rows, ascending. */
  readonly rowMap: GPUBuffer;
  readonly offsets: GPUBuffer;
  readonly sortedRows: GPUBuffer;
  readonly count: number;
  readonly dims: readonly [number, number, number];
  readonly origin: readonly [number, number, number];
  readonly width: number;
  readonly buffers: readonly GPUBuffer[];
}

export interface GpuSesField {
  /** f32 samples, x fastest; the caller owns and destroys it. */
  readonly field: GPUBuffer;
  readonly dims: readonly [number, number, number];
  readonly transform: Float32Array;
  readonly resolution: number;
  /** Largest selected van der Waals radius. */
  readonly maxRadius: number;
  /** The isovalue: the probe radius. */
  readonly level: number;
  /** Torus probe points no sphere hides. */
  readonly probeCount: number;
  /** With `retainCells`: the frame and cell list; the caller destroys them. */
  readonly cells?: SesCells;
  /** Peak temporary allocation, excluding the field. */
  readonly workingBytes: number;
  readonly readbackBytes: number;
}

/**
 * Compute the SES field of `rows` from packed xyz `positions` on the GPU.
 * Returns null for an empty selection. A probe radius below two resolution
 * steps uses Mol*'s order-dependent "extended" update, which this port does
 * not reproduce; it throws a RangeError so the caller keeps the CPU field.
 */
export async function gpuSesField(
  device: GPUDevice,
  positions: GPUBuffer,
  options: GpuSesOptions,
): Promise<GpuSesField | null> {
  const {
    atomCount,
    rows,
    radii,
    probeRadius = 1.4,
    resolution = 0.5,
    probePositions = 36,
    maxBytes,
    signal,
  } = options;
  if (
    !Number.isInteger(probePositions) || probePositions < 1 ||
    probePositions > MAX_PROBE_POSITIONS
  ) {
    throw new RangeError(
      `probePositions must be an integer from 1 to ${MAX_PROBE_POSITIONS}`,
    );
  }
  if (probeRadius < resolution * 2) {
    throw new RangeError(
      "GPU SES field needs probeRadius of at least two resolution steps",
    );
  }
  if (radii.length !== atomCount) {
    throw new TypeError("radii must hold one radius per atom row");
  }
  const n = rows.length;
  if (!n) return null;
  const checkCurrent = () => {
    if (signal?.aborted) {
      throw new DOMException("GPU SES field was replaced", "AbortError");
    }
  };
  checkCurrent();

  const transient: GPUBuffer[] = [];
  let workingBytes = 0;
  let readbackBytes = 0;
  const make = (
    size: number,
    usage: number,
    label: string,
    initial?: ArrayBufferView,
    owned = true,
  ) => {
    const allocated = Math.max(16, Math.ceil(size / 4) * 4);
    const buffer = device.createBuffer({
      size: allocated,
      usage,
      label: `molgpu:ses:${label}`,
    });
    if (owned) {
      transient.push(buffer);
      workingBytes += allocated;
    }
    if (initial?.byteLength) {
      device.queue.writeBuffer(buffer, 0, initial as BufferSource);
    }
    return buffer;
  };
  const dispatch = (
    pass: GPUComputePassEncoder,
    name: Stage,
    entries: readonly [number, GPUBuffer][],
    groups: number,
  ) => {
    const p = pipeline(device, name);
    pass.setPipeline(p);
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: entries.map(([binding, buffer]) => ({
          binding,
          resource: { buffer },
        })),
      }),
    );
    dispatchFolded(device, pass, groups);
  };
  const read = async (source: GPUBuffer, bytes: number) => {
    readbackBytes += bytes;
    const staging = make(bytes, COPY_DST | MAP_READ, "readback");
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, 0, staging, 0, bytes);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(MAP_READ);
    const copy = staging.getMappedRange().slice(0);
    staging.unmap();
    return copy;
  };

  let field: GPUBuffer | null = null;
  try {
    let maxRadius = 0;
    const search = new Float32Array(atomCount);
    for (const row of rows) {
      if (radii[row] > maxRadius) maxRadius = radii[row];
      search[row] = radii[row] + probeRadius;
    }
    const maxSearch = maxRadius + probeRadius;

    // Freeze this generation: a producer may write the live source while the
    // bounds are mapped between submissions.
    const frame = make(atomCount * 12, STORAGE | COPY_SRC | COPY_DST, "frame");
    const rowMap = make(n * 4, STORAGE | COPY_DST, "rows", rows);
    const first = device.createCommandEncoder();
    if (positions.usage & COPY_SRC) {
      first.copyBufferToBuffer(positions, 0, frame, 0, atomCount * 12);
    } else {
      const copy = first.beginComputePass();
      dispatch(copy, "copyPositions", [
        [0, positions],
        [1, frame],
        [
          2,
          make(
            16,
            UNIFORM | COPY_DST,
            "copy-params",
            Uint32Array.of(
              atomCount * 3,
              0,
              0,
              0,
            ),
          ),
        ],
      ], Math.ceil(atomCount * 3 / GROUP));
      copy.end();
    }
    // Bounds of the selected atoms, reduced to one 32-byte summary.
    let boundCount = n;
    let boundInput: GPUBuffer | null = null;
    for (;;) {
      const groups = Math.ceil(boundCount / GROUP);
      const output = make(groups * 32, STORAGE | COPY_SRC, "bounds");
      const params = make(
        16,
        UNIFORM | COPY_DST,
        "bounds-params",
        Uint32Array.of(boundCount, 1, 0, 0),
      );
      const pass = first.beginComputePass();
      if (!boundInput) {
        dispatch(pass, "bounds", [
          [0, frame],
          [1, rowMap],
          [2, output],
          [3, params],
        ], groups);
      } else {
        dispatch(pass, "mergeBounds", [
          [0, boundInput],
          [2, output],
          [3, params],
        ], groups);
      }
      pass.end();
      boundInput = output;
      if (groups === 1) break;
      boundCount = groups;
    }
    device.queue.submit([first.finish()]);
    const summary = new Float32Array(await read(boundInput!, 32));
    checkCurrent();
    if (summary[3] !== 0 || summary[7] !== n) {
      throw new RangeError("GPU SES field: non-finite atom coordinates");
    }
    const low = summary.subarray(0, 3), high = summary.subarray(4, 7);
    const grid = sesGrid(low, high, maxRadius, resolution);
    assertGridBudget(grid.dims, maxBytes !== undefined ? { maxBytes } : {});
    const samples = grid.dims[0] * grid.dims[1] * grid.dims[2];

    // Uniform cell list over the selected atoms; a cell is at least the
    // largest search radius wide.
    const width = maxSearch * (1 + 1e-6);
    const cellDims = [0, 1, 2].map((a) =>
      Math.floor((high[a] - low[a]) / width) + 1
    ) as [number, number, number];
    const cells = cellDims[0] * cellDims[1] * cellDims[2];
    const cellParams = new ArrayBuffer(64);
    new Uint32Array(cellParams).set([n, 1, 0, 0, ...cellDims, cells]);
    new Float32Array(cellParams).set([...low, 0, 1 / width, 0, 0, 0], 8);
    const cellUniform = make(
      64,
      UNIFORM | COPY_DST,
      "cell-params",
      new Uint32Array(cellParams),
    );
    const cellIds = make(n * 4, STORAGE, "cell-ids");
    const counts = make(
      (cells + 1) * 4,
      STORAGE | COPY_DST,
      "cell-counts",
      new Uint32Array(cells + 1),
    );
    const sortedRows = make(n * 4, STORAGE, "sorted-rows");
    const encoder = device.createCommandEncoder();
    let pass = encoder.beginComputePass();
    dispatch(pass, "count", [
      [0, frame],
      [1, rowMap],
      [2, cellIds],
      [3, counts],
      [4, cellUniform],
    ], Math.ceil(n / GROUP));
    pass.end();
    // The extra zero count gives offsets[cells].
    const offsets = encodeExclusiveScan(
      device,
      encoder,
      counts,
      cells + 1,
      true,
      make,
    );
    const cursor = make(cells * 4, STORAGE | COPY_DST, "cursor");
    encoder.copyBufferToBuffer(offsets, 0, cursor, 0, cells * 4);
    pass = encoder.beginComputePass();
    dispatch(pass, "scatter", [
      [0, rowMap],
      [1, cellIds],
      [2, cursor],
      [3, sortedRows],
      [4, cellUniform],
    ], Math.ceil(n / GROUP));
    pass.end();

    const radius = make(atomCount * 4, STORAGE | COPY_DST, "radius", search);
    const axes = make(
      grid.axes.byteLength,
      STORAGE | COPY_DST,
      "axes",
      grid.axes,
    );
    field = make(samples * 4, STORAGE | COPY_SRC, "field", undefined, false);
    const ngTorus = 2 + Math.floor(probeRadius / resolution);
    let capacity = options.probeCapacity ?? Math.max(1024, n * 16);
    const sesParams = (probeCapacity: number) => {
      const data = new ArrayBuffer(PARAMS_BYTES);
      const u = new Uint32Array(data), f = new Float32Array(data);
      u.set([...grid.dims, n, ...cellDims, probeCapacity]);
      f.set([...low, 1 / width, ...grid.min, 1 / resolution], 8);
      u.set([ngTorus, probePositions, 0, 0], 16);
      f.set(angleTable(probePositions), 20);
      return make(PARAMS_BYTES, UNIFORM | COPY_DST, "ses-params", u);
    };
    let uniform = sesParams(capacity);
    const state = make(16, STORAGE | COPY_SRC | COPY_DST, "state");
    const probeCountBuffer = make(
      16,
      STORAGE | COPY_SRC | COPY_DST,
      "probe-count",
    );
    const atomInputs: [number, GPUBuffer][] = [
      [1, frame],
      [2, radius],
      [3, offsets],
      [4, sortedRows],
      [5, rowMap],
      [9, state],
    ];
    pass = encoder.beginComputePass();
    dispatch(
      pass,
      "start",
      [[0, uniform], [1, field]],
      Math.ceil(samples / GROUP),
    );
    dispatch(pass, "points", [
      [0, uniform],
      ...atomInputs,
      [6, axes],
      [7, field],
    ], n);
    pass.end();
    const findProbes = (target: GPUComputePassEncoder, out: GPUBuffer) =>
      dispatch(target, "probes", [
        [0, uniform],
        ...atomInputs,
        [7, out],
        [8, probeCountBuffer],
      ], n);
    let probeBuffer = make(capacity * 16, STORAGE, "probes");
    pass = encoder.beginComputePass();
    findProbes(pass, probeBuffer);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const readCounts = async () => {
      const [status, probe] = await Promise.all([
        read(state, 8),
        read(probeCountBuffer, 4),
      ]);
      checkCurrent();
      if (new Uint32Array(status)[1]) {
        throw new RangeError(
          `GPU SES field: an atom has more than ${NEIGHBOURS} neighbours`,
        );
      }
      return new Uint32Array(probe)[0];
    };
    let probeCount = await readCounts();
    if (probeCount > capacity) {
      // Rerun only the probe stage with room for every probe.
      capacity = probeCount;
      uniform = sesParams(capacity);
      probeBuffer = make(capacity * 16, STORAGE, "probes");
      const again = device.createCommandEncoder();
      again.clearBuffer(probeCountBuffer);
      const retry = again.beginComputePass();
      findProbes(retry, probeBuffer);
      retry.end();
      device.queue.submit([again.finish()]);
      probeCount = await readCounts();
    }
    const last = device.createCommandEncoder();
    pass = last.beginComputePass();
    if (probeCount) {
      dispatch(pass, "torii", [
        [0, uniform],
        [6, axes],
        [7, field],
        [8, probeBuffer],
        [9, probeCountBuffer],
      ], probeCount);
    }
    dispatch(
      pass,
      "finish",
      [[0, uniform], [1, field]],
      Math.ceil(samples / GROUP),
    );
    pass.end();
    device.queue.submit([last.finish()]);
    await device.queue.onSubmittedWorkDone();
    checkCurrent();
    let retained: SesCells | undefined;
    if (options.retainCells) {
      const buffers = [frame, rowMap, offsets, sortedRows];
      for (const buffer of buffers) {
        transient.splice(transient.indexOf(buffer), 1);
      }
      retained = {
        frame,
        rowMap,
        offsets,
        sortedRows,
        count: n,
        dims: cellDims,
        origin: [low[0], low[1], low[2]],
        width,
        buffers,
      };
    }
    const result: GpuSesField = {
      field,
      ...(retained ? { cells: retained } : {}),
      dims: grid.dims,
      transform: grid.transform,
      resolution,
      maxRadius,
      level: probeRadius,
      probeCount,
      workingBytes,
      readbackBytes,
    };
    field = null;
    return result;
  } finally {
    field?.destroy();
    for (const buffer of transient) buffer.destroy();
  }
}
