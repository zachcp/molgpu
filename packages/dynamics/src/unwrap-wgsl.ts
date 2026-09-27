/**
 * WGSL for the live PBC unwrap: make each covalent component whole on one
 * displayed frame, as `unwrapFrame` does on the CPU, in entry points run in
 * this order on one upstream generation:
 *
 * 1. `link` (one row per invocation): each non-root row stores the exact
 *    nearest Cartesian image of its displacement from its forest parent, and
 *    a pointer to that parent. Roots store zero and point at themselves.
 * 2. `propagate` visits each precomputed tree level in order and accumulates
 *    parent displacements in place. Forests deeper than 32 use `jump`
 *    pointer jumping in logarithmic rounds instead.
 * 3. `centerSums` (optional, one workgroup per centered component): the
 *    centroid of the component's center rows, then the lattice shift that
 *    moves it into the primary cell.
 * 4. `place` (one row per invocation): root position + displacement - shift.
 * 5. `rings` (one ring edge per invocation): counts non-tree covalent edges
 *    whose unwrapped vector differs from their nearest image by > 1e-3 Å.
 *
 * Bindings (group 0): 0 `positions` packed xyz f32 upstream; 1 `parent` i32
 * per row (-1 for roots); 2 `params` uniform (below); 3 `linksIn` and 4
 * `linksOut` vec4<u32> per row (xyz the displacement's f32 bits, w the
 * pointer; float bits ride in integer lanes so no GPU flushes them); 5
 * `ringEdges` u32 pairs; 6 `status` four atomic u32 (ambiguous ring edges,
 * searches over `maxCandidates`); 7 `output` packed xyz f32; 8 `component`
 * u32 per row; 9 `shifts` vec4 per component (cleared by the caller); 10
 * `centerStarts` u32 per centered component plus one; 11 `centerRows` u32;
 * 12 `centerComponents` u32 per centered component; 13 `levelRows` and
 * 14 `levelRange` provide the static level schedule.
 *
 * `params`: box columns `a`, `b`, `c` and inverse columns (fractional =
 * inverse · Cartesian) as vec4; then `atomCount`, `ringCount`,
 * `maxCandidates`, `centered` (u32); then `inverseNorm` (f32) and padding.
 * A search over `maxCandidates` keeps its best candidate so far and counts
 * in `status[1]`, where the CPU reference throws `PbcSearchLimitError`.
 */
export const unwrapWgsl: string = `
struct Params {
  a: vec4<f32>,
  b: vec4<f32>,
  c: vec4<f32>,
  inv0: vec4<f32>,
  inv1: vec4<f32>,
  inv2: vec4<f32>,
  atomCount: u32,
  ringCount: u32,
  maxCandidates: u32,
  centered: u32,
  inverseNorm: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};
@group(0) @binding(0) var<storage, read> positions: array<f32>;
@group(0) @binding(1) var<storage, read> parent: array<i32>;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read> linksIn: array<vec4<u32>>;
@group(0) @binding(4) var<storage, read_write> linksOut: array<vec4<u32>>;
@group(0) @binding(5) var<storage, read> ringEdges: array<u32>;
@group(0) @binding(6) var<storage, read_write> status: array<atomic<u32>, 4>;
@group(0) @binding(7) var<storage, read_write> output: array<f32>;
@group(0) @binding(8) var<storage, read> component: array<u32>;
@group(0) @binding(9) var<storage, read_write> shifts: array<vec4<f32>>;
@group(0) @binding(10) var<storage, read> centerStarts: array<u32>;
@group(0) @binding(11) var<storage, read> centerRows: array<u32>;
@group(0) @binding(12) var<storage, read> centerComponents: array<u32>;
@group(0) @binding(13) var<storage, read> levelRows: array<u32>;
@group(0) @binding(14) var<uniform> levelRange: vec4<u32>;

fn position(i: u32) -> vec3<f32> {
  return vec3<f32>(positions[i * 3u], positions[i * 3u + 1u],
    positions[i * 3u + 2u]);
}
fn pack(offset: vec3<f32>, pointer: u32) -> vec4<u32> {
  return vec4<u32>(bitcast<vec3<u32>>(offset), pointer);
}
fn offsetOf(link: vec4<u32>) -> vec3<f32> {
  return bitcast<vec3<f32>>(link.xyz);
}
fn boxMatrix() -> mat3x3<f32> {
  return mat3x3<f32>(params.a.xyz, params.b.xyz, params.c.xyz);
}
fn inverseMatrix() -> mat3x3<f32> {
  return mat3x3<f32>(params.inv0.xyz, params.inv1.xyz, params.inv2.xyz);
}

// Exact nearest Cartesian image: seed by fractional rounding, tighten on the
// 27 neighbouring cells, then search every lattice shift within the bound the
// inverse norm gives (as minimumImage does). Ties keep the lexicographically
// smallest shift.
struct Best { residual: vec3<f32>, shift: vec3<f32>, squared: f32 };
fn trial(delta: vec3<f32>, candidate: vec3<f32>, best: ptr<function, Best>) {
  let residual = delta - boxMatrix() * candidate;
  let squared = dot(residual, residual);
  let eps = 1e-6 * max(max((*best).squared, squared), 1e-30);
  let tie = abs(squared - (*best).squared) <= eps;
  let smaller = candidate.x < (*best).shift.x ||
    (candidate.x == (*best).shift.x && (candidate.y < (*best).shift.y ||
      (candidate.y == (*best).shift.y && candidate.z < (*best).shift.z)));
  if (squared < (*best).squared - eps || (tie && smaller)) {
    (*best).residual = residual;
    (*best).shift = candidate;
    (*best).squared = squared;
  }
}
fn nearest(delta: vec3<f32>) -> vec3<f32> {
  let fractional = inverseMatrix() * delta;
  let seed = round(fractional);
  var best = Best(delta, seed, 3.0e38);
  for (var x = -1.0; x <= 1.0; x += 1.0) {
    for (var y = -1.0; y <= 1.0; y += 1.0) {
      for (var z = -1.0; z <= 1.0; z += 1.0) {
        trial(delta, seed + vec3<f32>(x, y, z), &best);
      }
    }
  }
  let radius = sqrt(best.squared) * params.inverseNorm + 1e-4;
  let low = ceil(fractional - vec3<f32>(radius));
  let high = floor(fractional + vec3<f32>(radius));
  let span = high - low + vec3<f32>(1.0);
  if (span.x * span.y * span.z > f32(params.maxCandidates)) {
    atomicAdd(&status[1], 1u);
    return best.residual;
  }
  for (var x = low.x; x <= high.x; x += 1.0) {
    for (var y = low.y; y <= high.y; y += 1.0) {
      for (var z = low.z; z <= high.z; z += 1.0) {
        trial(delta, vec3<f32>(x, y, z), &best);
      }
    }
  }
  return best.residual;
}

@compute @workgroup_size(64)
fn link(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.atomCount) { return; }
  let up = parent[i];
  if (up < 0) {
    linksOut[i] = pack(vec3<f32>(0.0), i);
    return;
  }
  let p = u32(up);
  linksOut[i] = pack(nearest(position(i) - position(p)), p);
}

@compute @workgroup_size(64)
fn jump(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.atomCount) { return; }
  let mine = linksIn[i];
  let next = linksIn[mine.w];
  linksOut[i] = pack(offsetOf(mine) + offsetOf(next), next.w);
}

// Parent rows are complete before their children's level is dispatched.
// Every edge is accumulated once, in place; the schedule depends only on the
// forest and is uploaded once rather than rebuilt for each frame.
@compute @workgroup_size(64)
fn propagate(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= levelRange.y) { return; }
  let i = levelRows[levelRange.x + id.x];
  let mine = linksOut[i];
  let up = linksOut[mine.w];
  linksOut[i] = pack(offsetOf(mine) + offsetOf(up), up.w);
}

var<workgroup> partial: array<vec4<f32>, 64>;

@compute @workgroup_size(64)
fn centerSums(
  @builtin(workgroup_id) group: vec3<u32>,
  @builtin(num_workgroups) groups: vec3<u32>,
  @builtin(local_invocation_index) lane: u32,
) {
  let k = group.x + group.y * groups.x;
  let inRange = k < params.centered;
  var sum = vec3<f32>(0.0);
  var root = vec3<f32>(0.0);
  var count = 0.0;
  if (inRange) {
    let start = centerStarts[k];
    let end = centerStarts[k + 1u];
    // Every row of a component shares its root; average displacements from
    // it, which keeps the sum small for components far from the origin.
    root = position(linksIn[centerRows[start]].w);
    for (var j = start + lane; j < end; j += 64u) {
      sum += offsetOf(linksIn[centerRows[j]]);
    }
    count = f32(end - start);
  }
  partial[lane] = vec4<f32>(sum, 0.0);
  workgroupBarrier();
  for (var stride = 32u; stride > 0u; stride /= 2u) {
    if (lane < stride) { partial[lane] += partial[lane + stride]; }
    workgroupBarrier();
  }
  if (lane == 0u && inRange) {
    let centroid = root + partial[0].xyz / count;
    let cell = floor(inverseMatrix() * centroid);
    shifts[centerComponents[k]] = vec4<f32>(boxMatrix() * cell, 0.0);
  }
}

@compute @workgroup_size(64)
fn place(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.atomCount) { return; }
  let link = linksIn[i];
  let q = (position(link.w) + offsetOf(link)) - shifts[component[i]].xyz;
  output[i * 3u] = q.x;
  output[i * 3u + 1u] = q.y;
  output[i * 3u + 2u] = q.z;
}

@compute @workgroup_size(64)
fn rings(@builtin(global_invocation_id) id: vec3<u32>) {
  let k = id.x;
  if (k >= params.ringCount) { return; }
  let a = ringEdges[k * 2u];
  let b = ringEdges[k * 2u + 1u];
  // Both ends share a root, so their displacements are directly comparable.
  let unwrapped = offsetOf(linksIn[b]) - offsetOf(linksIn[a]);
  let image = nearest(position(b) - position(a));
  if (length(unwrapped - image) > 1e-3) { atomicAdd(&status[0], 1u); }
}
`;

/** Bytes per row of each `unwrapWgsl` link buffer (vec4). */
export const UNWRAP_LINK_BYTES = 16;
/** Bytes of the `unwrapWgsl` uniform `params`. */
export const UNWRAP_PARAMS_BYTES = 128;
