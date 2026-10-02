// Nearest-atom attribution for isosurface vertices: which source atom a
// surface vertex is "closest to", for picking and per-atom field colouring.
// Pure geometry (a uniform-grid nearest-neighbor search), no Mol* types.

/**
 * `atomIndex[v]` = the atom in `atomPositions` nearest to vertex `v` of
 * `positions`, exactly (never approximate). `cellSize` is a performance
 * hint, not a correctness bound: pass roughly the largest expected
 * vertex-to-nearest-atom distance (for a molecular surface: probe radius +
 * the largest atom radius + the field resolution). A radius-2 cell window
 * (5x5x5) around a vertex is searched first; if the closest atom found
 * there is within `2 * cellSize` of the vertex, no atom outside the window
 * could possibly be closer — an unsearched cell at Chebyshev distance 3 is
 * always at least `2 * cellSize` away — so that result is certified
 * correct. Widely scattered atoms widen the effective cell size to bound the
 * grid's memory; the same certificate then uses the wider size. Otherwise (including an empty window) this falls back to an
 * exhaustive scan, which is always correct, only slower.
 */
export function nearestAtomAttribution(
  positions: Float32Array,
  atomPositions: Float32Array,
  cellSize: number,
): Uint32Array {
  if (!(positions instanceof Float32Array) || positions.length % 3) {
    throw new TypeError("positions must be a packed Float32Array of vec3s");
  }
  if (!(atomPositions instanceof Float32Array) || atomPositions.length % 3) {
    throw new TypeError("atomPositions must be a packed Float32Array of vec3s");
  }
  const atomCount = atomPositions.length / 3;
  if (atomCount === 0) {
    throw new RangeError("atomPositions must contain at least one atom");
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError("cellSize must be a positive finite number");
  }

  // A dense grid over the atoms' cell range, in CSR form: atoms of each cell
  // in ascending index order, so the search visits candidates in the same
  // order as a per-cell bucket list and resolves ties the same way. Cells
  // outside the range are empty and are simply skipped. Widely scattered
  // atoms double the effective cell size until the grid stays within
  // max(8 × atoms, 2²⁰) cells; certification below uses that size, so the
  // result stays exact.
  const limit = Math.max(8 * atomCount, 2 ** 20);
  let size = cellSize;
  let minX = 0, minY = 0, minZ = 0, maxX = 0, maxY = 0, maxZ = 0;
  const atomCell = new Int32Array(atomCount * 3);
  for (;;) {
    minX = minY = minZ = Infinity;
    maxX = maxY = maxZ = -Infinity;
    for (let a = 0; a < atomCount; a++) {
      const cx = Math.floor(atomPositions[a * 3] / size);
      const cy = Math.floor(atomPositions[a * 3 + 1] / size);
      const cz = Math.floor(atomPositions[a * 3 + 2] / size);
      atomCell[a * 3] = cx;
      atomCell[a * 3 + 1] = cy;
      atomCell[a * 3 + 2] = cz;
      if (cx < minX) minX = cx;
      if (cy < minY) minY = cy;
      if (cz < minZ) minZ = cz;
      if (cx > maxX) maxX = cx;
      if (cy > maxY) maxY = cy;
      if (cz > maxZ) maxZ = cz;
    }
    if ((maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1) <= limit) {
      break;
    }
    size *= 2;
  }
  const nx = maxX - minX + 1, ny = maxY - minY + 1, nz = maxZ - minZ + 1;
  const cellCount = nx * ny * nz;
  const cellStart = new Uint32Array(cellCount + 1);
  const cellIndex = new Uint32Array(atomCount);
  for (let a = 0; a < atomCount; a++) {
    const c = (atomCell[a * 3] - minX) +
      nx * ((atomCell[a * 3 + 1] - minY) + ny * (atomCell[a * 3 + 2] - minZ));
    cellIndex[a] = c;
    cellStart[c + 1]++;
  }
  for (let c = 0; c < cellCount; c++) cellStart[c + 1] += cellStart[c];
  const fill = cellStart.slice(0, cellCount);
  const cellAtoms = new Uint32Array(atomCount);
  for (let a = 0; a < atomCount; a++) cellAtoms[fill[cellIndex[a]]++] = a;

  const certifyRadius = (2 * size) ** 2; // squared, to compare directly against a squared distance

  const vertexCount = positions.length / 3;
  const atomIndex = new Uint32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const px = positions[v * 3],
      py = positions[v * 3 + 1],
      pz = positions[v * 3 + 2];
    const cx = Math.floor(px / size) - minX;
    const cy = Math.floor(py / size) - minY;
    const cz = Math.floor(pz / size) - minZ;
    let best = -1, bestDist = Infinity;
    for (let dx = -2; dx <= 2; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= nx) continue;
      for (let dy = -2; dy <= 2; dy++) {
        const y = cy + dy;
        if (y < 0 || y >= ny) continue;
        for (let dz = -2; dz <= 2; dz++) {
          const z = cz + dz;
          if (z < 0 || z >= nz) continue;
          const c = x + nx * (y + ny * z);
          for (let i = cellStart[c], end = cellStart[c + 1]; i < end; i++) {
            const a = cellAtoms[i];
            const ex = px - atomPositions[a * 3],
              ey = py - atomPositions[a * 3 + 1],
              ez = pz - atomPositions[a * 3 + 2];
            const d = ex * ex + ey * ey + ez * ez;
            if (d < bestDist) {
              bestDist = d;
              best = a;
            }
          }
        }
      }
    }
    if (bestDist > certifyRadius) {
      // Nothing certified in the window: exhaustive scan, in index order.
      best = -1;
      bestDist = Infinity;
      for (let a = 0; a < atomCount; a++) {
        const ex = px - atomPositions[a * 3],
          ey = py - atomPositions[a * 3 + 1],
          ez = pz - atomPositions[a * 3 + 2];
        const d = ex * ex + ey * ey + ez * ez;
        if (d < bestDist) {
          bestDist = d;
          best = a;
        }
      }
    }
    atomIndex[v] = best;
  }
  return atomIndex;
}
