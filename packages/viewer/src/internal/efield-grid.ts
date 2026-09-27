// Pure helpers for <EField>: grid placement, budgets and the charge column.
// No Live or GPU imports, so they run under plain `deno test`.
import {
  type AttributeColumn,
  attributeColumn,
  createVolumeGrid,
  type StructureData,
  type VolumeGrid,
} from "@molgpu/table";
import type { ProducedAttribute } from "../attributes-context.ts";

export type Box = {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
};

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
    // The spacing at which the same box fits, rounded up to 0.05 Å.
    const fit = Math.ceil(spacing * Math.cbrt(samples / maxSamples) * 20) / 20;
    throw new RangeError(
      `<EField>: a ${dims.join("×")} grid (${samples} samples) exceeds ` +
        `maxSamples ${maxSamples}; use spacing ≥ ${fit} Å, a smaller padding ` +
        "or box, or raise maxSamples",
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
  const fit = Math.ceil(spacing * Math.cbrt(samples * atoms / maxPairs) * 20) /
    20;
  throw new RangeError(
    `<EField>: ${samples} samples × ${atoms} charged atoms = ` +
      `${samples * atoms} pair evaluations exceeds maxPairs ${maxPairs}; ` +
      `use spacing ≥ ${fit} Å, a smaller box or select, or raise maxPairs`,
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
