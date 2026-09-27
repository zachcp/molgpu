import type { Topology } from "@molgpu/table";

type Vec3 = readonly [number, number, number];
type Box = { matrix: number[]; inverse: number[]; inverseNorm: number };

/** Explicit failure when an exact triclinic nearest-image search is too wide. */
export class PbcSearchLimitError extends RangeError {
  constructor(candidates: number, limit: number) {
    super(
      `nearest-image search needs ${candidates} candidates, limit ${limit}`,
    );
    this.name = "PbcSearchLimitError";
  }
}

function prepareBox(input: ArrayLike<number>): Box {
  if (input.length !== 9) {
    throw new RangeError("box needs nine column-major values");
  }
  const m = Array.from(input);
  if (m.some((x) => !Number.isFinite(x))) {
    throw new RangeError("box values must be finite");
  }
  const [a, d, g, b, e, h, c, f, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) +
    c * (d * h - e * g);
  const norm = Math.hypot(...m);
  if (
    !Number.isFinite(det) || norm === 0 ||
    Math.abs(det) <= 1e-10 * (norm / Math.sqrt(3)) ** 3
  ) {
    throw new RangeError("box is singular or nearly singular");
  }
  const inverse = [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  const inverseNorm = Math.hypot(...inverse);
  if (!Number.isFinite(inverseNorm) || norm * inverseNorm > 1e7) {
    throw new RangeError("box is singular or nearly singular");
  }
  return { matrix: m, inverse, inverseNorm };
}

function multiply(m: number[], v: Vec3, columns = false): Vec3 {
  return columns
    ? [
      m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
      m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
      m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
    ]
    : [
      m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
      m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
      m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
}

function nearest(delta: Vec3, box: Box, limit: number): Vec3 {
  const fractional = multiply(box.inverse, delta);
  const seed = fractional.map(Math.round) as [number, number, number];
  let best: Vec3 = delta;
  let shift: Vec3 = seed;
  let bestSquared = Infinity;
  const trial = (candidate: Vec3) => {
    const lattice = multiply(box.matrix, candidate, true);
    const residual: Vec3 = [
      delta[0] - lattice[0],
      delta[1] - lattice[1],
      delta[2] - lattice[2],
    ];
    const squared = residual[0] ** 2 + residual[1] ** 2 + residual[2] ** 2;
    const eps = 1e-12 * Math.max(bestSquared, squared, 1e-30);
    if (
      bestSquared === Infinity || squared < bestSquared - eps ||
      (Math.abs(squared - bestSquared) <= eps &&
        (candidate[0] < shift[0] ||
          (candidate[0] === shift[0] &&
            (candidate[1] < shift[1] ||
              (candidate[1] === shift[1] && candidate[2] < shift[2])))))
    ) {
      best = residual;
      shift = candidate;
      bestSquared = squared;
    }
  };
  // Tighten the radius before the exhaustive search; this does not determine
  // correctness, which follows from the inverse-norm bound below.
  for (let x = seed[0] - 1; x <= seed[0] + 1; x++) {
    for (let y = seed[1] - 1; y <= seed[1] + 1; y++) {
      for (let z = seed[2] - 1; z <= seed[2] + 1; z++) trial([x, y, z]);
    }
  }
  const radius = Math.sqrt(bestSquared) * box.inverseNorm + 1e-9;
  const low = fractional.map((x) => Math.ceil(x - radius));
  const high = fractional.map((x) => Math.floor(x + radius));
  const count = (high[0] - low[0] + 1) *
    (high[1] - low[1] + 1) * (high[2] - low[2] + 1);
  if (!Number.isSafeInteger(count) || count > limit) {
    throw new PbcSearchLimitError(count, limit);
  }
  for (let x = low[0]; x <= high[0]; x++) {
    for (let y = low[1]; y <= high[1]; y++) {
      for (let z = low[2]; z <= high[2]; z++) trial([x, y, z]);
    }
  }
  return best;
}

/** Nearest Cartesian lattice displacement, including for skew triclinic boxes. */
export function minimumImage(
  delta: ArrayLike<number>,
  box: ArrayLike<number>,
  maxCandidates: number = 100_000,
): readonly [number, number, number] {
  if (
    delta.length !== 3 || Array.from(delta).some((x) => !Number.isFinite(x))
  ) {
    throw new TypeError("delta needs three finite values");
  }
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    throw new TypeError("maxCandidates must be a positive safe integer");
  }
  return nearest(
    [delta[0], delta[1], delta[2]],
    prepareBox(box),
    maxCandidates,
  );
}

export interface UnwrapForest {
  readonly atomCount: number;
  /** -1 for component roots. */
  readonly parent: Int32Array;
  readonly order: Uint32Array;
  readonly component: Uint32Array;
  readonly roots: Uint32Array;
  /** Flat pairs of non-tree covalent edges. */
  readonly ringEdges: Uint32Array;
}

/** Deterministic, model/altloc-compatible covalent spanning forest. */
export function createUnwrapForest(topology: Topology): UnwrapForest {
  const { atoms, residues, chains, bonds } = topology;
  const n = atoms.count;
  const neighbours: number[][] = Array.from({ length: n }, () => []);
  const edges: number[][] = [];
  for (let k = 0; k < bonds.count; k++) {
    // An untyped bond cannot be assumed covalent (it may be metallic).
    if (!bonds.flags || !(bonds.flags[k] & 1)) continue;
    const a = bonds.a[k], b = bonds.b[k];
    if (a >= n || b >= n || a === b) continue;
    const modelA = chains.model[residues.chain[atoms.residue[a]]];
    const modelB = chains.model[residues.chain[atoms.residue[b]]];
    if (
      modelA !== modelB ||
      (atoms.altloc[a] && atoms.altloc[b] &&
        atoms.altloc[a] !== atoms.altloc[b])
    ) continue;
    neighbours[a].push(b);
    neighbours[b].push(a);
    edges.push([a, b]);
  }
  for (const list of neighbours) list.sort((a, b) => a - b);
  const parent = new Int32Array(n).fill(-2);
  const component = new Uint32Array(n);
  const order: number[] = [], roots: number[] = [];
  for (let root = 0; root < n; root++) {
    if (parent[root] !== -2) continue;
    const id = roots.length;
    roots.push(root);
    parent[root] = -1;
    component[root] = id;
    order.push(root);
    for (let head = order.length - 1; head < order.length; head++) {
      const row = order[head];
      for (const other of neighbours[row]) {
        if (parent[other] !== -2) continue;
        parent[other] = row;
        component[other] = id;
        order.push(other);
      }
    }
  }
  const ringEdges = edges.filter(([a, b]) => parent[a] !== b && parent[b] !== a)
    .flat();
  return Object.freeze({
    atomCount: n,
    parent,
    order: Uint32Array.from(order),
    component,
    roots: Uint32Array.from(roots),
    ringEdges: Uint32Array.from(ringEdges),
  });
}

export interface UnwrapResult {
  readonly positions: Float32Array;
  readonly status: "ok" | "ambiguous" | "missing-box" | "invalid-box";
  readonly ambiguousRingEdges: number;
}

/** Make each covalent component whole on one displayed frame, without history. */
export function unwrapFrame(
  positions: Float32Array,
  forest: UnwrapForest,
  box: ArrayLike<number> | null | undefined,
  centerRows?: ArrayLike<number> | null,
  maxCandidates: number = 100_000,
): UnwrapResult {
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1) {
    throw new TypeError("maxCandidates must be a positive safe integer");
  }
  if (positions.length !== forest.atomCount * 3) {
    throw new TypeError("positions must match forest atom count");
  }
  for (const value of positions) {
    if (!Number.isFinite(value)) {
      throw new TypeError("positions must be finite");
    }
  }
  const passthrough = (
    status: "missing-box" | "invalid-box",
  ): UnwrapResult => ({
    positions: positions.slice(),
    status,
    ambiguousRingEdges: 0,
  });
  if (!box) return passthrough("missing-box");
  let prepared: Box;
  try {
    prepared = prepareBox(box);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return passthrough("invalid-box");
  }
  const out = positions.slice();
  for (const row of forest.order) {
    const parent = forest.parent[row];
    if (parent < 0) continue;
    const delta: Vec3 = [
      positions[3 * row] - positions[3 * parent],
      positions[3 * row + 1] - positions[3 * parent + 1],
      positions[3 * row + 2] - positions[3 * parent + 2],
    ];
    const image = nearest(delta, prepared, maxCandidates);
    for (let k = 0; k < 3; k++) {
      out[3 * row + k] = out[3 * parent + k] + image[k];
    }
  }
  let ambiguousRingEdges = 0;
  for (let k = 0; k < forest.ringEdges.length; k += 2) {
    const a = forest.ringEdges[k], b = forest.ringEdges[k + 1];
    const delta: Vec3 = [
      positions[3 * b] - positions[3 * a],
      positions[3 * b + 1] - positions[3 * a + 1],
      positions[3 * b + 2] - positions[3 * a + 2],
    ];
    const image = nearest(delta, prepared, maxCandidates);
    if (
      Math.hypot(
        out[3 * b] - out[3 * a] - image[0],
        out[3 * b + 1] - out[3 * a + 1] - image[1],
        out[3 * b + 2] - out[3 * a + 2] - image[2],
      ) > 1e-3
    ) {
      ambiguousRingEdges++;
    }
  }
  if (centerRows) {
    const sums = Array.from({ length: forest.roots.length }, () => [0, 0, 0]);
    const counts = new Uint32Array(forest.roots.length);
    let previous = -1;
    for (let k = 0; k < centerRows.length; k++) {
      const row = centerRows[k];
      if (
        !Number.isInteger(row) || row <= previous || row >= forest.atomCount
      ) {
        throw new TypeError("center rows must be sorted, unique atom indices");
      }
      previous = row;
      const id = forest.component[row];
      counts[id]++;
      for (let axis = 0; axis < 3; axis++) {
        sums[id][axis] += out[3 * row + axis];
      }
    }
    const shifts = sums.map((sum, id): Vec3 => {
      if (!counts[id]) return [0, 0, 0];
      const centroid: Vec3 = [
        sum[0] / counts[id],
        sum[1] / counts[id],
        sum[2] / counts[id],
      ];
      const f = multiply(prepared.inverse, centroid);
      return multiply(prepared.matrix, [
        Math.floor(f[0]),
        Math.floor(f[1]),
        Math.floor(f[2]),
      ], true);
    });
    for (let row = 0; row < forest.atomCount; row++) {
      const shift = shifts[forest.component[row]];
      for (let axis = 0; axis < 3; axis++) out[3 * row + axis] -= shift[axis];
    }
  }
  return {
    positions: out,
    status: ambiguousRingEdges ? "ambiguous" : "ok",
    ambiguousRingEdges,
  };
}
