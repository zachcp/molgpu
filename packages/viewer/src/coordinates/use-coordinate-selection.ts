import { useMemo } from "@use-gpu/live";
import { resolve, type Selection, type SelectionQuery } from "@molgpu/select";
import { useCoordinateSnapshot } from "./coordinate-snapshot.ts";
import { useStructureResource } from "../structure/structure-context.ts";

/** Resolve a query against published positions and root CPU attributes.
 * Returns null while a required coordinate snapshot is pending. This hook does
 * not merge GPU-produced attributes; use component select props for those. */
export function useCoordinateSelection(
  query: SelectionQuery,
): Selection | null {
  const root = useStructureResource();
  const readsPositions = query.deps.includes("positions");
  const snapshot = useCoordinateSnapshot({ enabled: readsPositions });
  const data = readsPositions ? snapshot?.data : root.data;
  return useMemo(() => data ? resolve(query, data) : null, [
    query,
    data,
    readsPositions ? snapshot?.generation : root.topologyRevision,
  ]);
}
