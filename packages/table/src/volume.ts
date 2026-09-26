// Renderer-free scalar/vector volumes: a grid of samples plus the complete
// index-to-world affine. See docs/findings/2026-09-26-volume-data-plan.md.
import type {
  VolumeData,
  VolumeInput,
  VolumeLevel,
  VolumeStats,
} from "./types.ts";

/** Default `createVolume` ceiling: 256³ samples (64 MiB of scalar f32). */
export const MAX_VOLUME_SAMPLES = 256 ** 3;

/** Inside tolerance, in index units, so a point on a grid face is not "outside". */
const EDGE = 1e-4;

const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`);
};

const determinant3 = (m: ArrayLike<number>): number =>
  m[0] * (m[5] * m[10] - m[9] * m[6]) -
  m[4] * (m[1] * m[10] - m[9] * m[2]) +
  m[8] * (m[1] * m[6] - m[5] * m[2]);

/**
 * Throw a `TypeError` naming the offending field if `input` is malformed, or a
 * `RangeError` if it holds more than `maxSamples` samples. Returns the input.
 */
export function validateVolume<T extends VolumeInput>(
  input: T,
  options: { maxSamples?: number } = {},
): T {
  const { maxSamples = MAX_VOLUME_SAMPLES } = options;
  if (!input || typeof input !== "object") fail("volume", "expected object");
  const { values, dims, transform, components = 1 } = input;
  if (!(values instanceof Float32Array)) {
    fail("volume.values", "expected Float32Array");
  }
  if (
    !Array.isArray(dims) || dims.length !== 3 ||
    !dims.every((n) => Number.isSafeInteger(n) && n > 0)
  ) {
    fail("volume.dims", "expected three positive integers");
  }
  if (components !== 1 && components !== 3) {
    fail("volume.components", "expected 1 or 3");
  }
  const samples = dims[0] * dims[1] * dims[2];
  if (!(samples <= maxSamples)) {
    throw new RangeError(
      `volume: ${dims.join("×")} = ${samples} samples exceeds maxSamples ` +
        `${maxSamples}; pass a larger maxSamples to accept it (no implicit downsampling)`,
    );
  }
  if (values.length !== samples * components) {
    fail(
      "volume.values",
      `expected length ${samples * components} for dims × components`,
    );
  }
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      fail(`volume.values[${i}]`, "expected finite number");
    }
  }
  if (
    !transform || transform.length !== 16 ||
    !Array.prototype.every.call(transform, Number.isFinite)
  ) {
    fail("volume.transform", "expected 16 finite numbers (column-major 4×4)");
  }
  if (
    transform[3] !== 0 || transform[7] !== 0 || transform[11] !== 0 ||
    transform[15] !== 1
  ) {
    fail("volume.transform", "expected an affine matrix (last row 0 0 0 1)");
  }
  // createVolume stores this matrix as f32. Check the stored precision so a
  // finite input cannot turn into an infinite or singular volume afterward.
  const storedTransform = Float32Array.from(transform);
  if (!storedTransform.every(Number.isFinite)) {
    fail("volume.transform", "expected values representable as Float32Array");
  }
  if (Math.abs(determinant3(storedTransform)) < 1e-12) {
    fail("volume.transform", "expected an invertible affine");
  }
  if (input.unit !== undefined && typeof input.unit !== "string") {
    fail("volume.unit", "expected string");
  }
  return input;
}

/** Min, max, mean and population standard deviation of every stored value. */
function statsOf(values: Float32Array): VolumeStats {
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / values.length;
  let squares = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - mean;
    squares += d * d;
  }
  return Object.freeze({
    min,
    max,
    mean,
    sigma: Math.sqrt(squares / values.length),
  });
}

/**
 * Validate `input` and wrap it as a frozen `VolumeData`. `values` is adopted,
 * not copied (one CPU copy per volume); like structure columns it is immutable
 * by contract. Statistics are always computed from the values, never read from
 * a file header. Oversize input throws a `RangeError` (see `validateVolume`).
 */
export function createVolume(
  input: VolumeInput,
  options: { maxSamples?: number } = {},
): VolumeData {
  validateVolume(input, options);
  const { values, dims, transform, components = 1, unit } = input;
  return Object.freeze({
    values,
    dims: Object.freeze([dims[0], dims[1], dims[2]]) as VolumeData["dims"],
    transform: Float32Array.from(transform),
    stats: statsOf(values),
    components,
    ...(unit === undefined ? {} : { unit }),
  });
}

const inverseCache = new WeakMap<VolumeData, Float64Array>();

/**
 * World (Å) to fractional grid index: the inverse of `volume.transform`,
 * column-major, computed in double precision and cached per volume.
 */
export function volumeInverseTransform(volume: VolumeData): Float64Array {
  const hit = inverseCache.get(volume);
  if (hit) return hit;
  const m = volume.transform;
  const det = determinant3(m);
  const inv = new Float64Array(16);
  inv[0] = (m[5] * m[10] - m[9] * m[6]) / det;
  inv[4] = -(m[4] * m[10] - m[8] * m[6]) / det;
  inv[8] = (m[4] * m[9] - m[8] * m[5]) / det;
  inv[1] = -(m[1] * m[10] - m[9] * m[2]) / det;
  inv[5] = (m[0] * m[10] - m[8] * m[2]) / det;
  inv[9] = -(m[0] * m[9] - m[8] * m[1]) / det;
  inv[2] = (m[1] * m[6] - m[5] * m[2]) / det;
  inv[6] = -(m[0] * m[6] - m[4] * m[2]) / det;
  inv[10] = (m[0] * m[5] - m[4] * m[1]) / det;
  for (let r = 0; r < 3; r++) {
    inv[12 + r] = -(inv[r] * m[12] + inv[4 + r] * m[13] + inv[8 + r] * m[14]);
  }
  inv[15] = 1;
  inverseCache.set(volume, inv);
  return inv;
}

/** World position (Å) of fractional grid index `(i, j, k)`. */
export function volumeIndexToWorld(
  volume: VolumeData,
  i: number,
  j: number,
  k: number,
): [number, number, number] {
  const m = volume.transform;
  return [
    m[0] * i + m[4] * j + m[8] * k + m[12],
    m[1] * i + m[5] * j + m[9] * k + m[13],
    m[2] * i + m[6] * j + m[10] * k + m[14],
  ];
}

/** Fractional grid index of world position `(x, y, z)` (Å). */
export function volumeWorldToIndex(
  volume: VolumeData,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const m = volumeInverseTransform(volume);
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

/**
 * Trilinear sample of a scalar volume at world position `(x, y, z)`. A point
 * more than 1e-4 grid cells outside `[0, n - 1]` on any axis returns 0; a point
 * on or just past a face is clamped to it. The viewer's WGSL `sampleVolume`
 * implements the same rule.
 */
export function sampleVolume(
  volume: VolumeData,
  x: number,
  y: number,
  z: number,
): number {
  if (volume.components !== 1) {
    throw new TypeError(
      "sampleVolume: expected a scalar volume; extract one with volumeComponent",
    );
  }
  const [nx, ny, nz] = volume.dims;
  const u = volumeWorldToIndex(volume, x, y, z);
  const n = [nx, ny, nz];
  const base = [0, 0, 0], t = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    if (u[a] < -EDGE || u[a] > n[a] - 1 + EDGE) return 0;
    const c = Math.min(Math.max(u[a], 0), n[a] - 1);
    base[a] = Math.min(Math.floor(c), Math.max(n[a] - 2, 0));
    t[a] = n[a] === 1 ? 0 : c - base[a];
  }
  const v = volume.values;
  const at = (i: number, j: number, k: number): number =>
    v[
      Math.min(base[0] + i, nx - 1) +
      nx * (Math.min(base[1] + j, ny - 1) + ny * Math.min(base[2] + k, nz - 1))
    ];
  const lerp = (a: number, b: number, s: number): number => a + (b - a) * s;
  const c00 = lerp(at(0, 0, 0), at(1, 0, 0), t[0]);
  const c10 = lerp(at(0, 1, 0), at(1, 1, 0), t[0]);
  const c01 = lerp(at(0, 0, 1), at(1, 0, 1), t[0]);
  const c11 = lerp(at(0, 1, 1), at(1, 1, 1), t[0]);
  return lerp(lerp(c00, c10, t[1]), lerp(c01, c11, t[1]), t[2]);
}

/**
 * Scalar volume from a multi-component one: one interleaved channel (0, 1, 2)
 * or the per-sample Euclidean `"magnitude"`. A scalar volume is returned as is.
 */
export function volumeComponent(
  volume: VolumeData,
  component: 0 | 1 | 2 | "magnitude",
): VolumeData {
  if (volume.components === 1) return volume;
  if (![0, 1, 2, "magnitude"].includes(component)) {
    fail("volumeComponent.component", "expected 0, 1, 2 or 'magnitude'");
  }
  const n = volume.values.length / 3;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (component === "magnitude") {
      const x = volume.values[i * 3],
        y = volume.values[i * 3 + 1],
        z = volume.values[i * 3 + 2];
      out[i] = Math.hypot(x, y, z);
    } else out[i] = volume.values[i * 3 + component];
  }
  return createVolume({
    values: out,
    dims: volume.dims,
    transform: volume.transform,
    ...(volume.unit === undefined ? {} : { unit: volume.unit }),
  }, { maxSamples: Infinity });
}

/**
 * Absolute isovalue for a level: a number is absolute; `{ sigma: k }` is
 * `stats.mean + k * stats.sigma` (a flat map gives its mean).
 */
export function volumeLevel(volume: VolumeData, level: VolumeLevel): number {
  if (typeof level === "number") {
    if (!Number.isFinite(level)) fail("level", "expected finite number");
    return level;
  }
  if (!level || !Number.isFinite(level.sigma)) {
    fail("level", "expected a finite number or { sigma: finite number }");
  }
  return volume.stats.mean + level.sigma * volume.stats.sigma;
}
