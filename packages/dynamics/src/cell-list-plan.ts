/** The eight f32 values emitted by the final cellListWgsl bounds pass. */
export interface CellListBoundsReadback {
  /** Generation of the coordinate source when the reduction was dispatched. */
  readonly generation: number;
  /** min xyz, invalid count, max xyz, finite count. */
  readonly values: Float32Array;
}

export interface CellListPlan {
  readonly atomCount: number;
  readonly origin: readonly [number, number, number];
  readonly dims: readonly [number, number, number];
  readonly cellCount: number;
  readonly cellWidth: number;
  /** Cell IDs, counts, offsets and sorted rows, excluding existing positions. */
  readonly persistentBytes: number;
  /** Cursor, bounds and scan scratch; pair output is caller-sized. */
  readonly scratchBytes: number;
  /** Lower bound for coordinate reads in bounds and count passes. */
  readonly coordinateReadBytes: number;
}

/** Validate a compact GPU bounds readback before allocating a dense grid.
 * A stale source generation returns null so asynchronous readback cannot size
 * a grid for a newer coordinate frame. */
export function planCellList(
  readback: CellListBoundsReadback,
  expectedGeneration: number,
  atomCount: number,
  cellSize: number,
  maxStorageBufferBindingSize: number,
  maxCells: number = Math.max(1, 4 * atomCount),
): CellListPlan | null {
  if (
    !Number.isSafeInteger(readback.generation) ||
    !Number.isSafeInteger(expectedGeneration)
  ) {
    throw new TypeError("source generation must be a safe integer");
  }
  if (readback.generation !== expectedGeneration) return null;
  if (
    !Number.isSafeInteger(atomCount) || atomCount < 0 ||
    atomCount > 0xffffff
  ) {
    throw new RangeError("atom count must fit the exact f32 bounds counter");
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new TypeError("cellSize must be positive and finite");
  }
  if (
    !Number.isSafeInteger(maxStorageBufferBindingSize) ||
    maxStorageBufferBindingSize < 4
  ) {
    throw new TypeError("device storage-buffer limit must be at least 4 bytes");
  }
  if (!Number.isSafeInteger(maxCells) || maxCells < 1) {
    throw new TypeError("maxCells must be a positive safe integer");
  }
  const v = readback.values;
  if (!(v instanceof Float32Array) || v.length !== 8) {
    throw new TypeError("bounds readback must contain eight f32 values");
  }
  if (v[3] !== 0 || v[7] !== atomCount) {
    throw new RangeError(
      "bounds contain non-finite coordinates or wrong row count",
    );
  }
  const origin = atomCount ? [v[0], v[1], v[2]] as const : [0, 0, 0] as const;
  const width = cellSize * (1 + 1e-6);
  if (!Number.isFinite(width)) {
    throw new RangeError("cell width overflows f64");
  }
  const dims = atomCount
    ? [0, 1, 2].map((axis) => {
      const low = v[axis], high = v[axis + 4];
      if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) {
        throw new RangeError("invalid cell bounds");
      }
      return Math.floor((high - low) / width) + 1;
    }) as [number, number, number]
    : [0, 0, 0] as [number, number, number];
  const cells = dims[0] * dims[1] * dims[2];
  if (!Number.isSafeInteger(cells) || cells > maxCells) {
    throw new RangeError(
      `cell list needs ${cells} dense cells, limit ${maxCells}`,
    );
  }
  for (const bytes of [4 * atomCount, 4 * cells, 4 * (cells + 1)]) {
    if (bytes > maxStorageBufferBindingSize) {
      throw new RangeError("cell list exceeds device storage-buffer limit");
    }
  }
  const scanScratch = 4 * Math.ceil(cells / 256);
  const boundsScratch = 32 * Math.max(1, Math.ceil(atomCount / 64));
  return Object.freeze({
    atomCount,
    origin,
    dims: Object.freeze(dims),
    cellCount: cells,
    cellWidth: width,
    persistentBytes: 8 * atomCount + 8 * cells + 4,
    scratchBytes: 4 * cells + scanScratch + boundsScratch,
    coordinateReadBytes: 24 * atomCount,
  });
}
