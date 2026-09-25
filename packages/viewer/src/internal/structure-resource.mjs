import { coordinateBounds } from '@molgpu/table';
import { gauge } from './instrumentation.mjs';

const fail = message => { throw new TypeError(`Structure resource: ${message}`); };

const assertIndices = (data, indices) => {
  if (!(indices instanceof Uint32Array)) fail('atom selections must be Uint32Array');
  const count = data.topology.atoms.count;
  let previous = -1;
  for (const index of indices) {
    if (index >= count) fail('atom selection index out of range');
    if (index <= previous) fail('atom selections must be sorted and unique');
    previous = index;
  }
};

const selectionKey = indices => Array.from(indices).join(',');

/**
 * Own the molecular values shared by one <Structure> subtree. This is a CPU
 * resource deliberately: GPU sources are created by the provider so their
 * lifetime remains tied to Live's device tree rather than to a global cache.
 */
export const createStructureResource = (data, { maxSelections = 64 } = {}) => {
  if (!data?.identity || !data?.topology || !(data.positions instanceof Float32Array)) {
    fail('expected StructureData created by @molgpu/table');
  }
  if (!Number.isSafeInteger(maxSelections) || maxSelections < 1) {
    fail('maxSelections must be a positive safe integer');
  }

  const identity = data.identity;
  const topologyRevision = data.revision?.topology;
  const positionsRevision = data.revision?.positions;
  const selections = new Map();
  let bounds;
  let disposed = false;

  const assertLive = () => {
    if (disposed) fail('resource has been disposed');
  };
  const selection = indices => {
    assertLive();
    assertIndices(data, indices);
    const key = selectionKey(indices);
    const cached = selections.get(key);
    if (cached) {
      // LRU touch. A resolved mapping is safe only for this exact dataset and
      // topology revision; coordinates do not alter atom membership.
      selections.delete(key); selections.set(key, cached);
      return cached;
    }
    const value = Object.freeze({
      structure: identity,
      topologyRevision,
      positionsRevision,
      domain: 'atom',
      indices: indices.slice(),
      bounds: indices.length ? coordinateBounds(data, indices) : null,
    });
    selections.set(key, value);
    if (selections.size > maxSelections) selections.delete(selections.keys().next().value);
    gauge('selectionCacheSize', selections.size);
    return value;
  };

  return Object.freeze({
    data,
    identity,
    topologyRevision,
    positionsRevision,
    get bounds() {
      assertLive();
      return bounds ??= coordinateBounds(data);
    },
    selection,
    /** Reject foreign/stale selection handles at component boundaries. */
    accepts(value) {
      return !disposed && value?.structure === identity && value.topologyRevision === topologyRevision &&
        value.positionsRevision === positionsRevision;
    },
    dispose() { disposed = true; selections.clear(); bounds = undefined; },
  });
};
