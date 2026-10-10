// Pure helpers for <EField>: grid placement, budgets and the charge column.
// No Live or GPU imports, so they run under plain `deno test`.
import {
  type AttributeColumn,
  attributeColumn,
  createVolumeGrid,
  type StructureData,
  type VolumeGrid,
} from "@molgpu/table";
import type { ProducedAttribute } from "../attributes/attributes-context.ts";

export type Box = {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
};

const SPACING_STEP = 0.05;

/** Smallest 0.05 Å spacing whose three minimum-two-sample axes fit. */
function fittingSpacing(
  spans: readonly number[],
  current: number,
  maxSamples: number,
): number | null {
  if (maxSamples < 8) return null;
  const fits = (ticks: number) => {
    const spacing = ticks * SPACING_STEP;
    return spans.reduce(
      (count, span) =>
        count * Math.max(2, Math.ceil(span / spacing - 1e-9) + 1),
      1,
    ) <= maxSamples;
  };
  let low = Math.max(1, Math.ceil(current / SPACING_STEP));
  let high = low;
  while (!fits(high)) {
    high *= 2;
    if (!Number.isSafeInteger(high)) return null;
  }
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) high = middle;
    else low = middle + 1;
  }
  return low * SPACING_STEP;
}

/** Axis-aligned grid over `box` padded by `padding`, `spacing` apart. */
export function efieldGrid(
  box: Box,
  spacing: number,
  padding: number,
  unit: string,
  maxSamples: number,
): VolumeGrid {
  const origin = [0, 1, 2].map((a) => box.min[a] - padding);
  const dims = [0, 1, 2].map((a) =>
    Math.max(
      2,
      Math.ceil((box.max[a] - box.min[a] + 2 * padding) / spacing - 1e-9) + 1,
    )
  ) as [number, number, number];
  const samples = dims[0] * dims[1] * dims[2];
  if (samples > maxSamples) {
    const spans = [0, 1, 2].map((a) => box.max[a] - box.min[a] + 2 * padding);
    const fit = fittingSpacing(spans, spacing, maxSamples);
    throw new RangeError(
      `<EField>: a ${dims.join("×")} grid (${samples} samples) exceeds ` +
        `maxSamples ${maxSamples}; ` +
        (fit === null
          ? "at least 8 samples are required; raise maxSamples"
          : `use spacing ≥ ${fit} Å, a smaller padding or box, or raise maxSamples`),
    );
  }
  return createVolumeGrid({
    dims,
    transform: [
      ...[spacing, 0, 0, 0],
      ...[0, spacing, 0, 0],
      ...[0, 0, spacing, 0],
      ...[origin[0], origin[1], origin[2], 1],
    ],
    unit,
  }, { maxSamples: Infinity });
}

/** Bounds of the summed rows' own positions (Å). */
export function rowBounds(
  positions: ArrayLike<number>,
  rows: ArrayLike<number>,
): Box | null {
  if (!rows.length) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < rows.length; k++) {
    for (let a = 0; a < 3; a++) {
      const v = positions[rows[k] * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}

/**
 * Throw a named RangeError when summing `atoms` onto `grid` would exceed
 * `maxPairs` pair evaluations per computation.
 */
export function checkPairBudget(
  grid: VolumeGrid,
  atoms: number,
  maxPairs: number,
): void {
  const [nx, ny, nz] = grid.dims;
  const samples = nx * ny * nz;
  if (samples * atoms <= maxPairs) return;
  const spacing = Math.hypot(
    grid.transform[0],
    grid.transform[1],
    grid.transform[2],
  );
  const spans = grid.dims.map((n) => (n - 1) * spacing);
  const fit = fittingSpacing(spans, spacing, maxPairs / atoms);
  throw new RangeError(
    `<EField>: ${samples} samples × ${atoms} charged atoms = ` +
      `${samples * atoms} pair evaluations exceeds maxPairs ${maxPairs}; ` +
      (fit === null
        ? "at least 8 samples are required; raise maxPairs or reduce charged atoms"
        : `use spacing ≥ ${fit} Å, a smaller box or select, or raise maxPairs`),
  );
}

/**
 * The charge column `<EField>` sums, or a TypeError naming how to assign one.
 * Null means a kernel produces it (no CPU values).
 */
export function efieldChargeColumn(
  data: StructureData,
  charge: string,
  produced: ProducedAttribute | undefined,
): AttributeColumn | null {
  if (produced) {
    if (produced.domain !== "atom") {
      throw new TypeError(
        `<EField> charge column '${charge}' must be per atom`,
      );
    }
    return null;
  }
  const column = attributeColumn(data, charge);
  if (!column) {
    throw new TypeError(
      `<EField> needs a '${charge}' atom column: assign charges with ` +
        "templateCharges (@molgpu/dynamics), applyPqr or structureFromPqr " +
        "(@molgpu/io), then withAttributes",
    );
  }
  if (column.domain !== "atom") {
    throw new TypeError(`<EField> charge column '${charge}' must be per atom`);
  }
  return column;
}

/**
 * `rows` reordered along a Morton curve over `cell`-sized cells of their
 * positions, so consecutive rows (and so each 64-atom tile) sit close
 * together. Pure ordering: the same rows, the same multiset of terms.
 */
export function spatialOrder(
  positions: ArrayLike<number>,
  rows: Uint32Array,
  cell: number,
): Uint32Array {
  if (rows.length < 2) return rows;
  let lx = Infinity, ly = Infinity, lz = Infinity;
  for (const row of rows) {
    lx = Math.min(lx, positions[row * 3]);
    ly = Math.min(ly, positions[row * 3 + 1]);
    lz = Math.min(lz, positions[row * 3 + 2]);
  }
  // Interleave the low 10 bits of each cell coordinate (wider spreads wrap,
  // which only weakens locality).
  const spread = (v: number) => {
    let x = v & 0x3ff;
    x = (x | (x << 16)) & 0x030000ff;
    x = (x | (x << 8)) & 0x0300f00f;
    x = (x | (x << 4)) & 0x030c30c3;
    x = (x | (x << 2)) & 0x09249249;
    return x;
  };
  const keys = new Float64Array(rows.length);
  rows.forEach((row, i) => {
    const cx = Math.floor((positions[row * 3] - lx) / cell);
    const cy = Math.floor((positions[row * 3 + 1] - ly) / cell);
    const cz = Math.floor((positions[row * 3 + 2] - lz) / cell);
    keys[i] = spread(cx) | (spread(cy) << 1) | (spread(cz) << 2);
  });
  const order = Array.from(rows.keys()).sort((a, b) =>
    keys[a] - keys[b] || rows[a] - rows[b]
  );
  return Uint32Array.from(order, (i) => rows[i]);
}
