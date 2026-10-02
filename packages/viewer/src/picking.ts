import type {
  PickHit,
  StructureResource,
  ViewerComponent,
  ViewerElement,
} from "./types.ts";
import {
  type LC,
  type LiveElement,
  makeContext,
  provide,
  useContext,
  useMemo,
  useOne,
  useResource,
  useState,
} from "@use-gpu/live";
import {
  useMouseState,
  usePickingContext,
  usePickingId,
} from "@use-gpu/workbench";
import { type PickEntry, resolvePick } from "./internal/pick-resolve.ts";
import { live, viewer } from "./internal/elements.ts";
import { InstanceContext } from "./internal/instance-context.ts";

/** id -> what a pickable representation drew under that picking id. */
interface PickingRegistry {
  set(id: number, entry: PickEntry): void;
  remove(id: number): void;
  get(id: number): PickEntry | null;
}

/**
 * Molecular picking. A pickable representation draws itself into @use-gpu's
 * picking buffer under a unique object id and registers, against that id, which
 * structure it drew and the atom row each drawn instance maps to. `usePicking()`
 * samples the picking buffer under the cursor and resolves the hit back to a
 * concrete atom. The scene must be inside an <AutoCanvas> (which provides the
 * picking target and pointer events, both on by default) and a <Pass picking>,
 * and everything picking-related must be inside a <PickingProvider>.
 */

const PickingRegistryContext = makeContext<PickingRegistry | null>(
  null,
  "MolPickingRegistry",
);

/**
 * Owns the id -> { resource, indices } registry that maps a picking hit back to
 * an atom. Wrap the scene (both the pickable representations and any usePicking()
 * caller) in one of these.
 */
export const PickingProvider: ViewerComponent<{ children?: ViewerElement }> = (
  { children },
) => {
  const registry = useMemo((): PickingRegistry => {
    const map = new Map<number, PickEntry>();
    return {
      set: (id, entry) => {
        map.set(id, entry);
      },
      remove: (id) => {
        map.delete(id);
      },
      get: (id) => map.get(id) ?? null,
    };
  }, []);
  return viewer(provide(PickingRegistryContext, registry, live(children)));
};

const useRegistry = (): PickingRegistry => {
  const registry = useContext(PickingRegistryContext);
  if (!registry) {
    throw new Error("picking requires a <PickingProvider> ancestor");
  }
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
export const Pickable: LC<{
  resource: StructureResource;
  indices?: ArrayLike<number> | null;
  render: (id: number) => LiveElement | ViewerElement;
}> = ({ resource, indices = null, render }) => {
  const registry = useRegistry();
  const id = usePickingId();
  const copy = useContext(InstanceContext);
  // Live runs cleanup registered through `dispose`; a returned function would
  // only become the resource's value, leaving a stale entry after unmount.
  useResource((dispose) => {
    registry.set(id, {
      resource,
      indices,
      ...(copy ? { operatorId: copy.operatorId } : {}),
    });
    dispose(() => registry.remove(id));
  }, [registry, id, resource, indices, copy]);
  return render(id) as LiveElement;
};

/**
 * Resolve the atom under the cursor. Returns `{ hover, pick }`, each either null
 * or `{ id, resource, atom, drawIndex }`. `hover` tracks the pointer; `pick` is
 * the last atom a left press landed on (the click-to-seek hook — the caller maps
 * the picked atom to a beat and seeks its own TimelineProvider, since time stays
 * caller-owned). Optional `onHover`/`onPick` fire on change with the same value.
 */
export function usePicking(options: {
  onHover?: (hit: PickHit | null) => void;
  onPick?: (hit: PickHit | null) => void;
} = {}): { hover: PickHit | null; pick: PickHit | null } {
  const { onHover, onPick } = options;
  const registry = useRegistry();
  const { samplePoint } = usePickingContext();
  const mouse = useMouseState();
  const [hover, setHover] = useState<PickHit | null>(null);
  const [pick, setPick] = useState<PickHit | null>(null);
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
}
