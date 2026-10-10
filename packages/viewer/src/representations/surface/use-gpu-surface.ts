// Live-coordinate surface builds on the GPU for <Surface>: one build in
// flight, the newest coordinate generation queued behind it (intermediate
// generations are skipped), and the last finished mesh shown until a newer one
// lands. A change of source buffer or geometry parameters aborts the running
// build. Each published mesh is owned here and destroyed when it is replaced
// or the surface unmounts; a discarded result is destroyed at once.
import { useMemo, useRef, useResource, useState } from "@use-gpu/live";
import { useDeviceContext } from "@use-gpu/workbench";
import type { Coordinates } from "../../coordinates/coordinates-context.ts";
import {
  destroyGpuSurfaceMesh,
  gpuSurfaceGeometry,
  type GpuSurfaceMesh,
} from "./surface-gpu.ts";
import {
  count,
  gauge,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "../../internal/instrumentation.ts";

export interface GpuSurfaceRequest {
  readonly rows: Uint32Array;
  readonly radii: Float32Array;
  readonly probeRadius: number;
  readonly resolution: number;
  readonly maxBytes?: number;
}

export interface GpuSurfacePublication {
  /** Null when the selection has no isosurface. */
  readonly mesh: GpuSurfaceMesh | null;
  readonly generation: number;
}

export interface GpuSurfaceState {
  readonly published: GpuSurfacePublication | null;
  readonly failure: Error | null;
  /** The GPU port does not apply to these parameters or atoms: use the CPU. */
  readonly unsupported: boolean;
}

interface Run {
  readonly positions: GPUBuffer;
  readonly generation: number;
  readonly request: GpuSurfaceRequest;
  readonly controller: AbortController;
}

const IDLE: GpuSurfaceState = Object.freeze({
  published: null,
  failure: null,
  unsupported: false,
});

/** Build `request`'s surface from each generation of `coordinates` when `enabled`. */
export function useGpuSurface(
  coordinates: Coordinates | null,
  request: GpuSurfaceRequest | null,
  enabled: boolean,
): GpuSurfaceState {
  const device = useDeviceContext();
  const [published, setPublished] = useState<
    { publication: GpuSurfacePublication; owner: Run } | null
  >(null);
  const [failure, setFailure] = useState<{ error: Error; owner: Run } | null>(
    null,
  );
  const [unsupported, setUnsupported] = useState<GpuSurfaceRequest | null>(
    null,
  );
  const pending = useRef<Run | null>(null);
  const running = useRef<Run | null>(null);
  const mounted = useRef(true);
  const current = useRef<{ positions: GPUBuffer | null; request: unknown }>({
    positions: null,
    request: null,
  });
  current.current = {
    positions: coordinates?.source.buffer ?? null,
    request,
  };
  const pump = useRef<() => void>(() => {});
  pump.current = () => {
    if (!mounted.current || running.current || !pending.current) return;
    const run = pending.current;
    pending.current = null;
    running.current = run;
    count("geometryBuilds", "surface:gpu");
    gauge("surface:gpu-in-flight", 1);
    gpuSurfaceGeometry(device, run.positions, {
      atomCount: run.request.radii.length,
      rows: run.request.rows,
      radii: run.request.radii,
      probeRadius: run.request.probeRadius,
      resolution: run.request.resolution,
      ...(run.request.maxBytes !== undefined
        ? { maxBytes: run.request.maxBytes }
        : {}),
      signal: run.controller.signal,
    }).then((mesh) => {
      if (
        !mounted.current || run.controller.signal.aborted ||
        current.current.positions !== run.positions ||
        current.current.request !== run.request
      ) {
        if (mesh) destroyGpuSurfaceMesh(mesh);
        return;
      }
      setFailure(null);
      setPublished({
        publication: Object.freeze({ mesh, generation: run.generation }),
        owner: run,
      });
    }, (error: unknown) => {
      if (
        !mounted.current ||
        (error instanceof DOMException && error.name === "AbortError")
      ) return;
      if (error instanceof RangeError && !("code" in error)) {
        setUnsupported(run.request);
      } else {
        setFailure({
          error: error instanceof Error ? error : new Error(String(error)),
          owner: run,
        });
      }
    }).finally(() => {
      gauge("surface:gpu-in-flight", 0);
      if (running.current === run) running.current = null;
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
  const blocked = unsupported !== null && unsupported === request;
  useResource((dispose) => {
    if (
      !enabled || blocked || !coordinates || !request ||
      coordinates.ready === false
    ) return;
    const run: Run = {
      positions: coordinates.source.buffer,
      generation: coordinates.generation,
      request,
      controller: new AbortController(),
    };
    if (
      running.current &&
      (running.current.positions !== run.positions ||
        running.current.request !== run.request)
    ) running.current.controller.abort();
    pending.current = run;
    // A coordinate producer may submit later in this render; start after it.
    const timer = setTimeout(() => pump.current(), 0);
    dispose(() => {
      clearTimeout(timer);
      if (pending.current === run) pending.current = null;
    });
  }, [
    device,
    enabled,
    blocked,
    coordinates?.source.buffer,
    coordinates?.generation,
    coordinates?.ready,
    request,
  ]);
  useResource((dispose) => {
    const mesh = published?.publication.mesh;
    if (!mesh) return;
    const buffers = [
      mesh.positions,
      mesh.normals,
      mesh.indices,
      mesh.sourceAtom,
    ];
    for (const buffer of buffers) trackOwnedBuffer(buffer, "surface:gpu");
    dispose(() => {
      for (const buffer of buffers) releaseOwnedBuffer(buffer);
      destroyGpuSurfaceMesh(mesh);
    });
  }, [published]);
  return useMemo(() => {
    if (!enabled || !coordinates || !request) return IDLE;
    const own = (run: Run | undefined) =>
      run?.positions === coordinates.source.buffer && run.request === request;
    return Object.freeze({
      published: published && own(published.owner)
        ? published.publication
        : null,
      failure: failure && own(failure.owner) ? failure.error : null,
      unsupported: blocked,
    });
  }, [
    enabled,
    coordinates?.source.buffer,
    request,
    published,
    failure,
    blocked,
  ]);
}
