// WGSL for the BAOAB Langevin integrator in langevin.ts, plus the plain-data
// buffer packing a caller uploads. Strings and typed arrays only; the viewer
// owns devices, pipelines and dispatch.
import {
  ACCELERATION_UNIT,
  type LangevinParams,
  type LangevinSystem,
} from "./langevin.ts";
import { philoxWgsl } from "./philox.ts";

/** Invocations per workgroup in every `langevinWgsl` entry point. */
export const LANGEVIN_WORKGROUP = 64;
/** Bytes of the `Params` uniform (binding 0). */
export const LANGEVIN_PARAMS_BYTES = 112;
/** Leading floats of the scratch buffer that hold the finished moments. */
const MOMENTS = 8;
const NO_TUG = 0xffffffff;

/** Typed arrays for the storage bindings of `langevinWgsl`. */
export interface LangevinBuffers {
  /** Binding 2: per node (relative x, y, z, mass). */
  readonly nodes: Float32Array;
  /** Binding 3: offsets (nodeCount + 1) followed by neighbours. */
  readonly csr: Uint32Array;
  /** Binding 4: rest length per neighbour entry. */
  readonly restLength: Float32Array;
  /** Binding 1 at step 0: x = reference, v = f = 0; run `langevinForces`
   * once before the first step. x is [0, 3n), v [3n, 6n), f [6n, 9n). */
  readonly state: Float32Array;
  /** Floats in binding 5 (moments, then per-workgroup partials). */
  readonly scratchFloats: number;
  /** Workgroups for the per-node entries. */
  readonly workgroups: number;
}

/** Pack a system for upload. Binding 6 is a one-u32 step clock. */
export function langevinBuffers(system: LangevinSystem): LangevinBuffers {
  const n = system.springs.nodeCount;
  const nodes = new Float32Array(4 * n);
  for (let i = 0; i < n; i++) {
    nodes[4 * i] = system.relative[3 * i];
    nodes[4 * i + 1] = system.relative[3 * i + 1];
    nodes[4 * i + 2] = system.relative[3 * i + 2];
    nodes[4 * i + 3] = system.masses[i];
  }
  const { offsets, neighbours, restLength } = system.springs;
  const csr = new Uint32Array(offsets.length + neighbours.length);
  csr.set(offsets);
  csr.set(neighbours, offsets.length);
  const state = new Float32Array(9 * n);
  state.set(system.reference);
  const workgroups = Math.ceil(n / LANGEVIN_WORKGROUP);
  return Object.freeze({
    nodes,
    csr,
    restLength,
    state,
    scratchFloats: MOMENTS + 6 * workgroups,
    workgroups,
  });
}

/** The `Params` uniform for one system and parameter set. */
export function langevinUniform(
  system: LangevinSystem,
  params: LangevinParams,
): ArrayBuffer {
  const buffer = new ArrayBuffer(LANGEVIN_PARAMS_BYTES);
  const u32 = new Uint32Array(buffer), f32 = new Float32Array(buffer);
  u32[0] = system.springs.nodeCount;
  u32[1] = params.seed;
  u32[2] = Math.ceil(system.springs.nodeCount / LANGEVIN_WORKGROUP);
  u32[3] = params.tug && params.tug.k > 0 ? params.tug.node : NO_TUG;
  f32[4] = 0.5 * params.dt;
  f32[5] = params.c1;
  f32[6] = params.noise;
  f32[7] = system.springs.k;
  f32[8] = system.totalMass;
  f32[9] = params.tug?.k ?? 0;
  if (params.tug) f32.set(params.tug.target, 12);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      f32[16 + 4 * row + col] = system.inertiaInverse[3 * row + col];
    }
  }
  return buffer;
}

/**
 * One BAOAB step is four dispatches, each over `workgroups` except the
 * single-workgroup finish:
 *
 * 1. `langevinBao`: B, A and O per node (noise from Philox key (seed, clock)),
 *    then per-workgroup sums of the new velocities' momentum and angular
 *    momentum about the reference centroid.
 * 2. `langevinFinish` (one workgroup): totals in a fixed order, then the
 *    rigid-body velocity to remove.
 * 3. `langevinDrift`: remove it and apply the second A.
 * 4. `langevinForcesKick`: spring forces plus the projected tug, the final B,
 *    and the clock advances by one.
 *
 * `langevinForces` computes forces only, once before the first step and after
 * any restore of positions. Every reduction has a fixed order, so a device
 * reproduces a run bitwise.
 *
 * Bindings (group 0): 0 `Params` uniform; 1 state (x, v, f; read_write);
 * 2 nodes (read); 3 csr (read); 4 rest lengths (read); 5 scratch
 * (read_write); 6 clock (read_write).
 */
export const langevinWgsl: string = `
${philoxWgsl}

struct Params {
  nodeCount: u32,
  seed: u32,
  partialCount: u32,
  tugNode: u32,
  halfDt: f32,
  c1: f32,
  noise: f32,
  springK: f32,
  totalMass: f32,
  tugK: f32,
  pad0: f32,
  pad1: f32,
  tugTarget: vec4<f32>,
  inertia0: vec4<f32>,
  inertia1: vec4<f32>,
  inertia2: vec4<f32>,
};

const ACCEL: f32 = ${ACCELERATION_UNIT};
const MOMENTS: u32 = ${MOMENTS}u;
const WG: u32 = ${LANGEVIN_WORKGROUP}u;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> state: array<f32>;
@group(0) @binding(2) var<storage, read> nodes: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> csr: array<u32>;
@group(0) @binding(4) var<storage, read> rest: array<f32>;
@group(0) @binding(5) var<storage, read_write> scratch: array<f32>;
@group(0) @binding(6) var<storage, read_write> clock: array<u32>;

var<workgroup> partial: array<f32, ${6 * LANGEVIN_WORKGROUP}>;

fn getX(i: u32) -> vec3<f32> {
  return vec3<f32>(state[3u * i], state[3u * i + 1u], state[3u * i + 2u]);
}
fn getV(i: u32) -> vec3<f32> {
  let o = 3u * params.nodeCount + 3u * i;
  return vec3<f32>(state[o], state[o + 1u], state[o + 2u]);
}
fn getF(i: u32) -> vec3<f32> {
  let o = 6u * params.nodeCount + 3u * i;
  return vec3<f32>(state[o], state[o + 1u], state[o + 2u]);
}
fn setX(i: u32, x: vec3<f32>) {
  state[3u * i] = x.x; state[3u * i + 1u] = x.y; state[3u * i + 2u] = x.z;
}
fn setV(i: u32, v: vec3<f32>) {
  let o = 3u * params.nodeCount + 3u * i;
  state[o] = v.x; state[o + 1u] = v.y; state[o + 2u] = v.z;
}
fn setF(i: u32, f: vec3<f32>) {
  let o = 6u * params.nodeCount + 3u * i;
  state[o] = f.x; state[o + 1u] = f.y; state[o + 2u] = f.z;
}
fn inertiaInverse(v: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    dot(params.inertia0.xyz, v),
    dot(params.inertia1.xyz, v),
    dot(params.inertia2.xyz, v),
  );
}

// Fixed-order tree over the workgroup's six partial sums; uniform control flow.
fn reduceWorkgroup(lid: u32) {
  for (var stride = WG / 2u; stride > 0u; stride = stride / 2u) {
    workgroupBarrier();
    if (lid < stride) {
      for (var c = 0u; c < 6u; c++) {
        partial[6u * lid + c] = partial[6u * lid + c] + partial[6u * (lid + stride) + c];
      }
    }
  }
  workgroupBarrier();
}

@compute @workgroup_size(${LANGEVIN_WORKGROUP})
fn langevinBao(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
  @builtin(workgroup_id) wid: vec3<u32>,
) {
  let i = gid.x;
  var p = vec3<f32>(0.0);
  var l = vec3<f32>(0.0);
  if (i < params.nodeCount) {
    let node = nodes[i];
    let m = node.w;
    var v = getV(i) + params.halfDt * (ACCEL / m) * getF(i);
    let x = getX(i) + params.halfDt * v;
    let z = langevinNormals(params.seed, clock[0], i);
    v = params.c1 * v + (params.noise / sqrt(m)) * z;
    setX(i, x);
    setV(i, v);
    p = m * v;
    l = m * cross(node.xyz, v);
  }
  partial[6u * lid.x] = p.x;
  partial[6u * lid.x + 1u] = p.y;
  partial[6u * lid.x + 2u] = p.z;
  partial[6u * lid.x + 3u] = l.x;
  partial[6u * lid.x + 4u] = l.y;
  partial[6u * lid.x + 5u] = l.z;
  reduceWorkgroup(lid.x);
  if (lid.x == 0u) {
    for (var c = 0u; c < 6u; c++) {
      scratch[MOMENTS + 6u * wid.x + c] = partial[c];
    }
  }
}

@compute @workgroup_size(${LANGEVIN_WORKGROUP})
fn langevinFinish(@builtin(local_invocation_id) lid: vec3<u32>) {
  var sums = array<f32, 6>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  for (var g = lid.x; g < params.partialCount; g += WG) {
    for (var c = 0u; c < 6u; c++) {
      sums[c] = sums[c] + scratch[MOMENTS + 6u * g + c];
    }
  }
  for (var c = 0u; c < 6u; c++) {
    partial[6u * lid.x + c] = sums[c];
  }
  reduceWorkgroup(lid.x);
  if (lid.x == 0u) {
    let a = vec3<f32>(partial[0], partial[1], partial[2]) / params.totalMass;
    let w = inertiaInverse(vec3<f32>(partial[3], partial[4], partial[5]));
    scratch[0] = a.x; scratch[1] = a.y; scratch[2] = a.z;
    scratch[3] = w.x; scratch[4] = w.y; scratch[5] = w.z;
  }
}

@compute @workgroup_size(${LANGEVIN_WORKGROUP})
fn langevinDrift(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.nodeCount) { return; }
  let a = vec3<f32>(scratch[0], scratch[1], scratch[2]);
  let w = vec3<f32>(scratch[3], scratch[4], scratch[5]);
  let v = getV(i) - (a + cross(w, nodes[i].xyz));
  setV(i, v);
  setX(i, getX(i) + params.halfDt * v);
}

fn force(i: u32) -> vec3<f32> {
  let xi = getX(i);
  var f = vec3<f32>(0.0);
  let n1 = params.nodeCount + 1u;
  for (var j = csr[i]; j < csr[i + 1u]; j++) {
    let d = getX(csr[n1 + j]) - xi;
    let len = length(d);
    if (len > 0.0) {
      f = f + (params.springK * (len - rest[j]) / len) * d;
    }
  }
  if (params.tugNode != 0xffffffffu) {
    let p = params.tugNode;
    let pull = -params.tugK * (getX(p) - params.tugTarget.xyz);
    let w = inertiaInverse(cross(nodes[p].xyz, pull));
    let node = nodes[i];
    f = f - node.w * (pull / params.totalMass + cross(w, node.xyz));
    if (i == p) { f = f + pull; }
  }
  return f;
}

@compute @workgroup_size(${LANGEVIN_WORKGROUP})
fn langevinForces(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= params.nodeCount) { return; }
  setF(i, force(i));
}

@compute @workgroup_size(${LANGEVIN_WORKGROUP})
fn langevinForcesKick(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i == 0u) { clock[0] = clock[0] + 1u; }
  if (i >= params.nodeCount) { return; }
  let f = force(i);
  setF(i, f);
  setV(i, getV(i) + params.halfDt * (ACCEL / nodes[i].w) * f);
}
`;
