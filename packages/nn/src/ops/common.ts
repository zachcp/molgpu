// WGSL shared by every kernel: the 32-byte parameter block (eight u32 slots;
// f32 values travel as bits) and the flat thread
// index of a 2-D dispatch (the runtime folds large grids into y to stay under
// the 65535-workgroup limit per dimension).

export const WORKGROUP = 64;
/** Parameter slots per dispatch. */
export const PARAM_SLOTS = 8;

export const PRELUDE_WGSL = /* wgsl */ `
struct Params { a: u32, b: u32, c: u32, d: u32, e: u32, f: u32, g: u32, h: u32 }
@group(0) @binding(0) var<uniform> params: Params;
fn thread_index(g: vec3<u32>, n: vec3<u32>) -> u32 {
  return g.x + g.y * n.x * ${WORKGROUP}u;
}
`;

export const ENTRY_WGSL = /* wgsl */ `@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) n: vec3<u32>)`;
