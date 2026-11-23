import type {
  PickHit,
  StructureResource,
  ViewerComponent,
  ViewerElement,
} from "../types.ts";
import {
  type LC,
  type LiveElement,
  makeContext,
  provide,
  use,
  useContext,
  useMemo,
  useRef,
  useResource,
  useState,
} from "@use-gpu/live";
import { Pick } from "@use-gpu/interact";
import {
  type PointerEvent,
  useCanvasEvents,
  usePickingId,
} from "@use-gpu/frame";
import { type PickEntry, resolvePick } from "./pick-resolve.ts";

import { InstanceContext } from "../rendering/instance-context.ts";

/** id -> what a pickable representation drew under that picking id. */
interface PickingRegistry {
  set(id: number, entry: PickEntry): void;
  remove(id: number): void;
  get(id: number): PickEntry | null;
  hover: PickHit | null;
  pick: PickHit | null;
  move(hit: PickHit | null): void;
  press(event: PointerEvent): void;
  subscribe(listener: {
    hover(hit: PickHit | null): void;
    pick(hit: PickHit | null): void;
  }): () => void;
}

/**
 * Molecular picking. A pickable representation draws itself into @use-gpu's
 * picking buffer under a unique object id and registers, against that id, which
 * structure it drew and the atom row each drawn instance maps to. `usePicking()`
 * resolves upstream Pick events back to a concrete atom. The scene must be
 * inside an <AutoCanvas> (which provides the
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
    const listeners = new Set<Parameters<PickingRegistry["subscribe"]>[0]>();
    let lastPress: PointerEvent | null = null;
    const registry: PickingRegistry = {
      hover: null,
      pick: null,
      set: (id, entry) => {
        map.set(id, entry);
      },
      remove: (id) => {
        map.delete(id);
        if (registry.hover?.id === id) registry.move(null);
      },
      get: (id) => map.get(id) ?? null,
      move: (hit) => {
        registry.hover = hit;
        for (const listener of listeners) listener.hover(hit);
      },
      press: (event) => {
        // Each pickable mounts an observer in its canvas event scope. One
        // canvas event must notify readers only once, including background
        // presses and scenes with multiple assembly copies.
        if (event.button !== "left" || lastPress === event) return;
        lastPress = event;
        registry.pick = resolvePick(
          [event.pickId, event.pickIndex],
          registry.get,
        );
        for (const listener of listeners) listener.pick(registry.pick);
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    return registry;
  }, []);
  return (provide(PickingRegistryContext, registry, children));
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
  // Pick owns hit/leave event routing. The plain canvas observer also sees
  // background presses; molecular readers retain their left-press contract.
  // Mount here rather than in PickingProvider, which may wrap AutoCanvas and
  // therefore sit outside the upstream event context.
  const presses = useCanvasEvents(
    null,
    useMemo(() => ({
      pointerDown: registry.press,
    }), [registry]),
  );
  return [
    presses,
    use(Pick, {
      id,
      onPointerMove: (event: PointerEvent) =>
        registry.move(resolvePick([id, event.pickIndex], registry.get)),
      onPointerLeave: () => {
        if (registry.hover?.id === id) registry.move(null);
      },
      render: () => render(id) as LiveElement,
    }),
  ];
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
  const [hover, setHover] = useState<PickHit | null>(registry.hover);
  const [pick, setPick] = useState<PickHit | null>(registry.pick);
  const callbacks = useRef(options);
  callbacks.current = { onHover, onPick };
  useResource((dispose) => {
    setHover(registry.hover);
    setPick(registry.pick);
    dispose(registry.subscribe({
      hover: (hit) => {
        setHover(hit);
        callbacks.current.onHover?.(hit);
      },
      pick: (hit) => {
        setPick(hit);
        callbacks.current.onPick?.(hit);
      },
    }));
  }, [registry]);

  return { hover, pick };
}
