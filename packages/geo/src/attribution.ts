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
 * there is within one `cellSize` of the vertex, no atom outside the window
 * could possibly be closer — an unsearched cell at Chebyshev distance 3 is
 * always at least `2 * cellSize` away — so that result is certified
 * correct. Otherwise (including an empty window) this falls back to an
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

  const cellOf = (
    x: number,
    y: number,
    z: number,
  ): [number, number, number] => [
    Math.floor(x / cellSize),
    Math.floor(y / cellSize),
    Math.floor(z / cellSize),
  ];
  const key = (cx: number, cy: number, cz: number): string =>
    `${cx},${cy},${cz}`;
  const cells = new Map<string, number[]>();
  for (let a = 0; a < atomCount; a++) {
    const [cx, cy, cz] = cellOf(
      atomPositions[a * 3],
      atomPositions[a * 3 + 1],
      atomPositions[a * 3 + 2],
    );
    const k = key(cx, cy, cz);
    let bucket = cells.get(k);
    if (!bucket) cells.set(k, bucket = []);
    bucket.push(a);
  }

  const distSq = (v: number, a: number): number => {
    const dx = positions[v * 3] - atomPositions[a * 3],
      dy = positions[v * 3 + 1] - atomPositions[a * 3 + 1],
      dz = positions[v * 3 + 2] - atomPositions[a * 3 + 2];
    return dx * dx + dy * dy + dz * dz;
  };
  const nearestAmong = (
    v: number,
    candidates: Iterable<number>,
  ): [number, number] => {
    let best = -1, bestDist = Infinity;
    for (const a of candidates) {
      const d = distSq(v, a);
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    return [best, bestDist];
  };
  const allAtomIndices = Array.from({ length: atomCount }, (_, a) => a);
  const certifyRadius = (2 * cellSize) ** 2; // squared, to compare directly against distSq

  const vertexCount = positions.length / 3;
  const atomIndex = new Uint32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const [cx, cy, cz] = cellOf(
      positions[v * 3],
      positions[v * 3 + 1],
      positions[v * 3 + 2],
    );
    const nearby: number[] = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -2; dz <= 2; dz++) {
          const bucket = cells.get(key(cx + dx, cy + dy, cz + dz));
          if (bucket) nearby.push(...bucket);
        }
      }
    }
    const [windowBest, windowDist] = nearby.length
      ? nearestAmong(v, nearby)
      : [-1, Infinity];
    atomIndex[v] = windowDist <= certifyRadius
      ? windowBest
      : nearestAmong(v, allAtomIndices)[0];
  }
  return atomIndex;
}
