/**
 * The centroid (arithmetic mean position, in Ångström) of a set of atoms — the
 * anchor point <Label> and <Distance> attach to, rather than a literal
 * coordinate. `indices` is a selection's atom rows, or null for every atom.
 * Pure and renderer-free, so it is unit-tested directly. Throws on an empty set
 * or an out-of-range row, so a bad anchor fails loudly instead of drawing at NaN.
 */
export function centroidOf(data, indices) {
  const P = data.positions;
  const total = data.topology.atoms.count;
  const n = indices ? indices.length : total;
  if (!n) throw new RangeError('centroid of an empty atom set');
  let x = 0, y = 0, z = 0;
  for (let j = 0; j < n; j++) {
    const i = indices ? indices[j] : j;
    if (!Number.isInteger(i) || i < 0 || i >= total) throw new RangeError(`centroid: atom index ${i} out of range`);
    x += P[i * 3]; y += P[i * 3 + 1]; z += P[i * 3 + 2];
  }
  return [x / n, y / n, z / n];
}

/** Euclidean distance in Ångström between two [x, y, z] points. */
export const distanceBetween = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Midpoint of two [x, y, z] points (where a distance label sits). */
export const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
