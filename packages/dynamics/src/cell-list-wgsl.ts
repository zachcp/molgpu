// Plain WGSL modules. All storage is owned by the caller; no WebGPU or
// renderer object crosses the package boundary. Coordinates are packed xyz.
// A 64-byte Parameters uniform is shared by count, scatter, pair and bounds:
// config=(selectedCount, hasRowMap, maxCandidates, maxPairs),
// dims=(nx, ny, nz, cellCount), origin.xyz, scales=(1/cellWidth, cutoff², 0, 0).
const PARAMS = `
struct Parameters {
  config: vec4<u32>,
  dims: vec4<u32>,
  origin: vec4<f32>,
  scales: vec4<f32>,
};
@group(0) @binding(4) var<uniform> params: Parameters;
`;

const CELL = `
fn cellOf(p: vec3<f32>) -> u32 {
  let q = clamp(
    vec3<i32>(floor((p - params.origin.xyz) * params.scales.x)),
    vec3<i32>(0),
    vec3<i32>(params.dims.xyz) - vec3<i32>(1)
  );
  return u32(q.x) + params.dims.x * (u32(q.y) + params.dims.y * u32(q.z));
}
`;

const count = `${PARAMS}
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> rowMap: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellIds: array<u32>;
@group(0) @binding(3) var<storage, read_write> counts: array<atomic<u32>>;
${CELL}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.config.x) { return; }
  var row = i;
  if (params.config.y != 0u) { row = rowMap[i]; }
  let p = vec3<f32>(positions[row * 3u], positions[row * 3u + 1u], positions[row * 3u + 2u]);
  let cell = cellOf(p);
  cellIds[i] = cell;
  atomicAdd(&counts[cell], 1u);
}`;

const SCAN_COMMON = `
struct ScanParams { count: u32, _a: u32, _b: u32, _c: u32 };
@group(0) @binding(1) var<storage, read_write> offsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(3) var<uniform> params: ScanParams;
var<workgroup> scratch: array<u32, 256>;
@compute @workgroup_size(256)
fn main(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>
) {
  let i = id.x;
  let lane = local.x;
  var value = 0u;
  if (i < params.count) { value = LOAD; }
  scratch[lane] = value;
  workgroupBarrier();
  for (var step = 1u; step < 256u; step = step * 2u) {
    var add = 0u;
    if (lane >= step) { add = scratch[lane - step]; }
    workgroupBarrier();
    scratch[lane] = scratch[lane] + add;
    workgroupBarrier();
  }
  if (i < params.count) { offsets[i] = scratch[lane] - value; }
  if (lane == 255u) { blockSums[group.x] = scratch[lane]; }
}`;
const scanCounts = `
@group(0) @binding(0) var<storage, read_write> input: array<atomic<u32>>;
${SCAN_COMMON.replace("LOAD", "atomicLoad(&input[i])")}`;
const scanValues = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
${SCAN_COMMON.replace("LOAD", "input[i]")}`;
const addOffsets = `
struct ScanParams { count: u32, _a: u32, _b: u32, _c: u32 };
@group(0) @binding(0) var<storage, read_write> offsets: array<u32>;
@group(0) @binding(1) var<storage, read> parentOffsets: array<u32>;
@group(0) @binding(2) var<uniform> params: ScanParams;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.count) { return; }
  offsets[id.x] = offsets[id.x] + parentOffsets[id.x / 256u];
}`;

const scatter = `${PARAMS}
@group(0) @binding(0) var<storage, read> rowMap: array<u32>;
@group(0) @binding(1) var<storage, read> cellIds: array<u32>;
@group(0) @binding(2) var<storage, read_write> cursor: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> sortedRows: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.config.x) { return; }
  var row = i;
  if (params.config.y != 0u) { row = rowMap[i]; }
  let slot = atomicAdd(&cursor[cellIds[i]], 1u);
  sortedRows[slot] = row;
}`;

const pairs = `${PARAMS}
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> rowMap: array<u32>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> offsets: array<u32>;
@group(0) @binding(5) var<storage, read> sortedRows: array<u32>;
@group(0) @binding(6) var<storage, read_write> outPairs: array<vec2<u32>>;
@group(0) @binding(7) var<storage, read_write> state: array<atomic<u32>>;
${CELL}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.config.x) { return; }
  var row = i;
  if (params.config.y != 0u) { row = rowMap[i]; }
  let p = vec3<f32>(positions[row * 3u], positions[row * 3u + 1u], positions[row * 3u + 2u]);
  let q = clamp(
    vec3<i32>(floor((p - params.origin.xyz) * params.scales.x)),
    vec3<i32>(0),
    vec3<i32>(params.dims.xyz) - vec3<i32>(1)
  );
  var candidates = 0u;
  for (var z = max(0, q.z - 1); z <= min(i32(params.dims.z) - 1, q.z + 1); z++) {
    for (var y = max(0, q.y - 1); y <= min(i32(params.dims.y) - 1, q.y + 1); y++) {
      for (var x = max(0, q.x - 1); x <= min(i32(params.dims.x) - 1, q.x + 1); x++) {
        let cell = u32(x) + params.dims.x * (u32(y) + params.dims.y * u32(z));
        let n = atomicLoad(&counts[cell]);
        if (n > params.config.z - candidates) {
          atomicStore(&state[1], 1u);
          return;
        }
        candidates += n;
        for (var slot = offsets[cell]; slot < offsets[cell] + n; slot++) {
          let other = sortedRows[slot];
          if (other <= row) { continue; }
          let r = vec3<f32>(positions[other * 3u], positions[other * 3u + 1u], positions[other * 3u + 2u]);
          let d = r - p;
          if (dot(d, d) <= params.scales.y) {
            let write = atomicAdd(&state[0], 1u);
            if (write >= params.config.w) {
              atomicStore(&state[1], 1u);
              return;
            }
            outPairs[write] = vec2<u32>(row, other);
          }
        }
      }
    }
  }
}`;

// Each workgroup emits a 32-byte bound. Repeated merge passes produce one
// 32-byte summary for readback; the caller tags it with source generation.
const BOUNDS_COMMON = `
struct Bounds { lo: vec4<f32>, hi: vec4<f32> };
@group(0) @binding(2) var<storage, read_write> output: array<Bounds>;
struct BoundsParams { count: u32, selected: u32, _a: u32, _b: u32 };
@group(0) @binding(3) var<uniform> params: BoundsParams;
var<workgroup> low: array<vec4<f32>, 64>;
var<workgroup> high: array<vec4<f32>, 64>;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>
) {
  let lane = local.x;
  let maxFinite = bitcast<f32>(0x7f7fffffu);
  var lo = vec4<f32>(maxFinite, maxFinite, maxFinite, 0.0);
  var hi = vec4<f32>(-maxFinite, -maxFinite, -maxFinite, 0.0);
  if (id.x < params.count) {
    LOAD
  }
  low[lane] = lo;
  high[lane] = hi;
  workgroupBarrier();
  for (var step = 32u; step > 0u; step = step / 2u) {
    if (lane < step) {
      let otherLo = low[lane + step];
      let otherHi = high[lane + step];
      low[lane] = vec4<f32>(min(low[lane].xyz, otherLo.xyz), low[lane].w + otherLo.w);
      high[lane] = vec4<f32>(max(high[lane].xyz, otherHi.xyz), high[lane].w + otherHi.w);
    }
    workgroupBarrier();
  }
  if (lane == 0u) { output[group.x] = Bounds(low[0], high[0]); }
}`;
const bounds = `
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> rowMap: array<u32>;
${
  BOUNDS_COMMON.replace(
    "LOAD",
    `
    var row = id.x;
    if (params.selected != 0u) { row = rowMap[id.x]; }
    let p = vec3<f32>(positions[row * 3u], positions[row * 3u + 1u], positions[row * 3u + 2u]);
    let exponent = bitcast<vec3<u32>>(p) & vec3<u32>(0x7f800000u);
    if (all(exponent != vec3<u32>(0x7f800000u))) {
      lo = vec4<f32>(p, 0.0);
      hi = vec4<f32>(p, 1.0);
    } else {
      lo.w = 1.0;
    }
  `,
  )
}`;
const mergeBounds = `
struct Bounds { lo: vec4<f32>, hi: vec4<f32> };
@group(0) @binding(0) var<storage, read> input: array<Bounds>;
${
  BOUNDS_COMMON.replace(
    "LOAD",
    `
    lo = input[id.x].lo;
    hi = input[id.x].hi;
  `,
  ).replace("struct Bounds { lo: vec4<f32>, hi: vec4<f32> };", "")
}`;

/** WGSL stages for a bounded, counting-sort uniform grid over packed xyz. */
export const cellListWgsl: Readonly<{
  bounds: string;
  mergeBounds: string;
  count: string;
  scanCounts: string;
  scanValues: string;
  addOffsets: string;
  scatter: string;
  pairs: string;
  scanBlockSize: number;
  boundsBlockSize: number;
}> = Object.freeze({
  bounds,
  mergeBounds,
  count,
  scanCounts,
  scanValues,
  addOffsets,
  scatter,
  pairs,
  scanBlockSize: 256,
  boundsBlockSize: 64,
});
