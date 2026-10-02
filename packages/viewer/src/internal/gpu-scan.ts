// Exclusive prefix sum of a u32 storage array on the GPU: 256-wide workgroup
// scans, a recursive scan of the block sums, then a pass adding each block's
// offset back. Workgroups fold into two dispatch dimensions, so any count a
// storage binding can hold scans (the cell-list scan in @molgpu/dynamics
// dispatches one dimension and is sized for cell grids).
const BLOCK = 256;

const scan = (load: string, input: string) => `
struct ScanParams { count: u32, _a: u32, _b: u32, _c: u32 };
${input}
@group(0) @binding(1) var<storage, read_write> offsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(3) var<uniform> params: ScanParams;
var<workgroup> scratch: array<u32, ${BLOCK}>;
@compute @workgroup_size(${BLOCK})
fn main(
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  let block = group.y * groups.x + group.x;
  let i = block * ${BLOCK}u + local.x;
  let lane = local.x;
  var value = 0u;
  if (i < params.count) { value = ${load}; }
  scratch[lane] = value;
  workgroupBarrier();
  for (var step = 1u; step < ${BLOCK}u; step = step * 2u) {
    var add = 0u;
    if (lane >= step) { add = scratch[lane - step]; }
    workgroupBarrier();
    scratch[lane] = scratch[lane] + add;
    workgroupBarrier();
  }
  if (i < params.count) { offsets[i] = scratch[lane] - value; }
  if (lane == ${BLOCK - 1}u) { blockSums[block] = scratch[lane]; }
}`;

const STAGES = {
  scanCounts: scan(
    "atomicLoad(&input[i])",
    "@group(0) @binding(0) var<storage, read_write> input: array<atomic<u32>>;",
  ),
  scanValues: scan(
    "input[i]",
    "@group(0) @binding(0) var<storage, read> input: array<u32>;",
  ),
  addOffsets: `
struct ScanParams { count: u32, _a: u32, _b: u32, _c: u32 };
@group(0) @binding(0) var<storage, read_write> offsets: array<u32>;
@group(0) @binding(1) var<storage, read> parentOffsets: array<u32>;
@group(0) @binding(2) var<uniform> params: ScanParams;
@compute @workgroup_size(${BLOCK})
fn main(
  @builtin(local_invocation_id) local: vec3<u32>,
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  let block = group.y * groups.x + group.x;
  let i = block * ${BLOCK}u + local.x;
  if (i >= params.count) { return; }
  offsets[i] = offsets[i] + parentOffsets[block];
}`,
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
          label: `molgpu:scan:${name}`,
        }),
        entryPoint: "main",
      },
      label: `molgpu:scan:${name}`,
    });
    cache.set(name, result);
  }
  return result;
}

/** Allocates a transient buffer the caller destroys after submission. */
export type MakeBuffer = (
  size: number,
  usage: number,
  label: string,
  initial?: ArrayBufferView,
) => GPUBuffer;

const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;
const UNIFORM = 0x0040;
const STORAGE = 0x0080;

/** Dispatch `groups` workgroups, folded into y past the per-dimension limit. */
export function dispatchFolded(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  groups: number,
): void {
  const x = Math.min(groups, device.limits.maxComputeWorkgroupsPerDimension);
  pass.dispatchWorkgroups(x, Math.ceil(groups / x));
}

/**
 * Encode an exclusive scan of `count` u32 values of `input` (atomic counters
 * when `atomic`), returning the offsets buffer: `offsets[i]` is the sum of
 * inputs before `i`. Scan one extra zero to get the total at `offsets[count-1]`.
 */
export function encodeExclusiveScan(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  input: GPUBuffer,
  count: number,
  atomic: boolean,
  make: MakeBuffer,
): GPUBuffer {
  const bind = (name: Stage, entries: [number, GPUBuffer][]) =>
    device.createBindGroup({
      layout: pipeline(device, name).getBindGroupLayout(0),
      entries: entries.map(([binding, buffer]) => ({
        binding,
        resource: { buffer },
      })),
    });
  const params = (n: number) =>
    make(16, UNIFORM | COPY_DST, "scan-params", Uint32Array.of(n, 0, 0, 0));
  const levels: { offsets: GPUBuffer; count: number }[] = [];
  let source = input;
  let n = count;
  for (let first = true;; first = false) {
    const groups = Math.ceil(n / BLOCK);
    const offsets = make(n * 4, STORAGE | COPY_SRC, "scan-offsets");
    const sums = make(groups * 4, STORAGE, "scan-sums");
    const name = first && atomic ? "scanCounts" : "scanValues";
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline(device, name));
    pass.setBindGroup(
      0,
      bind(name, [[0, source], [1, offsets], [2, sums], [3, params(n)]]),
    );
    dispatchFolded(device, pass, groups);
    pass.end();
    levels.push({ offsets, count: n });
    if (groups === 1) break;
    source = sums;
    n = groups;
  }
  for (let level = levels.length - 2; level >= 0; level--) {
    const child = levels[level], parent = levels[level + 1];
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline(device, "addOffsets"));
    pass.setBindGroup(
      0,
      bind("addOffsets", [
        [0, child.offsets],
        [1, parent.offsets],
        [2, params(child.count)],
      ]),
    );
    dispatchFolded(device, pass, Math.ceil(child.count / BLOCK));
    pass.end();
  }
  return levels[0].offsets;
}
