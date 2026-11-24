import { bondTopology, type StructureData } from "@molgpu/table";
import { count, countOnce } from "../../internal/instrumentation.ts";

/** LineLayer runs for a bond selection: positions, segment codes, and each vertex's atom row. */
export interface BondColumns {
  readonly n: number;
  readonly positions: Float32Array;
  readonly segments: Int32Array;
  readonly rows: Uint32Array;
}

/** Topology-only bond rows: two atom rows per kept bond. */
export interface BondRows {
  /** Kept bonds. */
  readonly n: number;
  readonly endpoints: Uint32Array;
}

/** Endpoint rows depend on topology and selection only, never on colour. */
export function buildBondRows(
  data: StructureData,
  indices: Uint32Array | null,
  endpoints: "both" | "either",
): BondRows {
  count("geometryBuilds", "bonds:columns");
  if (!data.topology.bonds.count) {
    countOnce(
      data,
      `${data.revision?.positions}`,
      "topologyBuilds",
      "bonds:infer",
    );
  }
  const bonds = bondTopology(data);
  const keep = indices ? new Set(indices) : null;
  const pairs: number[] = [];
  for (let b = 0; b < bonds.count; b++) {
    const a = bonds.a[b], z = bonds.b[b];
    if (
      !keep ||
      (endpoints === "either"
        ? keep.has(a) || keep.has(z)
        : keep.has(a) && keep.has(z))
    ) pairs.push(a, z);
  }
  return { n: pairs.length / 2, endpoints: Uint32Array.from(pairs) };
}

/**
 * Build the LineLayer runs for a bond selection. Default two-colour bonds use
 * two independent strokes that meet at the midpoint. Their atom row mapping
 * is [A,A,B,B], so both vertices of each half receive one element colour.
 * Other styles retain the original [A,B] run and geometry.
 */
export function buildBondColumns(
  data: StructureData,
  indices: Uint32Array | null,
  endpoints: "both" | "either",
  splitAtMidpoint = false,
): BondColumns {
  const { endpoints: pairs } = buildBondRows(data, indices, endpoints);
  const perBond = splitAtMidpoint ? 4 : 2;
  const n = pairs.length / 2 * perBond;
  const positions = new Float32Array(n * 3);
  const segments = new Int32Array(n);
  const rows = new Uint32Array(n);
  for (let b = 0; b < pairs.length / 2; b++) {
    const a = pairs[b * 2], z = pairs[b * 2 + 1];
    const start = b * perBond;
    if (splitAtMidpoint) {
      rows.set([a, a, z, z], start);
      segments.set([1, 2, 1, 2], start);
    } else {
      rows.set([a, z], start);
      segments.set([1, 2], start);
    }
    const a3 = a * 3, z3 = z * 3;
    if (splitAtMidpoint) {
      for (let axis = 0; axis < 3; axis++) {
        const left = data.positions[a3 + axis],
          right = data.positions[z3 + axis];
        const middle = (left + right) / 2;
        positions[(start + 0) * 3 + axis] = left;
        positions[(start + 1) * 3 + axis] = middle;
        positions[(start + 2) * 3 + axis] = middle;
        positions[(start + 3) * 3 + axis] = right;
      }
    } else {
      for (let axis = 0; axis < 3; axis++) {
        positions[(start + 0) * 3 + axis] = data.positions[a3 + axis];
        positions[(start + 1) * 3 + axis] = data.positions[z3 + axis];
      }
    }
  }
  return { n, positions, segments, rows };
}
