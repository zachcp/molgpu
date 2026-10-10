// Pointer <-> world mapping on the plane through an anchor, normal to the view
// axis: the drag plane for pulling an atom with the pointer. Pure functions of
// a column-major 4×4 projection-view matrix (use.gpu's
// `projectionViewMatrix` view uniform) and pointer coordinates in use.gpu's
// convention: u from 0 (left) to 1 (right), v from 0 (top) to 1 (bottom).

type Vec3 = [number, number, number];

function transform(m: ArrayLike<number>, x: number, y: number, z: number) {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ] as Vec3;
}

/** Inverse of a column-major 4×4 matrix; throws for a singular one. */
function invert(m: ArrayLike<number>): Float64Array {
  if (m.length !== 16) throw new TypeError("expected a 4×4 matrix");
  const a = Float64Array.from(m), inv = new Float64Array(16);
  for (let i = 0; i < 4; i++) inv[5 * i] = 1;
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let row = col + 1; row < 4; row++) {
      if (Math.abs(a[col * 4 + row]) > Math.abs(a[col * 4 + pivot])) {
        pivot = row;
      }
    }
    const p = a[col * 4 + pivot];
    if (!Number.isFinite(p) || Math.abs(p) < 1e-300) {
      throw new RangeError("projection-view matrix is singular");
    }
    for (let c = 0; c < 4; c++) {
      [a[c * 4 + col], a[c * 4 + pivot]] = [a[c * 4 + pivot], a[c * 4 + col]];
      [inv[c * 4 + col], inv[c * 4 + pivot]] = [
        inv[c * 4 + pivot],
        inv[c * 4 + col],
      ];
    }
    for (let c = 0; c < 4; c++) {
      a[c * 4 + col] /= p;
      inv[c * 4 + col] /= p;
    }
    for (let row = 0; row < 4; row++) {
      if (row === col) continue;
      const f = a[col * 4 + row];
      if (f === 0) continue;
      for (let c = 0; c < 4; c++) {
        a[c * 4 + row] -= f * a[c * 4 + col];
        inv[c * 4 + row] -= f * inv[c * 4 + col];
      }
    }
  }
  return inv;
}

/** Pointer position `[u, v]` and NDC depth of a world point. */
export function projectToPointer(
  point: ArrayLike<number>,
  projectionView: ArrayLike<number>,
): [number, number, number] {
  const [x, y, z] = transform(projectionView, point[0], point[1], point[2]);
  return [(x + 1) / 2, (1 - y) / 2, z];
}

/**
 * The world point under pointer `(u, v)` on the plane through `anchor` normal
 * to the view axis. `projectToPointer(anchor)` maps back to `anchor`; moving
 * the pointer moves the result within that plane.
 */
export function pointerToPlane(
  u: number,
  v: number,
  projectionView: ArrayLike<number>,
  anchor: ArrayLike<number>,
): [number, number, number] {
  if (![u, v, anchor[0], anchor[1], anchor[2]].every(Number.isFinite)) {
    throw new TypeError("pointer and anchor must be finite");
  }
  const inv = invert(projectionView);
  const x = 2 * u - 1, y = 1 - 2 * v;
  const a = transform(inv, x, y, 1), b = transform(inv, x, y, 0.5);
  const c = transform(inv, 0, 0, 1), d = transform(inv, 0, 0, 0.5);
  const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const n = [d[0] - c[0], d[1] - c[1], d[2] - c[2]];
  const denominator = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2];
  const t = (n[0] * (anchor[0] - a[0]) + n[1] * (anchor[1] - a[1]) +
    n[2] * (anchor[2] - a[2])) / denominator;
  return [a[0] + t * dir[0], a[1] + t * dir[1], a[2] + t * dir[2]];
}
