// BAOAB Langevin dynamics (Leimkuhler and Matthews, 2013) over a spring
// network, as the CPU reference for the WGSL integrator. Units: Å, ps, amu,
// kcal/mol, K. Forces are gathered per node over a CSR neighbour list. The
// velocities after each OU kick, and the tug force, are projected off the six
// rigid-body vectors of the reference, so the network neither drifts nor
// rotates.
import type { ElasticNetwork } from "./elastic-network.ts";
import { langevinNormals } from "./philox.ts";

/** (kcal/mol/Å) / amu in Å/ps². */
export const ACCELERATION_UNIT = 418.4;
/** Boltzmann constant in kcal/mol/K. */
export const BOLTZMANN = 0.0019872041;
/** Default node mass for residue-level (CA) guides, in amu. */
const RESIDUE_MASS = 110;

/** Springs as a symmetric CSR neighbour list: node i's neighbours are
 * `neighbours[offsets[i] .. offsets[i + 1])`, each with its rest length. */
export interface SpringNetwork {
  readonly nodeCount: number;
  readonly offsets: Uint32Array;
  readonly neighbours: Uint32Array;
  readonly restLength: Float32Array;
  /** Spring constant for every spring, kcal/mol/Å². */
  readonly k: number;
}

/**
 * Convert `buildElasticNetwork` contacts to a CSR spring network with both
 * directions stored, rest lengths measured at `positions` (atom-packed xyz,
 * the same array the network was built from).
 */
export function enmSprings(
  network: ElasticNetwork,
  positions: Float32Array,
  k = 1,
): SpringNetwork {
  if (!Number.isFinite(k) || k <= 0) {
    throw new TypeError("spring constant must be finite and positive");
  }
  const n = network.rows.length, edges = network.pairs.length / 2;
  const degree = new Uint32Array(n);
  for (let e = 0; e < edges; e++) {
    degree[network.pairs[2 * e]]++;
    degree[network.pairs[2 * e + 1]]++;
  }
  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + degree[i];
  const fill = offsets.slice(0, n);
  const neighbours = new Uint32Array(2 * edges);
  const restLength = new Float32Array(2 * edges);
  for (let e = 0; e < edges; e++) {
    const a = network.pairs[2 * e], b = network.pairs[2 * e + 1];
    const ra = 3 * network.rows[a], rb = 3 * network.rows[b];
    const length = Math.hypot(
      positions[rb] - positions[ra],
      positions[rb + 1] - positions[ra + 1],
      positions[rb + 2] - positions[ra + 2],
    );
    neighbours[fill[a]] = b;
    restLength[fill[a]++] = length;
    neighbours[fill[b]] = a;
    restLength[fill[b]++] = length;
  }
  // Ascending neighbour order per node makes the gather order canonical.
  for (let i = 0; i < n; i++) {
    const from = offsets[i], to = offsets[i + 1];
    const order = Array.from({ length: to - from }, (_, j) => from + j)
      .sort((x, y) => neighbours[x] - neighbours[y]);
    const ids = order.map((j) => neighbours[j]);
    const lengths = order.map((j) => restLength[j]);
    neighbours.set(ids, from);
    restLength.set(lengths, from);
  }
  return Object.freeze({ nodeCount: n, offsets, neighbours, restLength, k });
}

/** A validated network with the constants the integrator precomputes. */
export interface LangevinSystem {
  readonly springs: SpringNetwork;
  /** Reference node positions, packed xyz. Initial state and rigid frame. */
  readonly reference: Float32Array;
  readonly masses: Float32Array;
  readonly totalMass: number;
  /** Mass-weighted centroid of the reference. */
  readonly centroid: readonly [number, number, number];
  /** Reference positions relative to the centroid, packed xyz. */
  readonly relative: Float32Array;
  /** Inverse inertia tensor of the reference about its centroid, row-major. */
  readonly inertiaInverse: Float64Array;
  /** Gershgorin bound on the largest angular frequency, 1/ps. */
  readonly omegaMax: number;
}

/**
 * Validate a spring network with its reference node positions and masses
 * (default `RESIDUE_MASS` each). The reference must span three dimensions so
 * that its rigid-body rotations are defined.
 */
export function langevinSystem(
  springs: SpringNetwork,
  reference: Float32Array,
  masses?: Float32Array,
): LangevinSystem {
  const n = springs.nodeCount;
  if (
    !Number.isSafeInteger(n) || n < 3 || reference.length !== 3 * n ||
    springs.offsets.length !== n + 1 ||
    springs.offsets[n] !== springs.neighbours.length ||
    springs.restLength.length !== springs.neighbours.length ||
    !(springs.k > 0) || !Number.isFinite(springs.k)
  ) {
    throw new TypeError("spring network and reference sizes are invalid");
  }
  for (let i = 0; i < n; i++) {
    if (springs.offsets[i] > springs.offsets[i + 1]) {
      throw new TypeError("spring offsets must be nondecreasing");
    }
  }
  for (let j = 0; j < springs.neighbours.length; j++) {
    if (springs.neighbours[j] >= n || !(springs.restLength[j] > 0)) {
      throw new TypeError("spring neighbours or rest lengths are invalid");
    }
  }
  for (const value of reference) {
    if (!Number.isFinite(value)) {
      throw new TypeError("reference positions must be finite");
    }
  }
  const mass = masses ?? new Float32Array(n).fill(RESIDUE_MASS);
  if (mass.length !== n || mass.some((m) => !(m > 0) || !Number.isFinite(m))) {
    throw new TypeError("node masses must be finite and positive");
  }
  let total = 0, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    total += mass[i];
    cx += mass[i] * reference[3 * i];
    cy += mass[i] * reference[3 * i + 1];
    cz += mass[i] * reference[3 * i + 2];
  }
  cx /= total;
  cy /= total;
  cz /= total;
  const relative = new Float32Array(3 * n);
  const inertia = new Float64Array(9);
  for (let i = 0; i < n; i++) {
    const x = reference[3 * i] - cx,
      y = reference[3 * i + 1] - cy,
      z = reference[3 * i + 2] - cz;
    relative.set([x, y, z], 3 * i);
    const r = [x, y, z], r2 = x * x + y * y + z * z;
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        inertia[3 * a + b] += mass[i] * ((a === b ? r2 : 0) - r[a] * r[b]);
      }
    }
  }
  const inertiaInverse = invert3(inertia);
  let row = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = springs.offsets[i]; j < springs.offsets[i + 1]; j++) {
      sum += 1 / mass[i] + 1 / Math.sqrt(mass[i] * mass[springs.neighbours[j]]);
    }
    row = Math.max(row, springs.k * sum);
  }
  return Object.freeze({
    springs,
    reference,
    masses: mass,
    totalMass: total,
    centroid: [cx, cy, cz] as const,
    relative,
    inertiaInverse,
    omegaMax: Math.sqrt(ACCELERATION_UNIT * row),
  });
}

function invert3(m: Float64Array): Float64Array {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const trace = a + e + i;
  if (!(Math.abs(det) > 1e-9 * trace * trace * trace)) {
    throw new TypeError(
      "reference nodes are collinear; rigid-body rotations are undefined",
    );
  }
  return Float64Array.of(
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  );
}

/** A harmonic pull of one node towards `target` (upstream frame, Å). */
export interface LangevinTug {
  readonly node: number;
  readonly target: readonly [number, number, number];
  /** kcal/mol/Å². */
  readonly k: number;
}

export interface LangevinOptions {
  /** K, default 300. */
  readonly temperature?: number;
  /** Friction, 1/ps, default 1. */
  readonly gamma?: number;
  /** Time step, ps, default 0.02. */
  readonly dt?: number;
  /** u32 RNG seed, default 0. */
  readonly seed?: number;
  readonly tug?: LangevinTug;
}

/** Resolved integrator constants. */
export interface LangevinParams {
  readonly temperature: number;
  readonly gamma: number;
  readonly dt: number;
  readonly seed: number;
  /** exp(-gamma dt). */
  readonly c1: number;
  /** sqrt(1 - c1²) sqrt(418.4 kB T), Å/ps·√amu: divide by sqrt(m). */
  readonly noise: number;
  readonly tug?: LangevinTug;
}

/**
 * Resolve and check integrator constants. Throws a RangeError when the
 * Gershgorin frequency bound, including any tug spring, times dt exceeds 1
 * (BAOAB is stable below 2; the bound is about 2x loose on protein CA
 * networks).
 */
export function langevinParams(
  system: LangevinSystem,
  options: LangevinOptions = {},
): LangevinParams {
  const {
    temperature = 300,
    gamma = 1,
    dt = 0.02,
    seed = 0,
    tug,
  } = options;
  if (
    !(temperature >= 0) || !Number.isFinite(temperature) || !(gamma >= 0) ||
    !Number.isFinite(gamma) || !(dt > 0) || !Number.isFinite(dt) ||
    !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff
  ) {
    throw new TypeError("temperature, gamma, dt or seed is invalid");
  }
  let omega = system.omegaMax;
  if (tug) {
    if (
      !Number.isSafeInteger(tug.node) || tug.node < 0 ||
      tug.node >= system.springs.nodeCount || !(tug.k >= 0) ||
      !Number.isFinite(tug.k) || tug.target.length !== 3 ||
      tug.target.some((x) => !Number.isFinite(x))
    ) {
      throw new TypeError("tug node, target or k is invalid");
    }
    omega = Math.sqrt(
      omega * omega + ACCELERATION_UNIT * tug.k / system.masses[tug.node],
    );
  }
  if (omega * dt > 1) {
    throw new RangeError(
      `dt ${dt} ps exceeds 1/omegaMax (omegaMax ${
        omega.toFixed(3)
      }/ps); reduce dt, k or the cutoff, or raise the masses`,
    );
  }
  const c1 = Math.exp(-gamma * dt);
  const noise = Math.sqrt(1 - c1 * c1) *
    Math.sqrt(BOLTZMANN * temperature * ACCELERATION_UNIT);
  return Object.freeze({ temperature, gamma, dt, seed, c1, noise, tug });
}

/** Integrator state after `step` steps; x, v packed xyz, f in kcal/mol/Å. */
export interface LangevinState {
  step: number;
  readonly x: Float64Array | Float32Array;
  readonly v: Float64Array | Float32Array;
  readonly f: Float64Array | Float32Array;
}

export type LangevinPrecision = "f64" | "f32";

/** State at step 0: reference positions, zero velocity, forces computed. */
export function langevinInit(
  system: LangevinSystem,
  params: LangevinParams,
  precision: LangevinPrecision = "f64",
): LangevinState {
  const n = system.springs.nodeCount;
  const make = (length: number) =>
    precision === "f32" ? new Float32Array(length) : new Float64Array(length);
  const state = { step: 0, x: make(3 * n), v: make(3 * n), f: make(3 * n) };
  state.x.set(system.reference);
  forces(system, params, state);
  return state;
}

/** Spring forces plus the projected tug, written to `state.f`. */
function forces(
  system: LangevinSystem,
  params: LangevinParams,
  state: LangevinState,
): void {
  const { offsets, neighbours, restLength, k } = system.springs;
  const { x, f } = state;
  for (let i = 0; i < system.springs.nodeCount; i++) {
    let fx = 0, fy = 0, fz = 0;
    for (let j = offsets[i]; j < offsets[i + 1]; j++) {
      const o = 3 * neighbours[j];
      const dx = x[o] - x[3 * i],
        dy = x[o + 1] - x[3 * i + 1],
        dz = x[o + 2] - x[3 * i + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (length > 0) {
        const s = k * (length - restLength[j]) / length;
        fx += s * dx;
        fy += s * dy;
        fz += s * dz;
      }
    }
    f[3 * i] = fx;
    f[3 * i + 1] = fy;
    f[3 * i + 2] = fz;
  }
  const tug = params.tug;
  if (!tug || tug.k === 0) return;
  const p = tug.node;
  const F = [0, 1, 2].map((a) => -tug.k * (x[3 * p + a] - tug.target[a]));
  // Remove the tug's net force and torque about the reference centroid:
  // node i gets -m_i (F / M + omega x r_i) with omega = I^-1 (r_p x F).
  const rp = [0, 1, 2].map((a) => system.relative[3 * p + a]);
  const torque = cross(rp, F);
  const omega = apply3(system.inertiaInverse, torque);
  for (let i = 0; i < system.springs.nodeCount; i++) {
    const m = system.masses[i];
    const r = [0, 1, 2].map((a) => system.relative[3 * i + a]);
    const spin = cross(omega, r);
    for (let a = 0; a < 3; a++) {
      f[3 * i + a] += (i === p ? F[a] : 0) -
        m * (F[a] / system.totalMass + spin[a]);
    }
  }
}

function cross(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function apply3(m: ArrayLike<number>, v: ArrayLike<number>): number[] {
  return [0, 1, 2].map((r) =>
    m[3 * r] * v[0] + m[3 * r + 1] * v[1] + m[3 * r + 2] * v[2]
  );
}

/**
 * Advance `count` BAOAB steps in place. Step n draws its noise from Philox
 * key (seed, n), so the state after n steps depends only on (system, params,
 * n), when starting from `langevinInit` and keeping parameters unchanged.
 * Continuing an arbitrary state also depends on that state. After the
 * Ornstein–Uhlenbeck thermostat kick, the velocities lose their net momentum and their
 * angular momentum about the reference centroid (a mass-weighted projection
 * off the six linearised rigid-body vectors), so the linear rigid-body
 * components of the displacement stay at zero.
 */
export function langevinStep(
  system: LangevinSystem,
  params: LangevinParams,
  state: LangevinState,
  count = 1,
): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError("step count must be a nonnegative integer");
  }
  const n = system.springs.nodeCount, { x, v, f } = state;
  const half = 0.5 * params.dt, scale = ACCELERATION_UNIT;
  for (let s = 0; s < count; s++) {
    // B, A and O; then the rigid-body moments of the new velocities.
    let px = 0, py = 0, pz = 0, lx = 0, ly = 0, lz = 0;
    const r = system.relative;
    for (let i = 0; i < n; i++) {
      const m = system.masses[i], inv = scale / m;
      const sigma = params.noise / Math.sqrt(m);
      const z = langevinNormals(params.seed, state.step >>> 0, i);
      for (let c = 0; c < 3; c++) {
        const j = 3 * i + c;
        v[j] += half * inv * f[j]; // B
        x[j] += half * v[j]; // A
        v[j] = params.c1 * v[j] + sigma * z[c]; // O
      }
      const vx = v[3 * i], vy = v[3 * i + 1], vz = v[3 * i + 2];
      px += m * vx;
      py += m * vy;
      pz += m * vz;
      lx += m * (r[3 * i + 1] * vz - r[3 * i + 2] * vy);
      ly += m * (r[3 * i + 2] * vx - r[3 * i] * vz);
      lz += m * (r[3 * i] * vy - r[3 * i + 1] * vx);
    }
    // Remove net momentum and angular momentum about the reference centroid,
    // then the second A.
    const a = [
      px / system.totalMass,
      py / system.totalMass,
      pz / system.totalMass,
    ];
    const omega = apply3(system.inertiaInverse, [lx, ly, lz]);
    for (let i = 0; i < n; i++) {
      const spin = cross(omega, [r[3 * i], r[3 * i + 1], r[3 * i + 2]]);
      for (let c = 0; c < 3; c++) {
        const j = 3 * i + c;
        v[j] -= a[c] + spin[c];
        x[j] += half * v[j]; // A
      }
    }
    forces(system, params, state);
    for (let i = 0; i < n; i++) {
      const inv = scale / system.masses[i];
      for (let c = 0; c < 3; c++) v[3 * i + c] += half * inv * f[3 * i + c]; // B
    }
    state.step++;
  }
}

/**
 * Instantaneous kinetic temperature over the 3N - 6 internal degrees of
 * freedom that the projected integrator thermalises, in K.
 */
export function kineticTemperature(
  system: LangevinSystem,
  state: LangevinState,
): number {
  let twiceKinetic = 0;
  for (let i = 0; i < system.springs.nodeCount; i++) {
    const m = system.masses[i];
    for (let c = 0; c < 3; c++) twiceKinetic += m * state.v[3 * i + c] ** 2;
  }
  const dof = 3 * system.springs.nodeCount - 6;
  return twiceKinetic / ACCELERATION_UNIT / (BOLTZMANN * dof);
}
