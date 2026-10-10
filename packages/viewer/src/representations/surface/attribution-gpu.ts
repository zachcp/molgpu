// Nearest-atom attribution of surface vertices on the GPU: the exact nearest
// selected atom row per vertex, as @molgpu/geo's nearestAtomAttribution
// computes it. A 5³ cell window around the vertex is searched first; a hit
// within two cell widths is certified (every unsearched cell is at least that
// far away, also for vertices outside the atom bounds, whose cell is clamped),
// otherwise the vertex scans every selected atom. Equal distances resolve to
// the lower row, which is the lower gather index. Encoded into the surface
// build's own submissions (raw WebGPU, like the field it reuses; see
// docs/findings/2026-10-02-native-compute-audit.md).
import type { SesCells } from "./ses-field.ts";
import { dispatchFolded } from "../../internal/gpu-scan.ts";

const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;
const STORAGE = 0x0080;
const GROUP = 64;

// grid = (cnx, cny, cnz, atoms), counts = (vertices, 0, 0, 0),
// origin = (cell origin xyz, 1 / width), certify = ((2 width)², 0, 0, 0).
const ATTRIBUTE = `
struct Attribution {
  grid: vec4<u32>,
  counts: vec4<u32>,
  origin: vec4<f32>,
  certify: vec4<f32>,
};
@group(0) @binding(0) var<uniform> params: Attribution;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> offsets: array<u32>;
@group(0) @binding(3) var<storage, read> sortedRows: array<u32>;
@group(0) @binding(4) var<storage, read> rowMap: array<u32>;
@group(0) @binding(5) var<storage, read> vertices: array<f32>;
@group(0) @binding(6) var<storage, read_write> sourceAtom: array<u32>;

fn atomAt(row: u32) -> vec3<f32> {
  return vec3<f32>(positions[row * 3u], positions[row * 3u + 1u], positions[row * 3u + 2u]);
}

@compute @workgroup_size(${GROUP})
fn main(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  let v = (group.y * groups.x + group.x) * ${GROUP}u + (id.x - group.x * ${GROUP}u);
  if (v >= params.counts.x) { return; }
  let p = vec3<f32>(vertices[v * 3u], vertices[v * 3u + 1u], vertices[v * 3u + 2u]);
  let q = clamp(
    vec3<i32>(floor((p - params.origin.xyz) * params.origin.w)),
    vec3<i32>(0),
    vec3<i32>(params.grid.xyz) - vec3<i32>(1)
  );
  let hi = vec3<i32>(params.grid.xyz) - vec3<i32>(1);
  var best = 0xffffffffu;
  var bestDist = 3.4e38;
  for (var z = max(0, q.z - 2); z <= min(hi.z, q.z + 2); z++) {
    for (var y = max(0, q.y - 2); y <= min(hi.y, q.y + 2); y++) {
      for (var x = max(0, q.x - 2); x <= min(hi.x, q.x + 2); x++) {
        let cell = u32(x) + params.grid.x * (u32(y) + params.grid.y * u32(z));
        for (var slot = offsets[cell]; slot < offsets[cell + 1u]; slot++) {
          let row = sortedRows[slot];
          let d = atomAt(row) - p;
          let d2 = dot(d, d);
          if (d2 < bestDist || (d2 == bestDist && row < best)) {
            bestDist = d2;
            best = row;
          }
        }
      }
    }
  }
  if (bestDist > params.certify.x) {
    best = 0xffffffffu;
    bestDist = 3.4e38;
    for (var k = 0u; k < params.grid.w; k++) {
      let row = rowMap[k];
      let d = atomAt(row) - p;
      let d2 = dot(d, d);
      if (d2 < bestDist) {
        bestDist = d2;
        best = row;
      }
    }
  }
  sourceAtom[v] = best;
}`;

const pipelines = new WeakMap<GPUDevice, GPUComputePipeline>();
function pipeline(device: GPUDevice): GPUComputePipeline {
  let result = pipelines.get(device);
  if (!result) {
    result = device.createComputePipeline({
      layout: "auto",
      compute: {
        module: device.createShaderModule({
          code: ATTRIBUTE,
          label: "molgpu:attribution",
        }),
        entryPoint: "main",
      },
      label: "molgpu:attribution",
    });
    pipelines.set(device, result);
  }
  return result;
}

/**
 * Encode the nearest selected atom row of each of `vertexCount` packed xyz
 * `vertices`, over the atoms and cell list in `cells`. Returns a u32 buffer
 * the caller owns; it is complete once `encoder` is submitted.
 */
export function encodeAttribution(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  vertices: GPUBuffer,
  vertexCount: number,
  cells: SesCells,
): { sourceAtom: GPUBuffer; params: GPUBuffer } {
  const data = new ArrayBuffer(64);
  const u = new Uint32Array(data), f = new Float32Array(data);
  u.set([...cells.dims, cells.count, vertexCount, 0, 0, 0]);
  f.set([...cells.origin, 1 / cells.width, (2 * cells.width) ** 2, 0, 0, 0], 8);
  const params = device.createBuffer({
    size: 64,
    usage: UNIFORM | COPY_DST,
    label: "molgpu:attribution:params",
  });
  device.queue.writeBuffer(params, 0, u);
  const sourceAtom = device.createBuffer({
    size: Math.max(16, vertexCount * 4),
    usage: STORAGE | COPY_SRC,
    label: "molgpu:attribution:source-atom",
  });
  const p = pipeline(device);
  const pass = encoder.beginComputePass();
  pass.setPipeline(p);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: [
        params,
        cells.frame,
        cells.offsets,
        cells.sortedRows,
        cells.rowMap,
        vertices,
        sourceAtom,
      ].map((buffer, binding) => ({ binding, resource: { buffer } })),
    }),
  );
  dispatchFolded(device, pass, Math.ceil(vertexCount / GROUP));
  pass.end();
  return { sourceAtom, params };
}
