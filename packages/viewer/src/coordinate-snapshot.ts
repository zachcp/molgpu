import {
  type LC,
  type LiveContext,
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
import { type StructureData, withPositions } from "@molgpu/table";
import { preserveBondGraph } from "@molgpu/select";
import type { Coordinates } from "./coordinates-context.ts";
import type { StructureResource } from "./types.ts";
import { createStructureResource } from "./internal/structure-resource.ts";
import { ThrottledReadback } from "./internal/throttled-readback.ts";
import {
  type ReadbackToken,
  sameReadbackSource,
  sameReadbackToken,
} from "./internal/readback-token.ts";

export interface CoordinateSnapshot {
  readonly data: StructureData;
  readonly generation: number;
  readonly resource: StructureResource;
}

interface SnapshotContextValue {
  readonly token?: ReadbackToken;
  readonly snapshot: CoordinateSnapshot | null;
  readonly subscribe: (maxHz: number, onPause: boolean) => () => void;
}

export const CoordinateSnapshotContext: LiveContext<
  SnapshotContextValue | undefined
> = makeContext<SnapshotContextValue | undefined>(
  undefined,
  "CoordinateSnapshotContext",
);

const noop = () => {};

/** Root coordinates already exist on the CPU and need no readback. */
export function rootSnapshot(
  resource: StructureResource,
): SnapshotContextValue {
  return {
    snapshot: Object.freeze({
      data: resource.data,
      generation: resource.positionsRevision,
      resource,
    }),
    subscribe: () => noop,
  };
}

/** Latest published CPU positions for a snapshot consumer. */
export function useCoordinateSnapshot(
  options: { maxHz?: number; onPause?: boolean; enabled?: boolean } = {},
): CoordinateSnapshot | null {
  const context = useContext(CoordinateSnapshotContext);
  if (!context) {
    throw new Error("useCoordinateSnapshot() requires a <Structure> ancestor");
  }
  const maxHz = options.maxHz ?? 4;
  const onPause = options.onPause ?? true;
  const enabled = options.enabled ?? true;
  if (!Number.isFinite(maxHz) || maxHz <= 0) {
    throw new TypeError(
      "useCoordinateSnapshot maxHz must be positive and finite",
    );
  }
  useResource((dispose) => {
    if (enabled) dispose(context.subscribe(maxHz, onPause));
  }, [context.subscribe, maxHz, onPause, enabled]);
  return enabled ? context.snapshot : null;
}

interface Request {
  maxHz: number;
  onPause: boolean;
}

/** One demand-driven readback shared by CPU consumers below a provider. */
export const CoordinateSnapshotBoundary: LC<{
  coordinates: Coordinates;
  children: LiveElement;
}> = ({ coordinates, children }) => {
  const [requests, setRequests] = useState<Map<number, Request>>(new Map());
  const demand = [...requests.values()];
  const nextId = useRef(0);
  const [published, setPublished] = useState<
    {
      data: StructureData;
      token: ReadbackToken;
    } | null
  >(null);
  const token: ReadbackToken = {
    owner: coordinates.resource,
    buffer: coordinates.source.buffer,
    bytes: coordinates.count * 12,
    layout: coordinates.count,
    generation: coordinates.generation,
  };
  const latest = useRef(token);
  latest.current = token;
  const subscribe = useMemo(() => (maxHz: number, onPause: boolean) => {
    const id = ++nextId.current;
    setRequests((previous) => new Map(previous).set(id, { maxHz, onPause }));
    return () => {
      setRequests((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
    };
  }, []);
  const data = published && sameReadbackSource(published.token, token)
    ? published.data
    : null;
  const snapshotResource = useMemo(
    () => data ? createStructureResource(data) : null,
    [data],
  );
  useResource((dispose) => {
    if (snapshotResource) dispose(() => snapshotResource.dispose());
  }, [snapshotResource]);
  const context = useMemo<SnapshotContextValue>(() => ({
    token,
    snapshot: data && snapshotResource && published
      ? Object.freeze({
        data,
        generation: published.token.generation,
        resource: snapshotResource,
      })
      : null,
    subscribe,
  }), [
    data,
    snapshotResource,
    published,
    subscribe,
    token.owner,
    token.buffer,
    token.layout,
    token.generation,
  ]);
  const publish = (positions: Float32Array, copied: ReadbackToken): boolean => {
    if (!sameReadbackToken(latest.current, copied)) return false;
    const root = coordinates.resource.data;
    setPublished((previous) => {
      const revised = withPositions(
        previous && sameReadbackSource(previous.token, copied)
          ? previous.data
          : root,
        positions,
      );
      return Object.freeze({
        data: preserveBondGraph(root, revised),
        token: copied,
      });
    });
    return true;
  };
  const maxHz = Math.max(...demand.map((request) => request.maxHz));
  const onPause = demand.some((request) => request.onPause);
  return provide(CoordinateSnapshotContext, context, [
    demand.length && coordinates.ready !== false
      ? use(ThrottledReadback, {
        token,
        maxHz,
        onPause,
        label: "coords:snapshot",
        publish,
      })
      : null,
    children,
  ]);
};
