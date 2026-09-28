// Uniform spatial hash over packed xyz positions. Pure CPU index math.

// A hair wider than requested, so a pair exactly `cellSize` apart can never
// land two cells apart through division rounding.
const WIDEN = 1 + 1e-9;

/**
 * Index `rows` (every atom when null) of packed xyz `positions`. `partition`
 * maps a row to a bucket key such as its model, so queries skip rows that
 * share space but can never match (an NMR ensemble's superposed models).
 */
export function spatialGrid(
  positions: Float32Array,
  rows: ArrayLike<number> | null,
  cellSize: number,
  partition?: (row: number) => number,
): {
  readonly cellSize: number;
  /** Visit nearby cells in fixed cell and insertion order, restricted to
   * `partition` when present. Callers check the exact distance. Returns true
   * as soon as `visit` returns true. */
  near(
    x: number,
    y: number,
    z: number,
    visit: (row: number) => boolean | void,
    partition?: number,
  ): boolean;
} {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new TypeError("spatialGrid: cellSize must be a positive number");
  }
  const n = rows ? rows.length : positions.length / 3;
  const size = cellSize * WIDEN;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = rows ? rows[k] : k;
    const x = positions[i * 3],
      y = positions[i * 3 + 1],
      z = positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const nx = n ? Math.floor((maxX - minX) / size) + 1 : 0,
    ny = n ? Math.floor((maxY - minY) / size) + 1 : 0,
    nz = n ? Math.floor((maxZ - minZ) / size) + 1 : 0;
  const parts = new Float64Array(n);
  let widest = 0;
  for (let k = 0; partition && k < n; k++) {
    const p = partition(rows ? rows[k] : k);
    if (!Number.isSafeInteger(p)) {
      throw new TypeError("spatialGrid: partition keys must be integers");
    }
    parts[k] = p;
    widest = Math.max(widest, Math.abs(p));
  }
  // One exact integer per (partition, cell) while it fits; absurd coordinate
  // spans fall back to string keys rather than colliding.
  const cells = nx * ny * nz;
  const numeric = Number.isSafeInteger(cells * (2 * widest + 1));
  const key = (
    p: number,
    ix: number,
    iy: number,
    iz: number,
  ): number | string =>
    numeric ? p * cells + ix + nx * (iy + ny * iz) : `${p},${ix},${iy},${iz}`;
  const buckets = new Map<number | string, number[]>();
  for (let k = 0; k < n; k++) {
    const i = rows ? rows[k] : k;
    const cell = key(
      parts[k],
      Math.floor((positions[i * 3] - minX) / size),
      Math.floor((positions[i * 3 + 1] - minY) / size),
      Math.floor((positions[i * 3 + 2] - minZ) / size),
    );
    const bucket = buckets.get(cell);
    if (bucket) bucket.push(i);
    else buckets.set(cell, [i]);
  }

  const grid = {
    cellSize,
    near(
      x: number,
      y: number,
      z: number,
      visit: (row: number) => boolean | void,
      part = 0,
    ) {
      if (numeric && !Number.isSafeInteger(part * cells)) return false;
      const cx = Math.floor((x - minX) / size),
        cy = Math.floor((y - minY) / size),
        cz = Math.floor((z - minZ) / size);
      for (let dz = -1; dz <= 1; dz++) {
        const iz = cz + dz;
        if (iz < 0 || iz >= nz) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const iy = cy + dy;
          if (iy < 0 || iy >= ny) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const ix = cx + dx;
            if (ix < 0 || ix >= nx) continue;
            const bucket = buckets.get(key(part, ix, iy, iz));
            if (!bucket) continue;
            for (const row of bucket) if (visit(row)) return true;
          }
        }
      }
      return false;
    },
  };
  return Object.freeze(grid);
}
