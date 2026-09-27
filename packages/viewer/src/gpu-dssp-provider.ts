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
import { prepareDsspLayout } from "@molgpu/dynamics";
import { activeAtoms, withAttributes } from "@molgpu/table";
import { AttributeSnapshotContext } from "./attribute-snapshot.ts";
import { AttributesContext } from "./attributes-context.ts";
import { useCoordinates } from "./coordinates-context.ts";
import { StructureContext } from "./structure-context.ts";
import { gpuDssp, type GpuDsspResult } from "./gpu-dssp.ts";
import { live, viewer } from "./internal/elements.ts";
import {
  count,
  gauge,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";
import type { ViewerComponent, ViewerElement } from "./types.ts";

/** How long codes from an older coordinate generation stay published. */
const HOLD_MS = 1000;

export interface GpuDsspStatus {
  readonly generation: number;
  /** Directly flagged acceptor and bend-centre rows, excluding dependents. */
  readonly nearThresholdCenters: number;
  readonly bridgeCount: number;
  readonly fallback: boolean;
  readonly fallbackReason?: string;
}

export interface GpuDsspProps {
  /** Active primary-altloc atoms from this model; defaults to the first model. */
  readonly model?: "first" | number;
  /** On bounded-list overflow, a live frame reads its coordinates and reruns CPU DSSP. */
  readonly overflow?: "static" | "frame";
  readonly onStatus?: (status: GpuDsspStatus) => void;
  readonly children?: ViewerElement;
}

const noop = () => {};
interface Publication {
  readonly result: GpuDsspResult;
  readonly source: GPUBuffer;
  readonly identity: object;
  readonly layout: object;
  readonly publishedAt: number;
}

interface RunRequest {
  readonly device: GPUDevice;
  readonly positions: GPUBuffer;
  readonly generation: number;
  readonly root: NonNullable<ReturnType<typeof useCoordinates>>["resource"];
  readonly rows: ArrayLike<number>;
  readonly layout: ReturnType<typeof prepareDsspLayout>;
  readonly overflow: "static" | "frame";
  readonly controller: AbortController;
}

/** Resolve the component's overflow policy from its nearest coordinate stream. */
export function dsspOverflowMode(
  override: GpuDsspProps["overflow"],
  source: object | null,
  generation: number | null,
  rootSource: object | null,
  rootGeneration: number | null,
): "static" | "frame" {
  return override ??
    (source !== null && source === rootSource &&
        generation === rootGeneration
      ? "static"
      : "frame");
}

const Provider: LC<GpuDsspProps & { children: LiveElement }> = ({
  model = "first",
  overflow,
  onStatus,
  children,
}) => {
  const coordinates = useCoordinates();
  const structure = useContext(StructureContext);
  const device = useDeviceContext();
  const root = coordinates?.resource;
  // A root <Structure> source is immutable for this generation. A downstream
  // coordinate provider can publish a fresh frame, where exact CPU recovery
  // is preferable to interrupting playback on a bounded-list overflow.
  const overflowPolicy = dsspOverflowMode(
    overflow,
    coordinates?.source ?? null,
    coordinates?.generation ?? null,
    structure?.sources?.positions ?? null,
    structure?.resource.positionsRevision ?? null,
  );
  const upstreamAttributes = useContext(AttributesContext) ?? {};
  const upstreamSnapshots = useContext(AttributeSnapshotContext) ?? {};
  const rows = useMemo(
    () => root ? activeAtoms(root.data, { model }) : null,
    [root?.identity, root?.topologyRevision, model],
  );
  const layout = useMemo(
    () => root && rows ? prepareDsspLayout(root.data, rows) : null,
    [root?.identity, root?.topologyRevision, rows],
  );
  const [published, setPublished] = useState<Publication | null>(null);
  const notify = useRef<typeof onStatus>(onStatus);
  notify.current = onStatus;
  const latestCoordinates = useRef(coordinates);
  latestCoordinates.current = coordinates;
  const latestRoot = useRef(root ?? null);
  latestRoot.current = root ?? null;
  const latestLayout = useRef(layout);
  latestLayout.current = layout;
  const pending = useRef<RunRequest | null>(null);
  const running = useRef<RunRequest | null>(null);
  const inFlightCount = useRef(0);
  const mounted = useRef(true);
  const pump = useRef<() => void>(() => {});
  const [failure, setFailure] = useState<
    {
      error: Error;
      source: GPUBuffer;
      generation: number;
    } | null
  >(null);
  pump.current = () => {
    if (!mounted.current || running.current || !pending.current) return;
    const request = pending.current;
    pending.current = null;
    running.current = request;
    count("gathers", "dssp:dispatch");
    gauge("dssp:in-flight", ++inFlightCount.current);
    gpuDssp(request.device, request.positions, {
      data: request.root.data,
      rows: request.rows,
      layout: request.layout,
      generation: request.generation,
      overflow: request.overflow,
      signal: request.controller.signal,
    }).then((result) => {
      const liveCoordinates = latestCoordinates.current;
      if (
        !mounted.current ||
        liveCoordinates?.source.buffer !== request.positions ||
        latestRoot.current?.identity !== request.root.identity ||
        latestLayout.current !== request.layout
      ) {
        result.codeBuffer.destroy();
        return;
      }
      setFailure(null);
      setPublished({
        result,
        source: request.positions,
        identity: request.root.identity,
        layout: request.layout,
        publishedAt: performance.now(),
      });
      notify.current?.(Object.freeze({
        generation: result.generation,
        nearThresholdCenters: result.nearThresholdCenters,
        bridgeCount: result.bridgeCount,
        fallback: result.fallback,
        fallbackReason: result.fallbackReason,
      }));
    }, (error: unknown) => {
      if (
        mounted.current &&
        latestCoordinates.current?.source.buffer === request.positions &&
        latestCoordinates.current.generation === request.generation &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        setFailure({
          error: error instanceof Error ? error : new Error(String(error)),
          source: request.positions,
          generation: request.generation,
        });
      }
    }).finally(() => {
      inFlightCount.current--;
      if (running.current === request) running.current = null;
      if (mounted.current) pump.current();
    });
  };
  useResource((dispose) => {
    mounted.current = true;
    dispose(() => {
      mounted.current = false;
      pending.current = null;
      running.current?.controller.abort();
    });
  }, []);
  useResource((dispose) => {
    if (
      !coordinates || !root || !rows || !layout || coordinates.ready === false
    ) {
      return;
    }
    const request: RunRequest = {
      device,
      positions: coordinates.source.buffer,
      generation: coordinates.generation,
      root,
      rows,
      layout,
      overflow: overflowPolicy,
      controller: new AbortController(),
    };
    if (
      running.current &&
      (running.current.positions !== request.positions ||
        running.current.root.identity !== request.root.identity ||
        running.current.layout !== request.layout)
    ) running.current.controller.abort();
    pending.current = request;
    // A coordinate producer may submit later in this render. Its readiness
    // signal starts this request after the first dispatch has landed.
    const timer = setTimeout(() => pump.current(), 0);
    dispose(() => {
      clearTimeout(timer);
      if (pending.current === request) pending.current = null;
    });
  }, [
    device,
    coordinates?.source.buffer,
    coordinates?.generation,
    coordinates?.ready,
    root?.identity,
    rows,
    layout,
    overflowPolicy,
  ]);
  useResource((dispose) => {
    if (!published) return;
    const buffer = published.result.codeBuffer;
    trackOwnedBuffer(buffer, "attr:dssp");
    dispose(() => {
      releaseOwnedBuffer(buffer);
      buffer.destroy();
    });
  }, [published?.result.codeBuffer]);
  // Codes from an older generation are held for at most HOLD_MS. Re-render
  // when the hold ends so a stalled or failed newer run cannot pin them.
  const [, setHoldExpired] = useState(0);
  const holding = !!published && !!coordinates &&
    published.result.generation !== coordinates.generation;
  useResource((dispose) => {
    if (!holding || !published) return;
    const remaining = published.publishedAt + HOLD_MS - performance.now();
    const timer = setTimeout(
      () => setHoldExpired((n) => n + 1),
      Math.max(0, remaining) + 1,
    );
    dispose(() => clearTimeout(timer));
  }, [holding, published]);
  if (
    failure && failure.source === coordinates?.source.buffer &&
    failure.generation === coordinates.generation
  ) throw failure.error;
  const current = published && coordinates && root &&
      published.source === coordinates.source.buffer &&
      published.identity === root.identity &&
      published.layout === layout &&
      (published.result.generation === coordinates.generation ||
        performance.now() - published.publishedAt < HOLD_MS)
    ? published.result
    : null;
  const data = useMemo(() =>
    current && root
      ? withAttributes(root.data, {
        ssCode: {
          domain: "residue",
          kind: "code",
          provenance: "gpu:dssp",
          values: current.codes,
        },
      })
      : null, [root?.data, current]);
  const entry = useMemo(() =>
    current
      ? Object.freeze({
        source: Object.freeze({
          buffer: current.codeBuffer,
          format: "f32" as const,
          length: current.codes.length,
          size: [current.codes.length],
          version: current.generation,
        }),
        domain: "residue" as const,
        kind: "code" as const,
        generation: current.generation,
        provenance: "gpu:dssp" as const,
      })
      : null, [current]);
  const attributes = useMemo(
    () =>
      entry
        ? Object.freeze({ ...upstreamAttributes, ssCode: entry })
        : upstreamAttributes,
    [upstreamAttributes, entry],
  );
  const snapshots = useMemo(() =>
    current && data
      ? Object.freeze({
        ...upstreamSnapshots,
        ssCode: {
          snapshot: Object.freeze({ data, generation: current.generation }),
          subscribe: () => noop,
        },
      })
      : upstreamSnapshots, [upstreamSnapshots, current, data]);
  if (!current || !root || !data) return children;
  return provide(
    AttributesContext,
    attributes,
    provide(AttributeSnapshotContext, snapshots, children),
  );
};

/** Publish GPU DSSP codes from the nearest live coordinate stream. */
export const GpuDssp: ViewerComponent<GpuDsspProps> = (props) =>
  viewer(use(Provider, { ...props, children: live(props.children) }));
