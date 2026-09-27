/** Limits on a uniform-grid neighbour index over packed xyz positions. */
export interface CellListOptions {
  /** Sorted, unique topology rows to index; omitted indexes every row. */
  readonly rows?: ArrayLike<number> | null;
  /** Maximum dense cells; defaults to four per indexed atom. */
  readonly maxCells?: number;
  /** Maximum candidate rows one query may inspect; defaults to 4096. */
  readonly maxCandidates?: number;
}

/** Counting-sort grid in topology row order. `offsets[c]..offsets[c+1]` are cell c. */
export interface CellList {
  readonly cellSize: number;
  readonly origin: readonly [number, number, number];
  readonly dims: readonly [number, number, number];
  readonly counts: Uint32Array;
  readonly offsets: Uint32Array;
  readonly rows: Uint32Array;
  /** Visit exact neighbours within `cutoff`, stopping when visitor returns true. */
  near(
    x: number,
    y: number,
    z: number,
    cutoff: number,
    visit: (row: number) => boolean | void,
  ): boolean;
  /** Flattened, lexicographically sorted unordered row pairs within cutoff. */
  pairsWithin(cutoff: number, maxPairs?: number): Uint32Array;
}

// f32 needs a representable margin around cells whose pair sits on a boundary.
const WIDEN = 1 + 1e-6;

function positiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

/** CPU reference for the count/prefix/scatter GPU cell list. */
export function createCellList(
  positions: Float32Array,
  cellSize: number,
  options: CellListOptions = {},
): CellList {
  if (positions.length % 3 !== 0) {
    throw new TypeError("positions must contain packed xyz triples");
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new TypeError("cellSize must be positive and finite");
  }
  const atomCount = positions.length / 3;
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      throw new TypeError(`positions[${i}] must be finite`);
    }
  }
  const requested = options.rows;
  const n = requested ? requested.length : atomCount;
  if (!Number.isSafeInteger(n) || n > 0xffffffff) {
    throw new RangeError("cell list atom count exceeds u32 indexing");
  }
  const indexed = new Uint32Array(n);
  for (let k = 0; k < n; k++) {
    const row = requested ? requested[k] : k;
    if (
      !Number.isSafeInteger(row) || row < 0 || row >= atomCount ||
      (requested && k && row <= indexed[k - 1])
    ) {
      throw new TypeError("rows must be sorted, unique atom indices in range");
    }
    indexed[k] = row;
  }
  const maxCells = options.maxCells ?? Math.max(1, 4 * n);
  const maxCandidates = options.maxCandidates ?? 4096;
  positiveInteger(maxCells, "maxCells");
  positiveInteger(maxCandidates, "maxCandidates");

  let loX = Infinity, loY = Infinity, loZ = Infinity;
  let hiX = -Infinity, hiY = -Infinity, hiZ = -Infinity;
  for (const row of indexed) {
    const i = row * 3;
    loX = Math.min(loX, positions[i]);
    loY = Math.min(loY, positions[i + 1]);
    loZ = Math.min(loZ, positions[i + 2]);
    hiX = Math.max(hiX, positions[i]);
    hiY = Math.max(hiY, positions[i + 1]);
    hiZ = Math.max(hiZ, positions[i + 2]);
  }
  const origin: [number, number, number] = n ? [loX, loY, loZ] : [0, 0, 0];
  const width = cellSize * WIDEN;
  const dims: [number, number, number] = n
    ? [hiX - loX, hiY - loY, hiZ - loZ].map((span) =>
      Math.floor(span / width) + 1
    ) as [number, number, number]
    : [0, 0, 0];
  const cellCount = dims[0] * dims[1] * dims[2];
  if (!Number.isSafeInteger(cellCount) || cellCount > maxCells) {
    throw new RangeError(
      `cell list needs ${cellCount} dense cells, limit ${maxCells}`,
    );
  }
  const cellOf = (
    x: number,
    y: number,
    z: number,
  ): [number, number, number] => [
    Math.floor((x - origin[0]) / width),
    Math.floor((y - origin[1]) / width),
    Math.floor((z - origin[2]) / width),
  ];
  const flat = (ix: number, iy: number, iz: number) =>
    ix + dims[0] * (iy + dims[1] * iz);
  const counts = new Uint32Array(cellCount);
  for (const row of indexed) {
    const i = row * 3;
    const [ix, iy, iz] = cellOf(
      positions[i],
      positions[i + 1],
      positions[i + 2],
    );
    counts[flat(ix, iy, iz)]++;
  }
  const offsets = new Uint32Array(cellCount + 1);
  for (let c = 0; c < cellCount; c++) offsets[c + 1] = offsets[c] + counts[c];
  const cursor = offsets.slice(0, cellCount);
  const rows = new Uint32Array(n);
  for (const row of indexed) {
    const i = row * 3;
    const [ix, iy, iz] = cellOf(
      positions[i],
      positions[i + 1],
      positions[i + 2],
    );
    rows[cursor[flat(ix, iy, iz)]++] = row;
  }
  const checkCutoff = (cutoff: number) => {
    if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > cellSize) {
      throw new TypeError("cutoff must be finite and within [0, cellSize]");
    }
  };
  const near: CellList["near"] = (x, y, z, cutoff, visit) => {
    checkCutoff(cutoff);
    if (![x, y, z].every(Number.isFinite)) {
      throw new TypeError("query point must be finite");
    }
    if (!n) return false;
    const [cx, cy, cz] = cellOf(x, y, z);
    const squared = cutoff * cutoff;
    let visited = 0;
    for (
      let iz = Math.max(0, cz - 1);
      iz <= Math.min(dims[2] - 1, cz + 1);
      iz++
    ) {
      for (
        let iy = Math.max(0, cy - 1);
        iy <= Math.min(dims[1] - 1, cy + 1);
        iy++
      ) {
        for (
          let ix = Math.max(0, cx - 1);
          ix <= Math.min(dims[0] - 1, cx + 1);
          ix++
        ) {
          const cell = flat(ix, iy, iz);
          for (let slot = offsets[cell]; slot < offsets[cell + 1]; slot++) {
            if (++visited > maxCandidates) {
              throw new RangeError(
                `cell list query exceeds ${maxCandidates} candidates`,
              );
            }
            const row = rows[slot], p = row * 3;
            const dx = positions[p] - x,
              dy = positions[p + 1] - y,
              dz = positions[p + 2] - z;
            if (dx * dx + dy * dy + dz * dz <= squared && visit(row)) {
              return true;
            }
          }
        }
      }
    }
    return false;
  };
  const pairsWithin: CellList["pairsWithin"] = (
    cutoff,
    maxPairs = 1_000_000,
  ) => {
    positiveInteger(maxPairs, "maxPairs");
    const pairs: number[][] = [];
    for (const row of indexed) {
      const i = row * 3;
      near(
        positions[i],
        positions[i + 1],
        positions[i + 2],
        cutoff,
        (other) => {
          if (other > row) {
            if (pairs.length >= maxPairs) {
              throw new RangeError(`cell list exceeds ${maxPairs} pairs`);
            }
            pairs.push([row, other]);
          }
        },
      );
    }
    pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return Uint32Array.from(pairs.flat());
  };
  return Object.freeze({
    cellSize,
    origin: Object.freeze(origin),
    dims: Object.freeze(dims),
    counts,
    offsets,
    rows,
    near,
    pairsWithin,
  });
}
