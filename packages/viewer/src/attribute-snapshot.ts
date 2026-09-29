import {
  type LC,
  type LiveElement,
  provide,
  use,
  useContext,
  useMemo,
  useRef,
  useResource,
  useState,
} from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import { attributeColumn, withAttributes } from "@molgpu/table";
import type { ProducedAttribute } from "./attributes-context.ts";
import { useStructureResource } from "./structure-context.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";
import {
  type AttributeSnapshot,
  AttributeSnapshotContext,
  EMPTY_ATTRIBUTE_SNAPSHOTS,
  type SnapshotProvider,
} from "./attribute-snapshot-context.ts";
import { snapshotAttributeValues } from "./internal/attribute-values.ts";

export type { AttributeSnapshot } from "./attribute-snapshot-context.ts";
export {
  AttributeSnapshotContext,
  EMPTY_ATTRIBUTE_SNAPSHOTS,
} from "./attribute-snapshot-context.ts";
interface Request {
  maxHz: number;
  onPause: boolean;
}
const MAP_READ = 0x0001;
const COPY_DST = 0x0008;
const noop = () => {};

/** Latest CPU copy of a column; a GPU-only column returns null until read back. */
export function useAttributeSnapshot(
  name: string,
  options: { maxHz?: number; onPause?: boolean; enabled?: boolean } = {},
): AttributeSnapshot | null {
  const root = useStructureResource();
  const contexts = useContext(AttributeSnapshotContext);
  const context = contexts?.[name];
  const maxHz = options.maxHz ?? 4;
  const onPause = options.onPause ?? true;
  const enabled = options.enabled ?? true;
  if (!Number.isFinite(maxHz) || maxHz <= 0) {
    throw new TypeError(
      "useAttributeSnapshot maxHz must be positive and finite",
    );
  }
  useResource((dispose) => {
    if (enabled && context) dispose(context.subscribe(maxHz, onPause));
  }, [context?.subscribe, maxHz, onPause, enabled]);
  if (!enabled) return null;
  if (context) return context.snapshot;
  return attributeColumn(root.data, name)
    ? { data: root.data, generation: root.attributesRevision }
    : null;
}

const Readback: LC<{
  name: string;
  entry: ProducedAttribute;
  maxHz: number;
  onPause: boolean;
  publish: (values: Float32Array, generation: number) => boolean;
  fail: (error: unknown, generation: number, buffer: GPUBuffer) => void;
}> = ({ name, entry, maxHz, onPause, publish, fail }) => {
  const device = useDeviceContext();
  const latest = useRef({ entry, publish, fail, maxHz, onPause });
  latest.current = { entry, publish, fail, maxHz, onPause };
  const inFlight = useRef(false);
  const published = useRef<{ generation: number; buffer: GPUBuffer } | null>(
    null,
  );
  const lastDispatch = useRef(-Infinity);
  const nextBuffer = useRef(0);
  const size = entry.source.length * 4;
  const staging = useMemo(() =>
    [0, 1].map(() =>
      device.createBuffer({
        size: Math.max(4, size),
        usage: COPY_DST | MAP_READ,
        label: `molgpu:attr:snapshot:${name}`,
      })
    ), [device, entry.source.buffer, size]);
  useResource((dispose) => {
    staging.forEach((buffer) =>
      trackOwnedBuffer(buffer, `attr:snapshot:${name}`)
    );
    dispose(() =>
      staging.forEach((buffer) => {
        releaseOwnedBuffer(buffer);
        buffer.destroy();
      })
    );
  }, [staging]);
  const mounted = useRef(true);
  const kick = useRef<() => void>(noop);
  useResource((dispose) => {
    mounted.current = true;
    dispose(() => {
      mounted.current = false;
    });
  }, []);
  useResource((dispose) => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!alive || inFlight.current) return;
      const { entry: current, maxHz: rate, onPause: pause } = latest.current;
      if (
        current.generation === published.current?.generation &&
        current.source.buffer === published.current.buffer
      ) return;
      const remaining = 1000 / rate -
        (performance.now() - lastDispatch.current);
      const delay = pause
        ? Math.min(Math.max(0, remaining), 34)
        : Math.max(0, remaining);
      // Compute pipelines are created asynchronously. Give the initial
      // dispatch a chance to land before copying a newly allocated output.
      const readyDelay = published.current?.buffer !== current.source.buffer
        ? 200
        : 0;
      timer = setTimeout(async () => {
        if (!alive || inFlight.current) return;
        const { entry: target } = latest.current;
        const generation = target.generation;
        const buffer = staging[nextBuffer.current++ % staging.length];
        inFlight.current = true;
        lastDispatch.current = performance.now();
        count("gathers", `attr:snapshot:${name}:dispatch`);
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(target.source.buffer, 0, buffer, 0, size);
          device.queue.submit([encoder.finish()]);
          await buffer.mapAsync(MAP_READ);
          const values = new Float32Array(buffer.getMappedRange().slice(0));
          buffer.unmap();
          if (!mounted.current) return;
          if (
            generation === latest.current.entry.generation &&
            target.source.buffer === latest.current.entry.source.buffer
          ) {
            if (latest.current.publish(values, generation)) {
              published.current = { generation, buffer: target.source.buffer };
              count("gathers", `attr:snapshot:${name}:publish`);
            }
          } else count("gathers", `attr:snapshot:${name}:discard`);
        } catch (error) {
          if (mounted.current) {
            count("gathers", `attr:snapshot:${name}:error`);
            latest.current.fail(error, generation, target.source.buffer);
          }
        } finally {
          inFlight.current = false;
          if (mounted.current) kick.current();
        }
      }, Math.max(readyDelay, delay));
    };
    kick.current = schedule;
    schedule();
    dispose(() => {
      alive = false;
      if (timer) clearTimeout(timer);
    });
  }, [device, staging, entry.generation, maxHz, onPause]);
  return null;
};

/** Demand-driven readback for one produced attribute in a provider chain. */
export const AttributeSnapshotBoundary: LC<{
  name: string;
  entry: ProducedAttribute;
  children: LiveElement;
}> = ({ name, entry, children }) => {
  const root = useStructureResource();
  const upstream = useContext(AttributeSnapshotContext) ??
    EMPTY_ATTRIBUTE_SNAPSHOTS;
  const [requests, setRequests] = useState<Map<number, Request>>(new Map());
  const demand = [...requests.values()];
  const nextId = useRef(0);
  const [published, setPublished] = useState<
    (AttributeSnapshot & { buffer: GPUBuffer }) | null
  >(null);
  const [failure, setFailure] = useState<
    { error: unknown; generation: number; buffer: GPUBuffer } | null
  >(null);
  const latest = useRef(entry);
  latest.current = entry;
  const subscribe = useMemo(() => (maxHz: number, onPause: boolean) => {
    const id = ++nextId.current;
    setRequests((previous) => new Map(previous).set(id, { maxHz, onPause }));
    return () =>
      setRequests((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
  }, []);
  const snapshot = published?.buffer === entry.source.buffer &&
      published.generation === entry.generation
    ? published
    : null;
  const context: SnapshotProvider = { snapshot, subscribe };
  const maxHz = Math.max(...demand.map((request) => request.maxHz));
  const onPause = demand.some((request) => request.onPause);
  if (
    failure?.generation === entry.generation &&
    failure.buffer === entry.source.buffer
  ) {
    throw new Error(`Attribute snapshot ${name} failed`, {
      cause: failure.error,
    });
  }
  const publish = (values: Float32Array, generation: number): boolean => {
    if (
      latest.current.generation !== generation ||
      latest.current.source.buffer !== entry.source.buffer
    ) return false;
    const data = withAttributes(root.data, {
      [name]: {
        domain: entry.domain,
        kind: entry.kind,
        provenance: entry.provenance,
        values: snapshotAttributeValues(name, entry.kind, values),
      },
    });
    setPublished({ data, generation, buffer: entry.source.buffer });
    return true;
  };
  const fail = (error: unknown, generation: number, buffer: GPUBuffer) => {
    if (
      latest.current.generation === generation &&
      latest.current.source.buffer === buffer
    ) setFailure({ error, generation, buffer });
  };
  return provide(
    AttributeSnapshotContext,
    Object.freeze({
      ...upstream,
      [name]: context,
    }),
    [
      demand.length
        ? use(Readback, { name, entry, maxHz, onPause, publish, fail })
        : null,
      children,
    ],
  );
};
