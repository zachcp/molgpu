// Marching cubes on the GPU, producing the same mesh as @molgpu/geo's
// marchingCubes: one vertex per cut edge of each cube (no welding across
// cubes), cubes in x-fastest order, vertices in edge order, triangles from the
// same tables, normals from interpolated clamped central differences, and the
// same affine and inverse-transpose mapping. Each cube's vertex and index
// counts are scanned so every cube writes its own contiguous range; only the
// two totals are read back, to size the output. Raw WebGPU, not use.gpu
// Kernel: the output is allocated from that readback between submissions of
// one cancellable job (see docs/findings/2026-10-02-native-compute-audit.md).
import { marchingCubesTables } from "@molgpu/geo";
import {
  dispatchFolded,
  encodeExclusiveScan,
  type MakeBuffer,
} from "../../internal/gpu-scan.ts";

const MAP_READ = 0x0001;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;
const STORAGE = 0x0080;
const GROUP = 64;

// dims = (nx, ny, nz, cubes); shape = (level, 0, 0, 0), flip = (mirrored, 0, 0, 0);
// m0..m3 = grid-index-to-world columns; c0..c2 = sign(det) × cofactor columns.
// Tables, one u32 array: edges [0, 256), triangle lengths [256, 512),
// triangles [512, 4608) (16 slots per configuration), cube edges [4608, 4680).
const COMMON = `
struct Mc {
  dims: vec4<u32>,
  shape: vec4<f32>,
  flip: vec4<u32>,
  m0: vec4<f32>,
  m1: vec4<f32>,
  m2: vec4<f32>,
  m3: vec4<f32>,
  c0: vec4<f32>,
  c1: vec4<f32>,
  c2: vec4<f32>,
};
@group(0) @binding(0) var<uniform> mc: Mc;
@group(0) @binding(1) var<storage, read> field: array<f32>;
@group(0) @binding(2) var<storage, read> tables: array<u32>;

fn valueAt(x: u32, y: u32, z: u32) -> f32 {
  return field[x + mc.dims.x * (y + mc.dims.y * z)];
}

fn cubeOf(i: u32) -> vec3<u32> {
  let cx = mc.dims.x - 1u;
  let cy = mc.dims.y - 1u;
  return vec3<u32>(i % cx, (i / cx) % cy, i / (cx * cy));
}

fn maskOf(c: vec3<u32>) -> u32 {
  let level = mc.shape.x;
  var mask = 0u;
  if (valueAt(c.x, c.y, c.z) < level) { mask |= 1u; }
  if (valueAt(c.x + 1u, c.y, c.z) < level) { mask |= 2u; }
  if (valueAt(c.x + 1u, c.y + 1u, c.z) < level) { mask |= 4u; }
  if (valueAt(c.x, c.y + 1u, c.z) < level) { mask |= 8u; }
  if (valueAt(c.x, c.y, c.z + 1u) < level) { mask |= 16u; }
  if (valueAt(c.x + 1u, c.y, c.z + 1u) < level) { mask |= 32u; }
  if (valueAt(c.x + 1u, c.y + 1u, c.z + 1u) < level) { mask |= 64u; }
  if (valueAt(c.x, c.y + 1u, c.z + 1u) < level) { mask |= 128u; }
  return mask;
}

fn linearId(id: vec3<u32>, group: vec3<u32>, groups: vec3<u32>) -> u32 {
  return (group.y * groups.x + group.x) * ${GROUP}u + (id.x - group.x * ${GROUP}u);
}
`;

const classify = `${COMMON}
@group(0) @binding(3) var<storage, read_write> vertexCounts: array<u32>;
@group(0) @binding(4) var<storage, read_write> indexCounts: array<u32>;
@compute @workgroup_size(${GROUP})
fn main(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  let i = linearId(id, group, groups);
  if (i >= mc.dims.w) { return; }
  let mask = maskOf(cubeOf(i));
  vertexCounts[i] = countOneBits(tables[mask]);
  indexCounts[i] = tables[256u + mask];
}`;

const emit = `${COMMON}
@group(0) @binding(3) var<storage, read> vertexOffsets: array<u32>;
@group(0) @binding(4) var<storage, read> indexOffsets: array<u32>;
@group(0) @binding(5) var<storage, read_write> positions: array<f32>;
@group(0) @binding(6) var<storage, read_write> normals: array<f32>;
@group(0) @binding(7) var<storage, read_write> indices: array<u32>;

fn gradient(x: u32, y: u32, z: u32) -> vec3<f32> {
  let hi = mc.dims.xyz - vec3<u32>(1u);
  return vec3<f32>(
    valueAt(select(x - 1u, 0u, x == 0u), y, z) - valueAt(min(hi.x, x + 1u), y, z),
    valueAt(x, select(y - 1u, 0u, y == 0u), z) - valueAt(x, min(hi.y, y + 1u), z),
    valueAt(x, y, select(z - 1u, 0u, z == 0u)) - valueAt(x, y, min(hi.z, z + 1u)),
  );
}

// geo's unit(): a zero vector stays zero.
fn unit(v: vec3<f32>) -> vec3<f32> {
  let length = sqrt(dot(v, v));
  return v / select(length, 1.0, length == 0.0);
}

@compute @workgroup_size(${GROUP})
fn main(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  let i = linearId(id, group, groups);
  if (i >= mc.dims.w) { return; }
  let c = cubeOf(i);
  let mask = maskOf(c);
  let edgeMask = tables[mask];
  if (edgeMask == 0u) { return; }
  var vertex = vertexOffsets[i];
  var slot: array<u32, 12>;
  for (var e = 0u; e < 12u; e++) {
    if ((edgeMask & (1u << e)) == 0u) { continue; }
    let base = 4608u + e * 6u;
    let a = c + vec3<u32>(tables[base], tables[base + 1u], tables[base + 2u]);
    let b = c + vec3<u32>(tables[base + 3u], tables[base + 4u], tables[base + 5u]);
    let va = valueAt(a.x, a.y, a.z);
    let vb = valueAt(b.x, b.y, b.z);
    let t = select((mc.shape.x - va) / (vb - va), 0.5, va == vb);
    let pa = vec3<f32>(a);
    let p = pa + t * (vec3<f32>(b) - pa);
    let ga = gradient(a.x, a.y, a.z);
    let g = unit(ga + t * (gradient(b.x, b.y, b.z) - ga));
    let world = mc.m0.xyz * p.x + mc.m1.xyz * p.y + mc.m2.xyz * p.z + mc.m3.xyz;
    let n = unit(mc.c0.xyz * g.x + mc.c1.xyz * g.y + mc.c2.xyz * g.z);
    positions[vertex * 3u] = world.x;
    positions[vertex * 3u + 1u] = world.y;
    positions[vertex * 3u + 2u] = world.z;
    normals[vertex * 3u] = n.x;
    normals[vertex * 3u + 1u] = n.y;
    normals[vertex * 3u + 2u] = n.z;
    slot[e] = vertex;
    vertex++;
  }
  let count = tables[256u + mask];
  let out = indexOffsets[i];
  for (var k = 0u; k < count; k += 3u) {
    let a = slot[tables[512u + mask * 16u + k]];
    let b = slot[tables[512u + mask * 16u + k + 1u]];
    let d = slot[tables[512u + mask * 16u + k + 2u]];
    indices[out + k] = a;
    // A mirroring transform swaps winding, as geo's transformMesh does.
    indices[out + k + 1u] = select(b, d, mc.flip.x == 1u);
    indices[out + k + 2u] = select(d, b, mc.flip.x == 1u);
  }
}`;

const STAGES = { classify, emit } as const;
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
          label: `molgpu:marching-cubes:${name}`,
        }),
        entryPoint: "main",
      },
      label: `molgpu:marching-cubes:${name}`,
    });
    cache.set(name, result);
  }
  return result;
}

let packedTables: Uint32Array | null = null;
function tables(): Uint32Array {
  if (packedTables) return packedTables;
  const t = marchingCubesTables();
  const out = new Uint32Array(4608 + 72);
  out.set(t.edges, 0);
  out.set(t.triangleLengths, 256);
  out.set(t.triangles, 512);
  out.set(t.cubeEdges, 4608);
  return packedTables = out;
}

export interface GpuMarchingCubesOptions {
  readonly dims: readonly [number, number, number];
  readonly level: number;
  /** Column-major grid-index-to-world affine. */
  readonly transform: ArrayLike<number>;
  readonly signal?: AbortSignal;
}

export interface GpuMesh {
  /** Packed vec3 f32; these three buffers are owned by the caller. */
  readonly positions: GPUBuffer;
  readonly normals: GPUBuffer;
  readonly indices: GPUBuffer;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly workingBytes: number;
  readonly readbackBytes: number;
}

/**
 * Extract the `level` isosurface of an x-fastest f32 `field` with `dims`.
 * Returns null when no cube is cut.
 */
export async function gpuMarchingCubes(
  device: GPUDevice,
  field: GPUBuffer,
  options: GpuMarchingCubesOptions,
): Promise<GpuMesh | null> {
  const { dims, level, transform: m, signal } = options;
  if (dims.some((n) => !Number.isInteger(n) || n < 2)) {
    throw new TypeError("dims must contain three integers of at least 2");
  }
  if (
    m.length !== 16 || m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1
  ) {
    throw new TypeError("transform must be a column-major affine");
  }
  const cubes = (dims[0] - 1) * (dims[1] - 1) * (dims[2] - 1);
  const checkCurrent = () => {
    if (signal?.aborted) {
      throw new DOMException("GPU marching cubes was replaced", "AbortError");
    }
  };
  const transient: GPUBuffer[] = [];
  let workingBytes = 0;
  let readbackBytes = 0;
  const make: MakeBuffer = (size, usage, label, initial) => {
    const allocated = Math.max(16, Math.ceil(size / 4) * 4);
    const buffer = device.createBuffer({
      size: allocated,
      usage,
      label: `molgpu:marching-cubes:${label}`,
    });
    transient.push(buffer);
    workingBytes += allocated;
    if (initial?.byteLength) {
      device.queue.writeBuffer(buffer, 0, initial as BufferSource);
    }
    return buffer;
  };
  const dispatch = (
    pass: GPUComputePassEncoder,
    name: Stage,
    entries: [number, GPUBuffer][],
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
    dispatchFolded(device, pass, Math.ceil(cubes / GROUP));
  };

  const outputs: GPUBuffer[] = [];
  try {
    // geo's transformMesh: cofactors of the linear part map normals; a
    // negative determinant flips them back and swaps winding.
    const c = [
      m[5] * m[10] - m[6] * m[9],
      m[6] * m[8] - m[4] * m[10],
      m[4] * m[9] - m[5] * m[8],
      m[2] * m[9] - m[1] * m[10],
      m[0] * m[10] - m[2] * m[8],
      m[1] * m[8] - m[0] * m[9],
      m[1] * m[6] - m[2] * m[5],
      m[2] * m[4] - m[0] * m[6],
      m[0] * m[5] - m[1] * m[4],
    ];
    const det = m[0] * c[0] + m[4] * c[3] + m[8] * c[6];
    if (!(Math.abs(det) > 0)) {
      throw new TypeError("transform must be invertible");
    }
    const s = Math.sign(det);
    const data = new ArrayBuffer(160);
    const u = new Uint32Array(data), f = new Float32Array(data);
    u.set([...dims, cubes]);
    f[4] = level;
    u[8] = det < 0 ? 1 : 0;
    f.set(Array.from(m), 12);
    f.set([s * c[0], s * c[1], s * c[2], 0], 28);
    f.set([s * c[3], s * c[4], s * c[5], 0], 32);
    f.set([s * c[6], s * c[7], s * c[8], 0], 36);
    const uniform = make(160, UNIFORM | COPY_DST, "params", u);
    const tableBuffer = make(
      tables().byteLength,
      STORAGE | COPY_DST,
      "tables",
      tables(),
    );
    // One extra zero count per array: its offset is the total.
    const vertexCounts = make((cubes + 1) * 4, STORAGE, "vertex-counts");
    const indexCounts = make((cubes + 1) * 4, STORAGE, "index-counts");
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    dispatch(pass, "classify", [
      [0, uniform],
      [1, field],
      [2, tableBuffer],
      [3, vertexCounts],
      [4, indexCounts],
    ]);
    pass.end();
    const vertexOffsets = encodeExclusiveScan(
      device,
      encoder,
      vertexCounts,
      cubes + 1,
      false,
      make,
    );
    const indexOffsets = encodeExclusiveScan(
      device,
      encoder,
      indexCounts,
      cubes + 1,
      false,
      make,
    );
    const totals = make(8, COPY_DST | MAP_READ, "totals");
    encoder.copyBufferToBuffer(vertexOffsets, cubes * 4, totals, 0, 4);
    encoder.copyBufferToBuffer(indexOffsets, cubes * 4, totals, 4, 4);
    device.queue.submit([encoder.finish()]);
    readbackBytes += 8;
    await totals.mapAsync(MAP_READ);
    const [vertexCount, indexCount] = new Uint32Array(
      totals.getMappedRange().slice(0),
    );
    totals.unmap();
    checkCurrent();
    if (!vertexCount) return null;

    const output = (size: number, label: string) => {
      const buffer = device.createBuffer({
        size: Math.max(16, size),
        usage: STORAGE | COPY_SRC,
        label: `molgpu:marching-cubes:${label}`,
      });
      outputs.push(buffer);
      return buffer;
    };
    const positions = output(vertexCount * 12, "positions");
    const normals = output(vertexCount * 12, "normals");
    const indices = output(indexCount * 4, "indices");
    const second = device.createCommandEncoder();
    const emitPass = second.beginComputePass();
    dispatch(emitPass, "emit", [
      [0, uniform],
      [1, field],
      [2, tableBuffer],
      [3, vertexOffsets],
      [4, indexOffsets],
      [5, positions],
      [6, normals],
      [7, indices],
    ]);
    emitPass.end();
    device.queue.submit([second.finish()]);
    await device.queue.onSubmittedWorkDone();
    checkCurrent();
    outputs.length = 0;
    return {
      positions,
      normals,
      indices,
      vertexCount,
      triangleCount: indexCount / 3,
      workingBytes,
      readbackBytes,
    };
  } finally {
    for (const buffer of outputs) buffer.destroy();
    for (const buffer of transient) buffer.destroy();
  }
}
