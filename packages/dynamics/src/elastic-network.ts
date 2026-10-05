import { spatialGrid } from "@molgpu/table";
import { lanczosModes } from "./lanczos.ts";

/** Sparse guide-node contacts shared by GNM and ANM. */
export interface ElasticNetwork {
  readonly rows: Uint32Array;
  readonly pairs: Uint32Array;
  readonly directions: Float32Array;
}

export interface ElasticMode {
  readonly kind: "gnm" | "anm";
  readonly eigenvalue: number;
  /** Scalar per node for GNM; packed xyz per node for ANM. */
  readonly vector: Float32Array;
  readonly residual: number;
}

/** Largest dimension `solveElasticModes` solves densely by default. */
export const MAX_ELASTIC_DIM = 192;

/** How `solveElasticModes` diagonalises the Hessian or Kirchhoff matrix. */
export interface ElasticSolveOptions {
  /**
   * `"dense"` uses Jacobi rotations, limited to 192 scalar dimensions; `"lanczos"` is
   * sparse and matrix-free. `"auto"` (the default) picks dense up to the
   * limit and Lanczos above it.
   */
  readonly method?: "auto" | "dense" | "lanczos";
  /** Lanczos basis vectors kept (default: about 320 MB of f64 basis). */
  readonly maxIterations?: number;
}

/** Build exact-cutoff CA/guide contacts using table.spatialGrid. */
export function buildElasticNetwork(
  positions: Float32Array,
  guideRows: ArrayLike<number>,
  cutoff: number,
  maxContacts: number = 1_000_000,
  maxCandidates: number = 4096,
): ElasticNetwork {
  if (
    positions.length % 3 !== 0 || !Number.isFinite(cutoff) || cutoff <= 0 ||
    !Number.isSafeInteger(maxContacts) || maxContacts < 1 ||
    !Number.isSafeInteger(maxCandidates) || maxCandidates < 1
  ) {
    throw new TypeError("elastic positions, cutoff or limits are invalid");
  }
  const atomCount = positions.length / 3;
  const rows = new Uint32Array(guideRows.length);
  const index = new Int32Array(atomCount).fill(-1);
  for (let node = 0; node < rows.length; node++) {
    const row = guideRows[node];
    if (
      !Number.isSafeInteger(row) || row < 0 || row >= atomCount ||
      (node > 0 && row <= rows[node - 1])
    ) {
      throw new TypeError("guide rows must be sorted, unique atom indices");
    }
    rows[node] = row;
    index[row] = node;
    for (let axis = 0; axis < 3; axis++) {
      if (!Number.isFinite(positions[3 * row + axis])) {
        throw new TypeError("guide coordinates must be finite");
      }
    }
  }
  const grid = spatialGrid(positions, rows, cutoff);
  const pairs: number[] = [], directions: number[] = [];
  const cutoff2 = cutoff * cutoff;
  for (let node = 0; node < rows.length; node++) {
    const row = rows[node], i = 3 * row;
    let visited = 0;
    grid.near(positions[i], positions[i + 1], positions[i + 2], (other) => {
      if (++visited > maxCandidates) {
        throw new RangeError("elastic contact query exceeds candidate cap");
      }
      const next = index[other];
      if (next <= node) return;
      const j = 3 * other;
      const dx = positions[j] - positions[i],
        dy = positions[j + 1] - positions[i + 1],
        dz = positions[j + 2] - positions[i + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > cutoff2 || d2 <= 1e-20) return;
      if (pairs.length / 2 >= maxContacts) {
        throw new RangeError("elastic network exceeds contact cap");
      }
      const inverse = 1 / Math.sqrt(d2);
      pairs.push(node, next);
      directions.push(dx * inverse, dy * inverse, dz * inverse);
    });
  }
  return Object.freeze({
    rows,
    pairs: Uint32Array.from(pairs),
    directions: Float32Array.from(directions),
  });
}

function hessian(network: ElasticNetwork, kind: "gnm" | "anm"): Float64Array {
  const n = network.rows.length, d = kind === "gnm" ? n : 3 * n;
  const matrix = new Float64Array(d * d);
  const add = (i: number, j: number, value: number) => {
    matrix[i * d + j] += value;
  };
  for (let edge = 0; edge < network.pairs.length / 2; edge++) {
    const a = network.pairs[2 * edge], b = network.pairs[2 * edge + 1];
    if (kind === "gnm") {
      add(a, a, 1);
      add(b, b, 1);
      add(a, b, -1);
      add(b, a, -1);
    } else {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const term = network.directions[3 * edge + i] *
            network.directions[3 * edge + j];
          add(3 * a + i, 3 * a + j, term);
          add(3 * b + i, 3 * b + j, term);
          add(3 * a + i, 3 * b + j, -term);
          add(3 * b + i, 3 * a + j, -term);
        }
      }
    }
  }
  return matrix;
}

/** y += H x for the GNM Kirchhoff or ANM Hessian, without forming it. */
function multiplier(
  network: ElasticNetwork,
  kind: "gnm" | "anm",
): (x: Float64Array, y: Float64Array) => void {
  const { pairs, directions } = network;
  if (kind === "gnm") {
    return (x, y) => {
      for (let k = 0; k < pairs.length; k += 2) {
        const a = pairs[k], b = pairs[k + 1], diff = x[a] - x[b];
        y[a] += diff;
        y[b] -= diff;
      }
    };
  }
  return (x, y) => {
    for (let edge = 0; edge < pairs.length / 2; edge++) {
      const a = 3 * pairs[2 * edge], b = 3 * pairs[2 * edge + 1];
      const ux = directions[3 * edge],
        uy = directions[3 * edge + 1],
        uz = directions[3 * edge + 2];
      const s = ux * (x[a] - x[b]) + uy * (x[a + 1] - x[b + 1]) +
        uz * (x[a + 2] - x[b + 2]);
      y[a] += s * ux;
      y[a + 1] += s * uy;
      y[a + 2] += s * uz;
      y[b] -= s * ux;
      y[b + 1] -= s * uy;
      y[b + 2] -= s * uz;
    }
  };
}

/** Flip a vector so its largest-magnitude entry is positive. */
function orient(vector: Float64Array | Float32Array): void {
  let pivot = 0;
  for (let i = 1; i < vector.length; i++) {
    if (Math.abs(vector[i]) > Math.abs(vector[pivot])) pivot = i;
  }
  if (vector[pivot] < 0) {
    for (let i = 0; i < vector.length; i++) vector[i] = -vector[i];
  }
}

/**
 * Worker-safe CPU solver for the first nontrivial elastic modes, in ascending
 * eigenvalue order with the largest-magnitude entry of each vector positive.
 * Zero modes (rigid-body and floppy) are skipped. Every returned mode has a
 * relative residual of at most 1e-6.
 */
export function solveElasticModes(
  network: ElasticNetwork,
  kind: "gnm" | "anm",
  count: number,
  options: ElasticSolveOptions = {},
): readonly ElasticMode[] {
  if (kind !== "gnm" && kind !== "anm") {
    throw new TypeError("elastic kind must be gnm or anm");
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new TypeError("mode count must be a positive safe integer");
  }
  const method = options.method ?? "auto";
  if (!["auto", "dense", "lanczos"].includes(method)) {
    throw new TypeError("elastic method must be auto, dense or lanczos");
  }
  const { maxIterations } = options;
  if (
    maxIterations !== undefined &&
    (!Number.isSafeInteger(maxIterations) || maxIterations < 1)
  ) {
    throw new TypeError("maxIterations must be a positive safe integer");
  }
  const d = (kind === "gnm" ? 1 : 3) * network.rows.length;
  const dense = method === "dense" ||
    (method === "auto" && d <= MAX_ELASTIC_DIM);
  if (dense && d > MAX_ELASTIC_DIM) {
    throw new RangeError(
      `elastic dimension ${d} exceeds dense limit ${MAX_ELASTIC_DIM}`,
    );
  }
  if (
    network.pairs.length % 2 !== 0 ||
    network.directions.length !== 3 * network.pairs.length / 2
  ) {
    throw new TypeError("elastic directions do not match contacts");
  }
  for (let edge = 0; edge < network.pairs.length / 2; edge++) {
    const a = network.pairs[2 * edge], b = network.pairs[2 * edge + 1];
    if (a >= network.rows.length || b >= network.rows.length || a >= b) {
      throw new TypeError("elastic contact node indices are invalid");
    }
    for (let axis = 0; axis < 3; axis++) {
      if (!Number.isFinite(network.directions[3 * edge + axis])) {
        throw new TypeError("elastic contact direction is not finite");
      }
    }
  }
  if (!dense) {
    const found = lanczosModes(
      kind,
      network.rows.length,
      network.pairs,
      multiplier(network, kind),
      count,
      { maxIterations },
    );
    return found.map(({ eigenvalue, vector, residual }) => {
      orient(vector);
      const compact = Float32Array.from(vector);
      orient(compact);
      return Object.freeze({ kind, eigenvalue, vector: compact, residual });
    });
  }
  const original = hessian(network, kind), a = original.slice();
  const vectors = new Float64Array(d * d);
  for (let i = 0; i < d; i++) vectors[i * d + i] = 1;
  const norm = Math.max(
    0,
    ...Array.from({ length: d }, (_, i) => Math.abs(a[i * d + i])),
  );
  for (let sweep = 0; sweep < 32 && norm > 0; sweep++) {
    let largest = 0;
    for (let p = 0; p < d; p++) {
      for (let q = p + 1; q < d; q++) {
        const apq = a[p * d + q];
        largest = Math.max(largest, Math.abs(apq));
        if (Math.abs(apq) <= norm * 1e-14) continue;
        const tau = (a[q * d + q] - a[p * d + p]) / (2 * apq);
        const t = (tau < 0 ? -1 : 1) /
          (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t), s = t * c;
        const app = a[p * d + p], aqq = a[q * d + q];
        a[p * d + p] = app - t * apq;
        a[q * d + q] = aqq + t * apq;
        a[p * d + q] = a[q * d + p] = 0;
        for (let k = 0; k < d; k++) {
          if (k !== p && k !== q) {
            const akp = a[k * d + p], akq = a[k * d + q];
            a[k * d + p] = a[p * d + k] = c * akp - s * akq;
            a[k * d + q] = a[q * d + k] = s * akp + c * akq;
          }
          const vkp = vectors[k * d + p], vkq = vectors[k * d + q];
          vectors[k * d + p] = c * vkp - s * vkq;
          vectors[k * d + q] = s * vkp + c * vkq;
        }
      }
    }
    if (largest <= norm * 1e-12) break;
    if (sweep === 31) {
      throw new RangeError("elastic eigensolver did not converge");
    }
  }
  const eigenvalues = Array.from({ length: d }, (_, i) => a[i * d + i]);
  const maxEigenvalue = Math.max(0, ...eigenvalues);
  const indices = Array.from({ length: d }, (_, i) => i)
    .sort((i, j) => eigenvalues[i] - eigenvalues[j] || i - j);
  const modes: ElasticMode[] = [];
  for (const column of indices) {
    const eigenvalue = eigenvalues[column];
    if (eigenvalue <= maxEigenvalue * 1e-7) continue;
    const vector = Float64Array.from(
      { length: d },
      (_, i) => vectors[i * d + column],
    );
    orient(vector);
    let residualSquared = 0;
    for (let i = 0; i < d; i++) {
      let value = -eigenvalue * vector[i];
      for (let j = 0; j < d; j++) value += original[i * d + j] * vector[j];
      residualSquared += value * value;
    }
    const residual = Math.sqrt(residualSquared) / Math.max(1, eigenvalue);
    if (!Number.isFinite(residual) || residual > 1e-6) {
      throw new RangeError("elastic mode residual exceeds tolerance");
    }
    // Re-orient after f32 rounding, which can move the pivot or break a tie.
    const compact = Float32Array.from(vector);
    orient(compact);
    modes.push(Object.freeze({ kind, eigenvalue, vector: compact, residual }));
    if (modes.length === count) break;
  }
  if (modes.length < count) {
    throw new RangeError(
      `elastic network has only ${modes.length} nontrivial modes`,
    );
  }
  return modes;
}
