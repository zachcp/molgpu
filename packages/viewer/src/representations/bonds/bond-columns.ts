import { bondTopology, type StructureData } from "@molgpu/table";
import { count, countOnce } from "../../internal/instrumentation.ts";

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
