import type { PickHit, StructureResource } from "../types.ts";

/** A registered pickable: its resource, and the atom row per drawn instance (null: identity). */
export interface PickEntry {
  readonly resource: StructureResource;
  readonly indices: ArrayLike<number> | null;
  /** The assembly copy this pickable drew, if any. */
  readonly operatorId?: string;
}

/**
 * Resolve a picking sample to an atom, without any GPU or live dependency — so
 * this is unit-testable under Node. `sample` is what @use-gpu's PickingContext
 * `samplePoint(x, y)` returns: `[objectId, itemIndex, ...]`, where the picking
 * shader wrote `getPickingID(i) -> vec2(getID(i), getIndex(i))` and `getIndex`
 * defaults to the drawn instance index. `get(id)` looks a registered pickable
 * up in the viewer's picking registry, returning `{ resource, indices } | null`
 * (indices maps drawn instance -> atom row, or null when the representation drew
 * the whole structure and instance index === atom row).
 *
 * Returns `{ id, resource, atom, drawIndex } | null`. Null means the cursor is
 * over the background (object id 0) or over an object not in the registry, or a
 * stale instance index outside the current selection.
 */
export const resolvePick = (
  sample: ArrayLike<number> | null | undefined,
  get: (id: number) => PickEntry | null | undefined,
): PickHit | null => {
  if (!sample || sample.length < 2) return null;
  const id = sample[0];
  if (!id) return null; // 0 is the picking clear value: background.
  const entry = get(id);
  if (!entry) return null;
  const instance = sample[1];
  const { resource, indices, operatorId } = entry;
  const copy = operatorId === undefined ? {} : { operatorId };
  if (indices) {
    if (instance < 0 || instance >= indices.length) return null;
    return {
      id,
      resource,
      atom: indices[instance],
      drawIndex: instance,
      ...copy,
    };
  }
  return { id, resource, atom: instance, drawIndex: instance, ...copy };
};
