import { useMemo } from "@use-gpu/live";
import { resolve, type Selection, type SelectionQuery } from "@molgpu/select";
import { useCoordinateSnapshot } from "./coordinate-snapshot.ts";
import { useStructureResource } from "./structure-context.ts";

/** Resolve a reusable query against published positions when it reads them. */
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
