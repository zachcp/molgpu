import type { Selection } from "@molgpu/select";
import { activeAtoms, type StructureData } from "@molgpu/table";

/**
 * The atom rows a molecular consumer draws or computes over. Without a
 * selection this is the default view: the first model with each residue's
 * primary (highest-occupancy) conformer. A selection replaces the default
 * view exactly — it is the one override, so it can reach other models or
 * every conformer, and it is never intersected with the default. An empty
 * selection stays empty; a missing one is the default view, never every row.
 */
export function viewRows(
  data: StructureData,
  select: Selection | null | undefined,
): Uint32Array {
  return select ? select.indices : activeAtoms(data);
}

/** `rows`, or null when they are every row in order (a draw needs no index). */
export function allOrRows(
  data: StructureData,
  rows: Uint32Array,
): Uint32Array | null {
  const n = data.topology.atoms.count;
  if (rows.length !== n) return rows;
  for (let i = 0; i < n; i++) if (rows[i] !== i) return rows;
  return null;
}
