// GPU stages for Mol* compatible DSSP. Coordinates are packed xyz. Each
// descriptor is three vec4<i32> records from prepareDsspLayout. The cell list
// is the Phase 13 count/scan/scatter index over gathered CA positions.
const COMMON = `
struct Descriptor {
  backbone: vec4<i32>, // N, CA, C, O
  hydrogen: vec4<i32>, // H, previous C, previous O, OXT
  unit: vec4<i32>,     // start, end, global residue, unit ID
};
struct Params {
  count: u32,
  maxBridges: u32,
  dimX: u32,
  dimY: u32,
  dimZ: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
  origin: vec4<f32>,
  scale: vec4<f32>,
};
@group(0) @binding(7) var<uniform> params: Params;
fn point(P: ptr<storage, array<f32>, read>, row: i32) -> vec3<f32> {
  let i = u32(row) * 3u;
  return vec3<f32>((*P)[i], (*P)[i + 1u], (*P)[i + 2u]);
}
fn separation(a: vec3<f32>, b: vec3<f32>) -> f32 {
  let d = a - b;
  return sqrt(dot(d, d));
}
`;

const GATHER = `${COMMON}
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> descriptors: array<Descriptor>;
@group(0) @binding(2) var<storage, read_write> ca: array<f32>;
@group(0) @binding(3) var<storage, read_write> h: array<vec4<f32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.count) { return; }
  let d = descriptors[i];
  if (d.backbone.y >= 0) {
    let p = point(&positions, d.backbone.y);
    ca[i * 3u] = p.x;
    ca[i * 3u + 1u] = p.y;
    ca[i * 3u + 2u] = p.z;
  }
  if (d.backbone.x < 0) { h[i] = vec4<f32>(0.0); return; }
  if (d.hydrogen.x >= 0) {
    h[i] = vec4<f32>(point(&positions, d.hydrogen.x), 1.0);
  } else if (d.hydrogen.y >= 0 && d.hydrogen.z >= 0) {
    let c = point(&positions, d.hydrogen.y);
    let o = point(&positions, d.hydrogen.z);
    h[i] = vec4<f32>(point(&positions, d.backbone.x) +
      (c - o) / separation(c, o), 1.0);
  } else {
    h[i] = vec4<f32>(0.0);
  }
}`;

const HBONDS = `${COMMON}
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> descriptors: array<Descriptor>;
@group(0) @binding(2) var<storage, read> ca: array<f32>;
@group(0) @binding(3) var<storage, read> h: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> offsets: array<u32>;
@group(0) @binding(5) var<storage, read> sorted: array<u32>;
@group(0) @binding(6) var<storage, read_write> bonds: array<u32>;
@group(0) @binding(8) var<storage, read_write> state: array<atomic<u32>>;
fn cap(i: u32) -> vec3<f32> {
  return vec3<f32>(ca[i * 3u], ca[i * 3u + 1u], ca[i * 3u + 2u]);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.count) { return; }
  let d = descriptors[i];
  let base = i * 9u;
  bonds[base] = 0u;
  if (d.backbone.y < 0 || d.backbone.z < 0 || d.backbone.w < 0 ||
      d.hydrogen.w != 0) { return; }
  let p = cap(i);
  let grid = vec3<i32>(floor((p - params.origin.xyz) * params.scale.x));
  let o = point(&positions, d.backbone.w);
  let c = point(&positions, d.backbone.z);
  var donors: array<u32, 8>;
  var found = 0u;
  var visited = 0u;
  var near = false;
  for (var z = max(0, grid.z - 1); z <= min(i32(params.dimZ) - 1, grid.z + 1); z++) {
    for (var y = max(0, grid.y - 1); y <= min(i32(params.dimY) - 1, grid.y + 1); y++) {
      for (var x = max(0, grid.x - 1); x <= min(i32(params.dimX) - 1, grid.x + 1); x++) {
        let cell = u32(x) + params.dimX * (u32(y) + params.dimY * u32(z));
        let begin = offsets[cell];
        let end = offsets[cell + 1u];
        if (end - begin > 4096u - min(visited, 4096u)) {
          atomicStore(&state[3], 1u);
          return;
        }
        visited += end - begin;
        for (var slot = begin; slot < end; slot++) {
          let j = sorted[slot];
          if (j == i || j + 1u == i || i + 1u == j) { continue; }
          let donor = descriptors[j];
          if (donor.unit.w != d.unit.w || donor.backbone.x < 0 || h[j].w == 0.0) { continue; }
          let distance = separation(cap(j), p);
          if (abs(distance - 9.0) <= 0.0001) { near = true; }
          if (distance > 9.0) { continue; }
          let hp = h[j].xyz;
          let n = point(&positions, donor.backbone.x);
          let e1 = -27.888 / separation(o, hp) - -27.888 / separation(c, hp);
          let e2 = -27.888 / separation(c, n) - -27.888 / separation(o, n);
          let energy = max(-9.9, e1 + e2);
          if (abs(energy + 0.5) <= 0.0001) { near = true; }
          if (energy > -0.5) { continue; }
          if (found == 8u) { atomicStore(&state[1], 1u); continue; }
          var at = found;
          while (at > 0u && donors[at - 1u] > j) {
            donors[at] = donors[at - 1u];
            at--;
          }
          donors[at] = j;
          found++;
        }
      }
    }
  }
  bonds[base] = found | select(0u, 0x80000000u, near);
  for (var k = 0u; k < found; k++) { bonds[base + k + 1u] = donors[k]; }
}`;

const BOND_COMMON = `
@group(0) @binding(0) var<storage, read> descriptors: array<Descriptor>;
@group(0) @binding(1) var<storage, read> bonds: array<u32>;
${COMMON}
fn has(i: i32, j: i32) -> bool {
  if (i < 0 || i >= i32(params.count)) { return false; }
  let d = descriptors[u32(i)];
  if (j < d.unit.x || j >= d.unit.y) { return false; }
  let base = u32(i) * 9u;
  let count = bonds[base] & 255u;
  for (var k = 0u; k < count; k++) {
    if (bonds[base + 1u + k] == u32(j)) { return true; }
  }
  return false;
}
`;

const TURNS = `${BOND_COMMON}
@group(0) @binding(2) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = i32(id.x);
  if (id.x >= params.count) { return; }
  let d = descriptors[id.x];
  var flags = bonds[id.x * 9u] & 0x80000000u;
  for (var n = 3i; n <= 5i; n++) {
    let turn = 1u << u32(n + 4);
    let start = 1u << u32(n + 7);
    if (i + n < d.unit.y && has(i, i + n)) { flags |= turn | start; }
    for (var k = 1i; k < n; k++) {
      if (i - k >= d.unit.x && has(i - k, i - k + n)) {
        flags |= turn | 64u;
      }
    }
  }
  output[id.x] = flags;
}`;

const HELIX = `${COMMON}
@group(0) @binding(0) var<storage, read> descriptors: array<Descriptor>;
@group(0) @binding(1) var<storage, read> input: array<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<u32>;
fn helix(i: u32, n: i32, code: u32) {
  if (i >= params.count) { return; }
  let d = descriptors[i];
  var flags = input[i];
  let index = i32(i);
  let turn = 1u << u32(n + 4);
  let start = 1u << u32(n + 7);
  for (var s = max(d.unit.x + 1, index - n + 1); s <= min(index, d.unit.y - n - 1); s++) {
    let f = input[u32(s)];
    let prev = input[u32(s - 1)];
    let following = input[u32(s + 1)];
    if (n == 3 && ((f | following) & 1u) != 0u) { continue; }
    if (n == 5 && ((f | following) & 9u) != 0u) { continue; }
    if ((f & (turn | start)) == (turn | start) &&
        (prev & (turn | start)) == (turn | start)) { flags |= code; }
  }
  output[i] = flags;
}
@compute @workgroup_size(64)
fn alpha(@builtin(global_invocation_id) id: vec3<u32>) { helix(id.x, 4, 1u); }
@compute @workgroup_size(64)
fn threeTen(@builtin(global_invocation_id) id: vec3<u32>) { helix(id.x, 3, 8u); }
@compute @workgroup_size(64)
fn pi(@builtin(global_invocation_id) id: vec3<u32>) { helix(id.x, 5, 16u); }
`;

const BENDS = `${COMMON}
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> descriptors: array<Descriptor>;
@group(0) @binding(2) var<storage, read> input: array<u32>;
@group(0) @binding(3) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = i32(id.x);
  if (id.x >= params.count) { return; }
  var f = input[id.x];
  let d = descriptors[id.x];
  if (i < d.unit.x + 2 || i >= d.unit.y - 2) { output[id.x] = f; return; }
  var peptide = true;
  for (var k = -2i; k < 2i; k++) {
    let ca = descriptors[u32(i + k)].backbone.y;
    let n = descriptors[u32(i + k + 1)].backbone.x;
    if (ca >= 0 && n >= 0) {
      let delta = point(&positions, ca) - point(&positions, n);
      let distance = sqrt(dot(delta, delta));
      if (abs(distance - 2.5) <= 0.0001) { f |= 0x80000000u; }
      if (distance > 2.5) { peptide = false; }
    }
  }
  let left = descriptors[u32(i - 2)].backbone.y;
  let center = d.backbone.y;
  let right = descriptors[u32(i + 2)].backbone.y;
  if (peptide && left >= 0 && center >= 0 && right >= 0) {
    let p = point(&positions, center);
    let a = point(&positions, left) - p;
    let b = p - point(&positions, right);
    let denominator = sqrt(dot(a, a) * dot(b, b));
    let cosine = select(dot(a, b) / denominator, 0.0, denominator == 0.0);
    let angle = acos(clamp(cosine, -1.0, 1.0)) * (180.0 / 3.141592653589793);
    if (abs(angle - 70.0) <= 0.0001) { f |= 0x80000000u; }
    if (angle > 70.0) { f |= 32u; }
  }
  output[id.x] = f;
}`;

const BRIDGES = `${BOND_COMMON}
struct BridgeEntry {
  partner1: u32,
  partner2: u32,
  kind: u32,
  acceptor: u32,
  donor: u32,
  pattern: u32,
};
@group(0) @binding(2) var<storage, read_write> output: array<BridgeEntry>;
@group(0) @binding(3) var<storage, read_write> state: array<atomic<u32>>;
fn emit(a: i32, b: i32, kind: u32, acceptor: u32, donor: u32, pattern: u32) {
  let slot = atomicAdd(&state[0], 1u);
  if (slot >= params.maxBridges) { atomicStore(&state[2], 1u); return; }
  output[slot] = BridgeEntry(u32(min(a, b)), u32(max(a, b)),
    kind, acceptor, donor, pattern);
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let k = i32(id.x);
  if (id.x >= params.count) { return; }
  let d = descriptors[id.x];
  let base = id.x * 9u;
  let count = bonds[base] & 255u;
  for (var slot = 0u; slot < count; slot++) {
    let l = i32(bonds[base + slot + 1u]);
    if (k > l) { continue; }
    var i = k + 1;
    var j = l;
    if (i != j && i < d.unit.y && has(j, i + 1)) { emit(i, j, 0u, id.x, u32(l), 0u); }
    i = k; j = l - 1;
    if (i != j && j >= d.unit.x && has(j - 1, i)) { emit(i, j, 0u, id.x, u32(l), 1u); }
    i = k; j = l;
    if (i != j && has(j, i)) { emit(i, j, 1u, id.x, u32(l), 2u); }
    i = k + 1; j = l - 1;
    if (i != j && i < d.unit.y && j >= d.unit.x && has(j - 1, i + 1)) {
      emit(i, j, 1u, id.x, u32(l), 3u);
    }
  }
}`;

export const dsspWgsl: Readonly<{
  gather: string;
  hbonds: string;
  turns: string;
  helix: string;
  bends: string;
  bridges: string;
}> = Object.freeze({
  gather: GATHER,
  hbonds: HBONDS,
  turns: TURNS,
  helix: HELIX,
  bends: BENDS,
  bridges: BRIDGES,
});
