// Copies packed f32 positions storage-to-storage. use.gpu RawData buffers are
// STORAGE|COPY_DST (no COPY_SRC), so freezing a coordinate generation before
// an asynchronous readback needs a compute copy instead of copyBufferToBuffer.
export const COPY_POSITIONS = `
struct Params { count: u32, pad0: u32, pad1: u32, pad2: u32 };
@group(0) @binding(0) var<storage, read> input: array<f32>;
@group(0) @binding(1) var<storage, read_write> output: array<f32>;
@group(0) @binding(2) var<uniform> params: Params;
@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
) {
  // Grid-stride: one dimension covers any atom count within the group limit.
  for (var i = id.x; i < params.count; i += groups.x * 64u) {
    output[i] = input[i];
  }
}`;
