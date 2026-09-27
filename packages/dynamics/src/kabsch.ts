import type { AffineMatrix } from "./affine.ts";

export interface KabschFit {
  /** Column-major proper rigid transform mapping source into reference. */
  readonly matrix: AffineMatrix;
  /** RMSD of selected rows after applying `matrix`. */
  readonly rmsd: number;
  readonly count: number;
}

/** Diagonalize a small symmetric matrix with deterministic Jacobi sweeps. */
function symmetricEigen(values: Float64Array, size: number): {
  values: Float64Array;
  vectors: Float64Array;
} {
  const a = values.slice();
  const v = new Float64Array(size * size);
  for (let i = 0; i < size; i++) v[i * size + i] = 1;
  for (let sweep = 0; sweep < 80; sweep++) {
    let p = 0, q = 1, largest = 0;
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        const magnitude = Math.abs(a[i * size + j]);
        if (magnitude > largest) {
          largest = magnitude;
          p = i;
          q = j;
        }
      }
    }
    const scale = Math.max(
      ...Array.from({ length: size }, (_, i) => Math.abs(a[i * size + i])),
    );
    if (largest <= scale * 1e-15) break;
    const apq = a[p * size + q];
    const tau = (a[q * size + q] - a[p * size + p]) / (2 * apq);
    const t = (tau < 0 ? -1 : 1) /
      (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    const app = a[p * size + p], aqq = a[q * size + q];
    a[p * size + p] = app - t * apq;
    a[q * size + q] = aqq + t * apq;
    a[p * size + q] = a[q * size + p] = 0;
    for (let k = 0; k < size; k++) {
      if (k !== p && k !== q) {
        const akp = a[k * size + p], akq = a[k * size + q];
        a[k * size + p] = a[p * size + k] = c * akp - s * akq;
        a[k * size + q] = a[q * size + k] = s * akp + c * akq;
      }
      const vkp = v[k * size + p], vkq = v[k * size + q];
      v[k * size + p] = c * vkp - s * vkq;
      v[k * size + q] = s * vkp + c * vkq;
    }
  }
  return {
    values: Float64Array.from({ length: size }, (_, i) => a[i * size + i]),
    vectors: v,
  };
}

function secondScatterEigenvalue(scatter: Float64Array): number {
  const eig = symmetricEigen(scatter, 3).values;
  return [...eig].sort((a, b) => b - a)[1];
}

/** Proper Kabsch rigid fit over corresponding topology rows.
 * Source and reference are packed xyz and equal length. Selected rows must be
 * sorted and unique; all output rows can be transformed with the returned
 * matrix. With `translate` false the rotation is about the source centroid,
 * which stays in place. Throws on fewer than three non-collinear fit points. */
export function fitKabsch(
  source: Float32Array,
  reference: Float32Array,
  rows?: ArrayLike<number> | null,
  translate: boolean = true,
): KabschFit {
  if (source.length !== reference.length || source.length % 3 !== 0) {
    throw new TypeError(
      "source and reference must have equal packed xyz lengths",
    );
  }
  const total = source.length / 3;
  const n = rows?.length ?? total;
  if (!Number.isSafeInteger(n) || n < 3 || n > total) {
    throw new RangeError("Kabsch fit needs at least three corresponding rows");
  }
  const selected = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const row = rows ? rows[i] : i;
    if (
      !Number.isSafeInteger(row) || row < 0 || row >= total ||
      (i > 0 && row <= selected[i - 1])
    ) {
      throw new TypeError("fit rows must be sorted, unique indices in range");
    }
    selected[i] = row;
    for (let k = 0; k < 3; k++) {
      if (
        !Number.isFinite(source[3 * row + k]) ||
        !Number.isFinite(reference[3 * row + k])
      ) {
        throw new TypeError("fit coordinates must be finite");
      }
    }
  }
  // Subtract the first selected point before averaging so a large common
  // translation does not erase small shape differences in the f64 sums.
  const first = selected[0] * 3;
  const baseS = [source[first], source[first + 1], source[first + 2]];
  const baseR = [reference[first], reference[first + 1], reference[first + 2]];
  const meanS = [0, 0, 0], meanR = [0, 0, 0];
  for (const row of selected) {
    for (let k = 0; k < 3; k++) {
      meanS[k] += (source[3 * row + k] - baseS[k]) / n;
      meanR[k] += (reference[3 * row + k] - baseR[k]) / n;
    }
  }
  const scatterS = new Float64Array(9);
  const scatterR = new Float64Array(9);
  const cov = new Float64Array(9);
  for (const row of selected) {
    const s = [0, 1, 2].map((k) => source[3 * row + k] - baseS[k] - meanS[k]);
    const r = [0, 1, 2].map((k) =>
      reference[3 * row + k] - baseR[k] - meanR[k]
    );
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        scatterS[3 * i + j] += s[i] * s[j];
        scatterR[3 * i + j] += r[i] * r[j];
        cov[3 * i + j] += s[i] * r[j];
      }
    }
  }
  for (const scatter of [scatterS, scatterR]) {
    const trace = scatter[0] + scatter[4] + scatter[8];
    if (trace <= 0 || secondScatterEigenvalue(scatter) <= trace * 1e-8) {
      throw new RangeError(
        "Kabsch fit points are collinear or nearly collinear",
      );
    }
  }
  const [xx, xy, xz, yx, yy, yz, zx, zy, zz] = cov;
  const horn = Float64Array.of(
    xx + yy + zz,
    yz - zy,
    zx - xz,
    xy - yx,
    yz - zy,
    xx - yy - zz,
    xy + yx,
    zx + xz,
    zx - xz,
    xy + yx,
    -xx + yy - zz,
    yz + zy,
    xy - yx,
    zx + xz,
    yz + zy,
    -xx - yy + zz,
  );
  const eig = symmetricEigen(horn, 4);
  let best = 0;
  for (let i = 1; i < 4; i++) {
    if (eig.values[i] > eig.values[best]) best = i;
  }
  let [w, x, y, z] = [0, 1, 2, 3].map((i) => eig.vectors[i * 4 + best]);
  if (w < 0 || (w === 0 && [x, y, z].find((a) => a !== 0)! < 0)) {
    w = -w;
    x = -x;
    y = -y;
    z = -z;
  }
  const r00 = 1 - 2 * (y * y + z * z),
    r01 = 2 * (x * y - w * z),
    r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z),
    r11 = 1 - 2 * (x * x + z * z),
    r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y),
    r21 = 2 * (y * z + w * x),
    r22 = 1 - 2 * (x * x + y * y);
  const centroidS = meanS.map((value, i) => value + baseS[i]);
  const centroidR = meanR.map((value, i) => value + baseR[i]);
  // Without translation the source centroid stays fixed and only rotates.
  const target = translate ? centroidR : centroidS;
  const tx = target[0] -
    (r00 * centroidS[0] + r01 * centroidS[1] + r02 * centroidS[2]);
  const ty = target[1] -
    (r10 * centroidS[0] + r11 * centroidS[1] + r12 * centroidS[2]);
  const tz = target[2] -
    (r20 * centroidS[0] + r21 * centroidS[1] + r22 * centroidS[2]);
  const matrix = Float64Array.of(
    r00,
    r10,
    r20,
    0,
    r01,
    r11,
    r21,
    0,
    r02,
    r12,
    r22,
    0,
    tx,
    ty,
    tz,
    1,
  );
  let squared = 0;
  for (const row of selected) {
    const i = row * 3, sx = source[i], sy = source[i + 1], sz = source[i + 2];
    const dx = r00 * sx + r01 * sy + r02 * sz + tx - reference[i];
    const dy = r10 * sx + r11 * sy + r12 * sz + ty - reference[i + 1];
    const dz = r20 * sx + r21 * sy + r22 * sz + tz - reference[i + 2];
    squared += dx * dx + dy * dy + dz * dz;
  }
  return Object.freeze({ matrix, rmsd: Math.sqrt(squared / n), count: n });
}
