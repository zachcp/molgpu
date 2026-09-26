import { coordinateBounds, type StructureData } from "@molgpu/table";
import type { StructureBounds, StructureResource } from "../types.ts";

type Bounds = StructureBounds | null;

function fail(message: string): never {
  throw new TypeError(`Structure resource: ${message}`);
}

/**
 * Own the molecular values shared by one <Structure> subtree. This is a CPU
 * resource deliberately: GPU sources are created by the provider so their
 * lifetime remains tied to Live's device tree rather than to a global cache.
 * Resolved atom sets are @molgpu/select Selections; the resource keeps none.
 */
export function createStructureResource(
  data: StructureData,
): StructureResource {
  if (
    !data?.identity || !data?.topology ||
    !(data.positions instanceof Float32Array)
  ) fail("expected StructureData created by @molgpu/table");
  let bounds: Bounds | undefined;
  let disposed = false;

  return Object.freeze({
    data,
    identity: data.identity,
    topologyRevision: data.revision.topology,
    positionsRevision: data.revision.positions,
    get bounds(): Bounds {
      if (disposed) fail("resource has been disposed");
      return bounds ??= coordinateBounds(data);
    },
    dispose(): void {
      disposed = true;
      bounds = undefined;
    },
  });
}
