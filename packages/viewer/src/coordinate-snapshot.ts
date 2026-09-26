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
import { useDeviceContext } from "@use-gpu/workbench";
import { bondTopology, type StructureData, withPositions } from "@molgpu/table";
import type { Coordinates } from "./coordinates-context.ts";
import type { StructureResource } from "./types.ts";
import { createStructureResource } from "./internal/structure-resource.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";

export interface CoordinateSnapshot {
  readonly data: StructureData;
  readonly generation: number;
  readonly resource: StructureResource;
}

interface SnapshotContextValue {
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
const MAP_READ = 0x0001;
const COPY_DST = 0x0008;

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

const SnapshotReadback: LC<{
  coordinates: Coordinates;
  maxHz: number;
  onPause: boolean;
  publish: (data: Float32Array, generation: number) => void;
}> = ({ coordinates, maxHz, onPause, publish }) => {
  const device = useDeviceContext();
  const latest = useRef({ coordinates, publish, maxHz, onPause });
  latest.current = { coordinates, publish, maxHz, onPause };
  const inFlight = useRef(false);
  const published = useRef(-1);
  const lastDispatch = useRef(-Infinity);
  const nextBuffer = useRef(0);
  const staging = useMemo(() =>
    [0, 1].map(() =>
      device.createBuffer({
        size: Math.max(4, coordinates.count * 12),
        usage: COPY_DST | MAP_READ,
        label: "molgpu:coords:snapshot",
      })
    ), [device, coordinates.count, coordinates.source.buffer]);
  useResource((dispose) => {
    for (const buffer of staging) trackOwnedBuffer(buffer, "coords:snapshot");
    dispose(() => {
      for (const buffer of staging) {
        releaseOwnedBuffer(buffer);
        buffer.destroy();
      }
    });
  }, [staging]);
  useResource((dispose) => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!alive || inFlight.current) return;
      const { coordinates: current, maxHz: rate, onPause: pause } =
        latest.current;
      if (current.generation === published.current) return;
      const remaining = 1000 / rate -
        (performance.now() - lastDispatch.current);
      // The pause request supplies the last frame after motion stops.
      const delay = pause
        ? Math.min(Math.max(0, remaining), 34)
        : Math.max(0, remaining);
      timer = setTimeout(async () => {
        if (!alive || inFlight.current) return;
        const { coordinates: target } = latest.current;
        const generation = target.generation;
        const buffer = staging[nextBuffer.current++ % staging.length];
        inFlight.current = true;
        lastDispatch.current = performance.now();
        count("gathers", "coords:snapshot:dispatch");
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(
            target.source.buffer,
            0,
            buffer,
            0,
            target.count * 12,
          );
          device.queue.submit([encoder.finish()]);
          await buffer.mapAsync(MAP_READ);
          const values = new Float32Array(buffer.getMappedRange().slice(0));
          buffer.unmap();
          if (!alive) return;
          if (generation === latest.current.coordinates.generation) {
            published.current = generation;
            latest.current.publish(values, generation);
            count("gathers", "coords:snapshot:publish");
          } else count("gathers", "coords:snapshot:discard");
        } catch {
          if (alive) count("gathers", "coords:snapshot:error");
        } finally {
          inFlight.current = false;
          if (
            alive && latest.current.coordinates.generation !== published.current
          ) schedule();
        }
      }, Math.max(0, delay));
    };
    schedule();
    dispose(() => {
      alive = false;
      if (timer) clearTimeout(timer);
    });
  }, [device, staging, coordinates.generation, maxHz, onPause]);
  return null;
};

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
      generation: number;
      owner: StructureResource;
    } | null
  >(null);
  const latest = useRef(coordinates);
  latest.current = coordinates;
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
  const data = published?.owner === coordinates.resource
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
    snapshot: data && snapshotResource && published
      ? Object.freeze({
        data,
        generation: published.generation,
        resource: snapshotResource,
      })
      : null,
    subscribe,
  }), [data, snapshotResource, published, subscribe]);
  const root = coordinates.resource.data;
  const rootBonds = useMemo(() => demand.length ? bondTopology(root) : null, [
    coordinates.resource.identity,
    coordinates.resource.topologyRevision,
    Boolean(demand.length),
  ]);
  const publish = (positions: Float32Array, generation: number) => {
    if (latest.current.generation !== generation) return;
    const revised = withPositions(
      published?.owner === coordinates.resource ? published.data : root,
      positions,
    );
    const data = root.topology.bonds.count ? revised : Object.freeze({
      ...revised,
      topology: Object.freeze({ ...revised.topology, bonds: rootBonds! }),
    });
    setPublished(Object.freeze({
      data,
      generation,
      owner: coordinates.resource,
    }));
  };
  const maxHz = Math.max(...demand.map((request) => request.maxHz));
  const onPause = demand.some((request) => request.onPause);
  return provide(CoordinateSnapshotContext, context, [
    demand.length
      ? use(SnapshotReadback, { coordinates, maxHz, onPause, publish })
      : null,
    children,
  ]);
};
