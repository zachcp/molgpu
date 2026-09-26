import { coordinateBounds, type StructureData } from '@molgpu/table';
import { gauge } from './instrumentation.ts';

type Bounds = ReturnType<typeof coordinateBounds>;

/** A resolved atom set, valid only for the resource and revisions that made it. */
export interface AtomSelection {
  readonly structure: StructureData['identity'];
  readonly topologyRevision: number;
  readonly positionsRevision: number;
  readonly domain: 'atom';
  readonly indices: Uint32Array;
  readonly bounds: Bounds;
}

/** CPU-side owner of the values shared by one <Structure> subtree. */
export interface StructureResource {
  readonly data: StructureData;
  readonly identity: StructureData['identity'];
  readonly topologyRevision: number;
  readonly positionsRevision: number;
  readonly bounds: Bounds;
  selection(indices: Uint32Array): AtomSelection;
  accepts(value: unknown): boolean;
  dispose(): void;
}

const fail = (message: string): never => { throw new TypeError(`Structure resource: ${message}`); };

const assertIndices = (data: StructureData, indices: Uint32Array): void => {
  if (!(indices instanceof Uint32Array)) fail('atom selections must be Uint32Array');
  const count = data.topology.atoms.count;
  let previous = -1;
  for (const index of indices) {
    if (index >= count) fail('atom selection index out of range');
    if (index <= previous) fail('atom selections must be sorted and unique');
    previous = index;
  }
};

export const createStructureResource = (data: StructureData, { maxSelections = 64 }: { readonly maxSelections?: number } = {}): StructureResource => {
  if (!data?.identity || !data?.topology || !(data.positions instanceof Float32Array)) fail('expected StructureData created by @molgpu/table');
  if (!Number.isSafeInteger(maxSelections) || maxSelections < 1) fail('maxSelections must be a positive safe integer');
  const { identity } = data;
  const topologyRevision = data.revision.topology, positionsRevision = data.revision.positions;
  const selections = new Map<string, AtomSelection>();
  let bounds: Bounds | undefined;
  let disposed = false;
  const assertLive = (): void => { if (disposed) fail('resource has been disposed'); };

  return Object.freeze({
    data, identity, topologyRevision, positionsRevision,
    get bounds(): Bounds { assertLive(); return bounds ??= coordinateBounds(data); },
    selection(indices: Uint32Array): AtomSelection {
      assertLive();
      assertIndices(data, indices);
      const key = Array.from(indices).join(',');
      const cached = selections.get(key);
      if (cached) { selections.delete(key); selections.set(key, cached); return cached; }
      const value: AtomSelection = Object.freeze({ structure: identity, topologyRevision, positionsRevision, domain: 'atom',
        indices: indices.slice(), bounds: indices.length ? coordinateBounds(data, indices) : null });
      selections.set(key, value);
      if (selections.size > maxSelections) selections.delete(selections.keys().next().value!);
      gauge('selectionCacheSize', selections.size);
      return value;
    },
    accepts(value: unknown): boolean {
      const v = value as Partial<AtomSelection> | null;
      return !disposed && v?.structure === identity && v.topologyRevision === topologyRevision && v.positionsRevision === positionsRevision;
    },
    dispose(): void { disposed = true; selections.clear(); bounds = undefined; },
  });
};
