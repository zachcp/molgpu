import { makeContext, provide, use, useContext, useMemo, useResource, type LC, type LiveContext, type LiveElement } from '@use-gpu/live';
import type { StorageSource } from '@use-gpu/core';
import type { StructureData } from '@molgpu/table';
import { createStructureResource, type StructureResource } from './internal/structure-resource.ts';
import { ColumnSource } from './internal/column-source.ts';

/** GPU columns allocated once per structure and shared by representations. */
export interface StructureSources { readonly positions: StorageSource; readonly radii: StorageSource }
export interface StructureContextValue { readonly resource: StructureResource; readonly sources: StructureSources | null }

/** Nearest Structure wins; no global dataset registry is created. */
export const StructureContext: LiveContext<StructureContextValue | undefined> =
  makeContext<StructureContextValue | undefined>(undefined, 'StructureContext');

const provideSources = (resource: StructureResource, sources: StructureSources | null, children: LiveElement): LiveElement =>
  provide(StructureContext, Object.freeze({ resource, sources }), children);

const AtomSources: LC<{ resource: StructureResource; children?: LiveElement }> = ({ resource, children }) => {
  const radii = resource.data.topology.atoms.radius;
  return use(ColumnSource, { data: resource.data.positions, format: 'vec3<f32>', revision: resource.positionsRevision, label: 'positions',
    render: (positions: StorageSource | null) => positions && radii ? use(ColumnSource, { data: radii, format: 'f32', revision: resource.topologyRevision, label: 'radii',
      render: (radius: StorageSource | null) => provideSources(resource, radius ? Object.freeze({ positions, radii: radius }) : null, children ?? null),
    }) : provideSources(resource, null, children ?? null),
  });
};

export const StructureProvider: LC<{ data: StructureData; maxSelections?: number; children?: LiveElement }> =
  ({ data, maxSelections, children }) => {
    const resource = useMemo(() => createStructureResource(data, { maxSelections }), [data, maxSelections]);
    useResource(dispose => { dispose(() => resource.dispose()); }, [resource]);
    return use(AtomSources, { resource, children });
  };

/** Returns { resource, sources }; throws outside a <Structure>. */
export const useStructure = (): StructureContextValue => {
  const context = useContext(StructureContext);
  if (!context) throw new Error('useStructure() requires a <Structure> ancestor');
  return context;
};
