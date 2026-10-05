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
import { attributeColumn, withAttributes } from "@molgpu/table";
import type { ProducedAttribute } from "./attributes-context.ts";
import { useStructureResource } from "./structure-context.ts";
import { ThrottledReadback } from "./internal/throttled-readback.ts";
import {
  type ReadbackToken,
  sameReadbackSource,
  sameReadbackToken,
} from "./internal/readback-token.ts";
import {
  type AttributeSnapshot,
  AttributeSnapshotContext,
  EMPTY_ATTRIBUTE_SNAPSHOTS,
  type SnapshotProvider,
} from "./attribute-snapshot-context.ts";
import { snapshotAttributeValues } from "./internal/attribute-values.ts";

interface Request {
  maxHz: number;
  onPause: boolean;
}

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
  if (context?.error) {
    throw new Error(`Attribute snapshot ${name} failed`, {
      cause: context.error,
    });
  }
  if (context) return context.snapshot;
  return attributeColumn(root.data, name)
    ? { data: root.data, generation: root.attributesRevision }
    : null;
}

const Readback: LC<{
  name: string;
  token: ReadbackToken;
  maxHz: number;
  onPause: boolean;
  publish: (values: Float32Array, token: ReadbackToken) => boolean;
  fail: (error: unknown, token: ReadbackToken) => void;
}> = ({ name, token, maxHz, onPause, publish, fail }) =>
  use(ThrottledReadback, {
    token,
    maxHz,
    onPause,
    label: `attr:snapshot:${name}`,
    publish,
    fail,
  });

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
  const layout = useMemo(() => ({}), [
    name,
    entry.domain,
    entry.kind,
    entry.provenance,
    entry.source.length,
  ]);
  const token: ReadbackToken = {
    owner: root,
    buffer: entry.source.buffer,
    bytes: entry.source.length * 4,
    layout,
    generation: entry.generation,
  };
  const [published, setPublished] = useState<
    (AttributeSnapshot & { token: ReadbackToken }) | null
  >(null);
  const [failure, setFailure] = useState<
    { error: unknown; token: ReadbackToken } | null
  >(null);
  const latest = useRef(token);
  latest.current = token;
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
  const snapshot = published && sameReadbackSource(published.token, token)
    ? published
    : null;
  const context: SnapshotProvider = {
    snapshot,
    subscribe,
    token,
    error: failure && sameReadbackToken(failure.token, token)
      ? failure.error
      : undefined,
  };
  const maxHz = Math.max(...demand.map((request) => request.maxHz));
  const onPause = demand.some((request) => request.onPause);
  const publish = (values: Float32Array, copied: ReadbackToken): boolean => {
    if (!sameReadbackToken(latest.current, copied)) return false;
    const data = withAttributes(root.data, {
      [name]: {
        domain: entry.domain,
        kind: entry.kind,
        provenance: entry.provenance,
        values: snapshotAttributeValues(name, entry.kind, values),
      },
    });
    setPublished({ data, generation: copied.generation, token: copied });
    return true;
  };
  const fail = (error: unknown, copied: ReadbackToken) => {
    if (sameReadbackToken(latest.current, copied)) {
      setFailure({ error, token: copied });
    }
  };
  return provide(
    AttributeSnapshotContext,
    Object.freeze({
      ...upstream,
      [name]: context,
    }),
    [
      demand.length && entry.ready !== false
        ? use(Readback, { name, token, maxHz, onPause, publish, fail })
        : null,
      children,
    ],
  );
};
