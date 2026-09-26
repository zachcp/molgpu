import {
  type LC,
  type LiveContext,
  type LiveElement,
  makeContext,
  provide,
  use,
  useContext,
  useMemo,
  useResource,
} from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import type { ShaderSource } from "@use-gpu/shader";
import { atomRadii, type StructureData } from "@molgpu/table";
import type { StructureResource } from "./types.ts";
import { createStructureResource } from "./internal/structure-resource.ts";
import { ColumnSource } from "./internal/column-source.ts";
import { CoordinatesContext } from "./coordinates-context.ts";
import {
  CoordinateSnapshotContext,
  rootSnapshot,
} from "./coordinate-snapshot.ts";

/** GPU columns allocated once per structure and shared by representations. */
export interface StructureSources {
  /** @deprecated Read the nearest stream with useCoordinates().source. */
  readonly positions: ShaderSource;
  readonly radii: ShaderSource;
}

export interface StructureContextValue {
  readonly resource: StructureResource;
  /** Null for an empty structure, which owns no GPU source. */
  readonly sources: StructureSources | null;
}

/** Nearest Structure wins; no global dataset registry is created. */
export const StructureContext: LiveContext<StructureContextValue | undefined> =
  makeContext<StructureContextValue | undefined>(undefined, "StructureContext");

const provideSources = (
  resource: StructureResource,
  sources: StructureSources | null,
  children: LiveElement,
): LiveElement =>
  provide(
    StructureContext,
    Object.freeze({ resource, sources }),
    provide(
      CoordinatesContext,
      sources
        ? Object.freeze({
          source: sources.positions as StorageSource,
          count: resource.data.topology.atoms.count,
          generation: resource.positionsRevision,
          resource,
        })
        : null,
      provide(CoordinateSnapshotContext, rootSnapshot(resource), children),
    ),
  );

const AtomSources: LC<{ resource: StructureResource; children: LiveElement }> =
  ({ resource, children }) => {
    const { data } = resource;
    // An empty structure still supplies its CPU resource, but has no GPU source.
    // Both columns are allocated exactly once here, so sibling representations
    // consume identical sources instead of uploading positions independently.
    // Radii always exist: the dataset's column, else element defaults.
    return use(ColumnSource, {
      data: data.positions,
      format: "vec3to4<f32>",
      label: "positions",
      counter: "structure:positions",
      render: (positions: StorageSource | null) =>
        positions
          ? use(ColumnSource, {
            data: atomRadii(data),
            format: "f32",
            label: "radii",
            counter: "structure:radii",
            render: (radii: StorageSource | null) =>
              provideSources(
                resource,
                Object.freeze({ positions, radii: radii! }),
                children,
              ),
          })
          : provideSources(resource, null, children),
    });
  };

/**
 * Provide one owned molecular resource to descendant representations. This is
 * intentionally canvas-agnostic, so it composes inside an existing use.gpu
 * scene and does not create a second renderer or canvas.
 */
export const StructureProvider: LC<
  { data: StructureData; children?: LiveElement }
> = ({ data, children }) => {
  const resource = useMemo(() => createStructureResource(data), [data]);
  useResource((dispose) => {
    dispose(() => resource.dispose());
  }, [resource]);
  return use(AtomSources, { resource, children: children ?? null });
};

/** The nearest <Structure>'s StructureResource, without its GPU sources. */
export function useStructureResource(): StructureResource {
  const context = useContext(StructureContext);
  if (!context) {
    throw new Error("useStructureResource() requires a <Structure> ancestor");
  }
  return context.resource;
}

/** Returns { resource, sources }; sources is null for an empty structure.
 * Missing context is a composition mistake, not a renderable empty state. */
export function useStructure(): StructureContextValue {
  const context = useContext(StructureContext);
  if (!context) {
    throw new Error("useStructure() requires a <Structure> ancestor");
  }
  return context;
}
