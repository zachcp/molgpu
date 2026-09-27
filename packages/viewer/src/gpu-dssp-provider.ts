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
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";
import type { ViewerComponent, ViewerElement } from "./types.ts";

export interface GpuDsspStatus {
  readonly generation: number;
  readonly nearThresholdResidues: number;
  readonly bridgeCount: number;
  readonly fallback: boolean;
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
  const [failure, setFailure] = useState<
    {
      error: Error;
      source: GPUBuffer;
      generation: number;
    } | null
  >(null);
  useResource((dispose) => {
    if (!coordinates || !root || !rows || !layout) return;
    let alive = true;
    const controller = new AbortController();
    // The upstream coordinate provider submits during rendering. Defer the
    // read until its command buffer is queued for this generation.
    const timer = setTimeout(() => {
      gpuDssp(device, coordinates.source.buffer, {
        data: root.data,
        rows,
        layout,
        generation: coordinates.generation,
        overflow: overflowPolicy,
        signal: controller.signal,
      }).then((result) => {
        if (!alive) {
          result.codeBuffer.destroy();
          return;
        }
        setFailure(null);
        setPublished({
          result,
          source: coordinates.source.buffer,
          identity: root.identity,
        });
        notify.current?.(Object.freeze({
          generation: result.generation,
          nearThresholdResidues: result.nearThresholdResidues,
          bridgeCount: result.bridgeCount,
          fallback: result.fallback,
        }));
      }, (error: unknown) => {
        if (alive) {
          setFailure({
            error: error instanceof Error ? error : new Error(String(error)),
            source: coordinates.source.buffer,
            generation: coordinates.generation,
          });
        }
      });
    }, 0);
    dispose(() => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    });
  }, [
    device,
    coordinates?.source.buffer,
    coordinates?.generation,
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
  if (
    failure && failure.source === coordinates?.source.buffer &&
    failure.generation === coordinates.generation
  ) throw failure.error;
  const current = published && coordinates && root &&
      published.source === coordinates.source.buffer &&
      published.identity === root.identity &&
      published.result.generation === coordinates.generation
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
