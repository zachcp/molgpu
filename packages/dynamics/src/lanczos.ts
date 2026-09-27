// Sparse CPU eigensolver for elastic networks: Lanczos with full
// reorthogonalisation over a matrix-free Hessian product. Each connected
// component's translations are projected out exactly; remaining zero modes
// (ANM rotations, floppy motions) are filtered by the dense solver's rule. Internal to the package; `solveElasticModes` dispatches
// here above the dense limit.

/** A basis vector that is nonzero only on one component's entries. */
interface SparseVector {
  readonly index: Int32Array;
  readonly value: Float64Array;
}

/** Symmetric tridiagonal eigenproblem by implicit QL (EISPACK tql2, as in
 * JAMA). `d` is the diagonal and `e[i]` the coupling of rows i-1 and i (e[0]
 * unused); both are overwritten, `d` with eigenvalues in ascending order.
 * `rows` lists the eigenvector rows to accumulate, so a convergence check can
 * track only the last row. Returns those rows, row-major, column per value. */
export function tridiagonalEigen(
  d: Float64Array,
  e: Float64Array,
  rows: readonly number[],
): Float64Array {
  const n = d.length, r = rows.length;
  const v = new Float64Array(r * n);
  rows.forEach((row, k) => v[k * n + row] = 1);
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  if (n) e[n - 1] = 0;
  let f = 0, tst1 = 0;
  const eps = 2 ** -52;
  for (let l = 0; l < n; l++) {
    tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
    let m = l;
    while (m < n && Math.abs(e[m]) > eps * tst1) m++;
    if (m > l) {
      for (let iteration = 0;; iteration++) {
        if (iteration > 60) {
          throw new RangeError("tridiagonal eigensolver did not converge");
        }
        let g = d[l];
        let p = (d[l + 1] - g) / (2 * e[l]);
        let rr = Math.hypot(p, 1);
        if (p < 0) rr = -rr;
        d[l] = e[l] / (p + rr);
        d[l + 1] = e[l] * (p + rr);
        const dl1 = d[l + 1];
        let h = g - d[l];
        for (let i = l + 2; i < n; i++) d[i] -= h;
        f += h;
        p = d[m];
        let c = 1, c2 = c, c3 = c, s = 0, s2 = 0;
        const el1 = e[l + 1];
        for (let i = m - 1; i >= l; i--) {
          c3 = c2;
          c2 = c;
          s2 = s;
          g = c * e[i];
          h = c * p;
          rr = Math.hypot(p, e[i]);
          e[i + 1] = s * rr;
          s = e[i] / rr;
          c = p / rr;
          p = c * d[i] - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]);
          for (let k = 0; k < r; k++) {
            const a = v[k * n + i], b = v[k * n + i + 1];
            v[k * n + i + 1] = s * a + c * b;
            v[k * n + i] = c * a - s * b;
          }
        }
        p = -s * s2 * c3 * el1 * e[l] / dl1;
        e[l] = s * p;
        d[l] = c * p;
        if (Math.abs(e[l]) <= eps * tst1) break;
      }
    }
    d[l] += f;
    e[l] = 0;
  }
  // Selection sort keeps the accumulated rows' columns paired with values.
  for (let i = 0; i < n - 1; i++) {
    let k = i;
    for (let j = i + 1; j < n; j++) if (d[j] < d[k]) k = j;
    if (k === i) continue;
    [d[i], d[k]] = [d[k], d[i]];
    for (let row = 0; row < r; row++) {
      const a = row * n;
      [v[a + i], v[a + k]] = [v[a + k], v[a + i]];
    }
  }
  return v;
}

/** Connected components of the contact graph, as node lists. */
function components(nodes: number, pairs: Uint32Array): number[][] {
  const parent = Int32Array.from({ length: nodes }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let k = 0; k < pairs.length; k += 2) {
    const a = find(pairs[k]), b = find(pairs[k + 1]);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  }
  const groups = new Map<number, number[]>();
  for (let node = 0; node < nodes; node++) {
    const root = find(node);
    let group = groups.get(root);
    if (!group) groups.set(root, group = []);
    group.push(node);
  }
  return [...groups.values()];
}

/** Orthonormal translations of each component, component-local. Rotations
 * need coordinates the network does not carry; their near-zero Ritz values are
 * filtered like the dense solver's. */
function nullBasis(
  kind: "gnm" | "anm",
  nodes: number,
  pairs: Uint32Array,
): SparseVector[] {
  const basis: SparseVector[] = [];
  const width = kind === "gnm" ? 1 : 3;
  for (const group of components(nodes, pairs)) {
    const value = new Float64Array(group.length).fill(
      1 / Math.sqrt(group.length),
    );
    for (let axis = 0; axis < width; axis++) {
      basis.push({
        index: Int32Array.from(group, (node) => width * node + axis),
        value,
      });
    }
  }
  return basis;
}

function project(vector: Float64Array, basis: readonly SparseVector[]): void {
  for (const { index, value } of basis) {
    let dot = 0;
    for (let i = 0; i < index.length; i++) dot += value[i] * vector[index[i]];
    for (let i = 0; i < index.length; i++) vector[index[i]] -= dot * value[i];
  }
}

const dot = (a: Float64Array, b: Float64Array): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
};

export interface LanczosOptions {
  /** Krylov vectors kept; defaults to what fits in ~320 MB of f64 basis. */
  readonly maxIterations?: number;
}

export interface LanczosPair {
  readonly eigenvalue: number;
  readonly vector: Float64Array;
  readonly residual: number;
}

/**
 * The first `count` nontrivial eigenpairs of an elastic network Hessian, whose
 * product with a vector is `multiply(x, y)` (y is zeroed by the caller).
 * Throws a RangeError if the Krylov space runs out before every requested pair
 * meets the residual tolerance.
 */
export function lanczosModes(
  kind: "gnm" | "anm",
  nodes: number,
  pairs: Uint32Array,
  multiply: (x: Float64Array, y: Float64Array) => void,
  count: number,
  options: LanczosOptions = {},
): LanczosPair[] {
  const d = (kind === "gnm" ? 1 : 3) * nodes;
  const basis = nullBasis(kind, nodes, pairs);
  const free = d - basis.length;
  const cap = Math.min(
    free,
    options.maxIterations ?? Math.max(64, Math.floor(4e7 / Math.max(1, d))),
  );
  if (!Number.isSafeInteger(cap) || cap < 1) {
    throw new RangeError(`elastic network has only 0 nontrivial modes`);
  }
  // Deterministic start: a fixed LCG sequence, projected and normalised.
  let seed = 0x2545f491;
  const random = (): Float64Array => {
    const v = new Float64Array(d);
    for (let i = 0; i < d; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      v[i] = seed / 2 ** 32 - 0.5;
    }
    return v;
  };
  const Q: Float64Array[] = [];
  const alphas: number[] = [], betas: number[] = [];
  const orthogonalise = (w: Float64Array) => {
    for (let pass = 0; pass < 2; pass++) {
      project(w, basis);
      for (const q of Q) {
        const c = dot(q, w);
        for (let i = 0; i < d; i++) w[i] -= c * q[i];
      }
    }
  };
  const fresh = (): Float64Array | null => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const v = random();
      orthogonalise(v);
      const norm = Math.sqrt(dot(v, v));
      if (norm > 1e-6) {
        for (let i = 0; i < d; i++) v[i] /= norm;
        return v;
      }
    }
    return null;
  };
  let q: Float64Array | null = fresh();
  let scale = 0;
  const w = new Float64Array(d);
  const ritz = (m: number, rowsWanted: readonly number[]) => {
    const values = Float64Array.from(alphas.slice(0, m));
    const e = new Float64Array(m);
    for (let i = 1; i < m; i++) e[i] = betas[i - 1];
    const vectors = tridiagonalEigen(values, e, rowsWanted);
    return { values, vectors };
  };
  for (let j = 0; q && j < cap; j++) {
    Q.push(q);
    w.fill(0);
    multiply(q, w);
    const alpha = dot(q, w);
    for (let i = 0; i < d; i++) {
      w[i] -= alpha * q[i] + (j ? betas[j - 1] * Q[j - 1][i] : 0);
    }
    orthogonalise(w);
    const beta = Math.sqrt(dot(w, w));
    alphas.push(alpha);
    scale = Math.max(scale, Math.abs(alpha) + beta);
    let next: Float64Array | null;
    if (beta > 1e-10 * scale) {
      next = w.map((x) => x / beta);
      betas.push(beta);
    } else {
      // An invariant subspace: restart orthogonally (a repeated eigenvalue).
      next = Q.length < free ? fresh() : null;
      betas.push(0);
    }
    const m = j + 1;
    const last = !next || m === cap;
    if (!last && (m < count || m % 8 !== 0)) {
      q = next;
      continue;
    }
    // Convergence: |beta_m * s_{m,i}| bounds the residual of Ritz pair i.
    const { values, vectors: tail } = ritz(m, [m - 1]);
    const top = values[m - 1];
    const wanted: number[] = [];
    for (let i = 0; i < m && wanted.length < count; i++) {
      if (values[i] > top * 1e-7) wanted.push(i);
    }
    const settled = wanted.length === count &&
      wanted.every((i) =>
        Math.abs(betas[j] * tail[i]) <= 1e-9 * Math.max(1, values[i])
      );
    if (settled || last) {
      if (wanted.length < count) {
        throw new RangeError(
          !next || Q.length >= free
            ? `elastic network has only ${wanted.length} nontrivial modes`
            : `elastic Lanczos solver did not converge in ${m} iterations`,
        );
      }
      const { vectors: all } = ritz(m, Array.from({ length: m }, (_, i) => i));
      const found: LanczosPair[] = [];
      const hy = new Float64Array(d);
      for (const i of wanted) {
        const y = new Float64Array(d);
        for (let k = 0; k < m; k++) {
          const s = all[k * m + i];
          const qk = Q[k];
          for (let t = 0; t < d; t++) y[t] += s * qk[t];
        }
        const norm = Math.sqrt(dot(y, y));
        for (let t = 0; t < d; t++) y[t] /= norm;
        hy.fill(0);
        multiply(y, hy);
        const eigenvalue = dot(y, hy);
        let squared = 0;
        for (let t = 0; t < d; t++) {
          const r = hy[t] - eigenvalue * y[t];
          squared += r * r;
        }
        found.push({
          eigenvalue,
          vector: y,
          residual: Math.sqrt(squared) / Math.max(1, eigenvalue),
        });
      }
      if (found.every((pair) => pair.residual <= 1e-6)) return found;
      if (last) {
        throw new RangeError(
          `elastic Lanczos solver did not converge in ${m} iterations`,
        );
      }
    }
    q = next;
  }
  throw new RangeError("elastic Lanczos solver did not converge");
}
