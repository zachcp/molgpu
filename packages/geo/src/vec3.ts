// Minimal Vec3 kernels ported from Mol* 5.11.0's MIT-licensed
// mol-math/linear-algebra/3d/vec3.js and mol-math/interpolate.js, limited to
// the operations curve-segment.ts needs. Plain [x, y, z] arrays, no Mol*
// Task/Tensor types.

/** A mutable [x, y, z]. */
export type Vec3 = number[];
/** A readable 3-vector: a plain or typed array of at least three numbers. */
type Vec3Like = ArrayLike<number>;

export function create(x = 0, y = 0, z = 0): Vec3 {
  return [x, y, z];
}
export function zero(): Vec3 {
  return [0, 0, 0];
}

export function fromArray(
  v: Vec3,
  array: ArrayLike<number>,
  offset: number,
): Vec3 {
  v[0] = array[offset + 0];
  v[1] = array[offset + 1];
  v[2] = array[offset + 2];
  return v;
}

export function toArray<T extends { [index: number]: number }>(
  v: Vec3Like,
  out: T,
  offset: number,
): T {
  out[offset + 0] = v[0];
  out[offset + 1] = v[1];
  out[offset + 2] = v[2];
  return out;
}

export function copy(out: Vec3, a: Vec3Like): Vec3 {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}

export function add(out: Vec3, a: Vec3Like, b: Vec3Like): Vec3 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

export function sub(out: Vec3, a: Vec3Like, b: Vec3Like): Vec3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

export function scale(out: Vec3, a: Vec3Like, b: number): Vec3 {
  out[0] = a[0] * b;
  out[1] = a[1] * b;
  out[2] = a[2] * b;
  return out;
}

export function scaleAndAdd(
  out: Vec3,
  a: Vec3Like,
  b: Vec3Like,
  s: number,
): Vec3 {
  out[0] = a[0] + b[0] * s;
  out[1] = a[1] + b[1] * s;
  out[2] = a[2] + b[2] * s;
  return out;
}

export function negate(out: Vec3, a: Vec3Like): Vec3 {
  out[0] = -a[0];
  out[1] = -a[1];
  out[2] = -a[2];
  return out;
}

export function dot(a: Vec3Like, b: Vec3Like): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(out: Vec3, a: Vec3Like, b: Vec3Like): Vec3 {
  const ax = a[0], ay = a[1], az = a[2], bx = b[0], by = b[1], bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

export function normalize(out: Vec3, a: Vec3Like): Vec3 {
  const x = a[0], y = a[1], z = a[2];
  let len = x * x + y * y + z * z;
  if (len > 0) {
    len = 1 / Math.sqrt(len);
    out[0] = x * len;
    out[1] = y * len;
    out[2] = z * len;
  } else {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return out;
}

export function isZero(v: Vec3Like): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0;
}

/** Get a vector that is similar to `b` but orthogonal to `a` */
export function orthogonalize(out: Vec3, a: Vec3Like, b: Vec3Like): Vec3 {
  normalize(out, cross(out, cross(out, a, b), a));
  if (!isZero(out)) return out;
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  normalize(out, cross(out, cross(out, a, out), a));
  if (!isZero(out)) return out;
  out[0] = 0;
  out[1] = 1;
  out[2] = 0;
  normalize(out, cross(out, cross(out, a, out), a));
  if (!isZero(out)) return out;
  normalize(out, b);
  if (!isZero(out)) return out;
  out[0] = 1;
  out[1] = 0;
  out[2] = 0;
  return out;
}

/** Get a vector like `a` that points into the same general direction as `b` */
export function matchDirection(out: Vec3, a: Vec3Like, b: Vec3Like): Vec3 {
  if (dot(a, b) > 0) copy(out, a);
  else negate(out, copy(out, a));
  return out;
}

const slerpRelVec = zero();
export function slerp(out: Vec3, a: Vec3Like, b: Vec3Like, t: number): Vec3 {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  const theta = Math.acos(d) * t;
  scaleAndAdd(slerpRelVec, b, a, -d);
  normalize(slerpRelVec, slerpRelVec);
  return add(
    out,
    scale(out, a, Math.cos(theta)),
    scale(slerpRelVec, slerpRelVec, Math.sin(theta)),
  );
}

export function lerp(start: number, stop: number, alpha: number): number {
  return start + (stop - start) * alpha;
}

/** Catmull-Rom spline */
function splineScalar(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
  tension: number,
): number {
  const v0 = (p2 - p0) * tension;
  const v1 = (p3 - p1) * tension;
  const t2 = t * t;
  const t3 = t * t2;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 +
    (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

export function spline(
  out: Vec3,
  a: Vec3Like,
  b: Vec3Like,
  c: Vec3Like,
  d: Vec3Like,
  t: number,
  tension: number,
): Vec3 {
  out[0] = splineScalar(a[0], b[0], c[0], d[0], t, tension);
  out[1] = splineScalar(a[1], b[1], c[1], d[1], t, tension);
  out[2] = splineScalar(a[2], b[2], c[2], d[2], t, tension);
  return out;
}

function saturate(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function smoothstep(min: number, max: number, x: number): number {
  x = saturate((x - min) / (max - min));
  return x * x * (3 - 2 * x);
}
