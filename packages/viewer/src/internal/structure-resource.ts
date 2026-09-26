import { coordinateBounds, type StructureData } from "@molgpu/table";
import type {
  AtomSelection,
  StructureBounds,
  StructureResource,
} from "../types.ts";
import { gauge } from "./instrumentation.ts";

type Bounds = StructureBounds | null;

function fail(message: string): never {
  throw new TypeError(`Structure resource: ${message}`);
}

const assertIndices = (data: StructureData, indices: Uint32Array): void => {
  if (!(indices instanceof Uint32Array)) {
    fail("atom selections must be Uint32Array");
  }
  const count = data.topology.atoms.count;
  let previous = -1;
  for (const index of indices) {
    if (index >= count) fail("atom selection index out of range");
    if (index <= previous) fail("atom selections must be sorted and unique");
    previous = index;
  }
};

/**
 * Own the molecular values shared by one <Structure> subtree. This is a CPU
 * resource deliberately: GPU sources are created by the provider so their
 * lifetime remains tied to Live's device tree rather than to a global cache.
 */
export function createStructureResource(
  data: StructureData,
  options: { readonly maxSelections?: number } = {},
): StructureResource {
  const { maxSelections = 64 } = options;
  if (
    !data?.identity || !data?.topology ||
    !(data.positions instanceof Float32Array)
  ) fail("expected StructureData created by @molgpu/table");
  if (!Number.isSafeInteger(maxSelections) || maxSelections < 1) {
    fail("maxSelections must be a positive safe integer");
  }
  const { identity } = data;
  const topologyRevision = data.revision.topology,
    positionsRevision = data.revision.positions;
  const selections = new Map<string, AtomSelection>();
  let bounds: Bounds | undefined;
  let disposed = false;
  const assertLive = (): void => {
    if (disposed) fail("resource has been disposed");
  };

  return Object.freeze({
    data,
    identity,
    topologyRevision,
    positionsRevision,
    get bounds(): Bounds {
      assertLive();
      return bounds ??= coordinateBounds(data);
    },
    selection(indices: Uint32Array): AtomSelection {
      assertLive();
      assertIndices(data, indices);
      const key = Array.from(indices).join(",");
      const cached = selections.get(key);
      if (cached) {
        selections.delete(key);
        selections.set(key, cached);
        return cached;
      }
      const value: AtomSelection = Object.freeze({
        structure: identity,
        topologyRevision,
        positionsRevision,
        domain: "atom",
        indices: indices.slice(),
        bounds: indices.length ? coordinateBounds(data, indices) : null,
      });
      selections.set(key, value);
      if (selections.size > maxSelections) {
        selections.delete(selections.keys().next().value!);
      }
      gauge("selectionCacheSize", selections.size);
      return value;
    },
    accepts(value: unknown): boolean {
      const v = value as Partial<AtomSelection> | null;
      return !disposed && v?.structure === identity &&
        v.topologyRevision === topologyRevision &&
        v.positionsRevision === positionsRevision;
    },
    dispose(): void {
      disposed = true;
      selections.clear();
      bounds = undefined;
    },
  });
}
