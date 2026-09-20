import { makeContext, provide, use, useContext, useMemo, useResource } from '@use-gpu/live';
import { createStructureResource } from './internal/structure-resource.mjs';
import { ColumnSource } from './internal/column-source.mjs';

/** Nearest Structure wins; no global dataset registry is created. */
export const StructureContext = makeContext(undefined, 'StructureContext');

const provideSources = (resource, sources, children) => provide(StructureContext,
  Object.freeze({ resource, sources }), children);

const AtomSources = ({ resource, children }) => {
  const { data } = resource;
  const radii = data.topology.atoms.radius;
  // An empty structure still supplies its CPU resource, but has no GPU source.
  // Both columns are allocated exactly once here, so sibling representations
  // consume identical sources instead of uploading positions independently.
  return use(ColumnSource, { data: data.positions, format: 'vec3<f32>', revision: resource.positionsRevision,
    render: positions => positions && radii ? use(ColumnSource, { data: radii, format: 'f32', revision: resource.topologyRevision,
      render: radius => provideSources(resource, Object.freeze({ positions, radii: radius }), children),
    }) : provideSources(resource, null, children),
  });
};

/**
 * Provide one owned molecular resource to descendant representations. This is
 * intentionally canvas-agnostic, so it composes inside an existing use.gpu
 * scene and does not create a second renderer or canvas.
 */
export const StructureProvider = ({ data, maxSelections, children }) => {
  const resource = useMemo(() => createStructureResource(data, { maxSelections }), [data, maxSelections]);
  useResource(dispose => { dispose(() => resource.dispose()); }, [resource]);
  return use(AtomSources, { resource, children });
};

/** Returns { resource, sources }; sources is null for an empty structure. */
export const useStructure = () => useContext(StructureContext);
