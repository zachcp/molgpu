import { makeContext, provide, useContext, useState, useMemo, useOne, useResource } from '@use-gpu/live';
import { usePickingId, usePickingContext, useMouseState } from '@use-gpu/workbench';
import { resolvePick } from './internal/pick-resolve.mjs';
import { tooltipFields } from './internal/tooltip.mjs';

export { tooltipFields };

/**
 * Molecular picking. A pickable representation draws itself into @use-gpu's
 * picking buffer under a unique object id and registers, against that id, which
 * structure it drew and the atom row each drawn instance maps to. `usePicking()`
 * samples the picking buffer under the cursor and resolves the hit back to a
 * concrete atom. The scene must be inside an <AutoCanvas> (which provides the
 * picking target and pointer events, both on by default) and a <Pass picking>,
 * and everything picking-related must be inside a <PickingProvider>.
 */

const PickingRegistryContext = makeContext(null, 'MolPickingRegistry');

/**
 * Owns the id -> { resource, indices } registry that maps a picking hit back to
 * an atom. Wrap the scene (both the pickable representations and any usePicking()
 * caller) in one of these.
 */
export const PickingProvider = ({ children }) => {
  const registry = useMemo(() => {
    const map = new Map();
    return {
      set: (id, entry) => map.set(id, entry),
      remove: (id) => map.delete(id),
      get: (id) => map.get(id) ?? null,
    };
  }, []);
  return provide(PickingRegistryContext, registry, children);
};

const useRegistry = () => {
  const registry = useContext(PickingRegistryContext);
  if (!registry) throw new Error('picking requires a <PickingProvider> ancestor');
  return registry;
};

/**
 * Internal: allocates a picking id, registers what it maps to, and hands the id
 * to `render` so the representation can pass it to its layer. Mounted only when
 * a representation is `pickable`, so non-pickable representations never take a
 * picking id or require the event context. `indices` is the selection's atom
 * rows (drawn-instance -> atom row), or null when the whole structure is drawn
 * and the instance index already is the atom row.
 */
export const Pickable = ({ resource, indices = null, render }) => {
  const registry = useRegistry();
  const id = usePickingId();
  useResource(() => {
    registry.set(id, { resource, indices });
    return () => registry.remove(id);
  }, [registry, id, resource, indices]);
  return render(id);
};

/**
 * Resolve the atom under the cursor. Returns `{ hover, pick }`, each either null
 * or `{ id, resource, atom, instance }`. `hover` tracks the pointer; `pick` is
 * the last atom a left press landed on (the click-to-seek hook — the caller maps
 * the picked atom to a beat and seeks its own TimelineProvider, since time stays
 * caller-owned). Optional `onHover`/`onPick` fire on change with the same value.
 */
export const usePicking = ({ onHover, onPick } = {}) => {
  const registry = useRegistry();
  const { samplePoint } = usePickingContext();
  const mouse = useMouseState();
  const [hover, setHover] = useState(null);
  const [pick, setPick] = useState(null);
  const prev = useOne(() => ({ left: false }));

  // Runs once per pointer event (mouse is a fresh object each time), not per
  // frame. samplePoint reads the picking buffer PickingTarget refreshes each
  // frame, so a move resolves against the latest render.
  useResource(() => {
    const resolved = resolvePick(samplePoint(mouse.x, mouse.y), registry.get);
    setHover(resolved);
    if (onHover) onHover(resolved);
    const left = !!mouse.buttons?.left;
    if (left && !prev.left) { // left-button press edge = a pick
      setPick(resolved);
      if (onPick) onPick(resolved);
    }
    prev.left = left;
  }, [mouse]);

  return { hover, pick };
};
