// <Trajectory>: a coordinate provider that plays a TrajectoryData over the
// nearest coordinates. Frames stream through a CPU cache into a four-slot GPU
// window; one kernel interpolates the displayed pair (optionally by minimum
// image) and scatters it through the atomMap. Rows outside the map, and every
// row before the first frame lands, copy upstream. Playback mechanics live in
// internal/trajectory-player.ts. See docs/findings/2026-09-26-trajectory-plan.md.
import {
  type LC,
  type LiveElement,
  provide,
  use,
  useContext,
  useMemo,
  useResource,
  useState,
} from "@use-gpu/live";
import { LoopContext, useDeviceContext } from "@use-gpu/workbench";
import { type TrajectoryData, validateTrajectory } from "@molgpu/table";
import { type Curve, sample } from "@molgpu/timeline";
import type {
  TrajectoryFrameState,
  TrajectoryLoader,
  TrajectoryProps,
  TrajectoryStatus,
  ViewerComponent,
} from "../types.ts";
import { useCoordinates } from "../coordinates/coordinates-context.ts";
import { TimelineContext } from "../timeline-context.ts";
import { CoordinateKernel } from "../coordinates/coordinate-kernel.ts";
import { ioLoader, useSourceRequest } from "../internal/source-request.ts";
import { useStatusDelivery } from "../internal/status-delivery.ts";
import { COPY_UPSTREAM, playbackKernel, Player } from "./trajectory-player.ts";

import { TrajectoryContext } from "./trajectory-context.ts";

type StatusCallback = ((status: TrajectoryStatus) => void) | undefined;

/** A failure without a callback is logged once instead of thrown. */
function logTrajectoryFailure(status: TrajectoryStatus): void {
  if (status.status !== "error") return;
  console.error(
    status.phase === "source"
      ? "<Trajectory>: source failed to open"
      : `<Trajectory>: frame ${status.frame} failed to load`,
    status.error,
  );
}

function useTrajectoryStatus(
  onStatus: StatusCallback,
  status: TrajectoryStatus | null,
): void {
  useStatusDelivery(onStatus, status, logTrajectoryFailure);
}

type PlayerProps = {
  /** Null while the source opens or after it failed: upstream copies through. */
  trajectory: TrajectoryData | null;
  frame: number | Curve<number>;
  interpolate: "linear" | "nearest";
  pbc: "none" | "minimum-image";
  onStatus: StatusCallback;
  sourceStatus: TrajectoryStatus | null;
  children: LiveElement;
};

/** An empty structure has nothing to move. */
const TrajectoryProvider: LC<PlayerProps> = (props) =>
  useCoordinates() ? use(TrajectoryPlayer, props) : props.children;

const TrajectoryPlayer: LC<PlayerProps> = (
  { trajectory, frame, interpolate, pbc, onStatus, sourceStatus, children },
) => {
  const upstream = useCoordinates()!;
  const time = useContext(TimelineContext);
  const device = useDeviceContext();
  const requestRepaint = useContext(LoopContext);
  const [, setLanded] = useState(0);
  const [failure, setFailure] = useState<
    { player: Player; index: number; error: unknown } | null
  >(null);
  let requested: number;
  if (typeof frame === "number") requested = frame;
  else {
    if (time === null) {
      throw new Error(
        "<Trajectory> frame is a curve, which needs a <TimelineProvider> ancestor",
      );
    }
    requested = sample(frame, time);
  }
  if (!Number.isFinite(requested)) {
    throw new TypeError("<Trajectory> frame must be finite");
  }
  const structure = upstream.resource.data;
  useMemo(() => trajectory && validateTrajectory(structure, trajectory), [
    structure,
    trajectory,
  ]);
  const player = useMemo(
    () => trajectory ? new Player(device, trajectory, upstream.count) : null,
    [device, trajectory, upstream.count],
  );
  useResource((dispose) => {
    if (!player) return;
    player.cache.onLoad = () => {
      setLanded((n) => n + 1);
      requestRepaint();
    };
    player.cache.onError = (index, error) => {
      setFailure({ player, index, error });
      requestRepaint();
    };
    dispose(() => player.close());
  }, [player]);
  // A failed frame read is sticky for this player: upstream coordinates pass
  // through (kernel mode 0) and no further frames are scheduled until the
  // trajectory changes, which creates a new player.
  const failed = failure?.player === player ? failure : null;
  const failedStatus = useMemo<TrajectoryStatus | null>(
    () =>
      failed
        ? Object.freeze({
          status: "error",
          phase: "frame" as const,
          frame: failed.index,
          error: failed.error,
        })
        : null,
    [failed],
  );
  useTrajectoryStatus(onStatus, failedStatus);
  const idle = !player || !trajectory;
  const clamped = trajectory
    ? Math.min(Math.max(requested, 0), trajectory.frameCount - 1)
    : 0;
  const display = idle || failed
    ? null
    : player.scheduler.update(requested, interpolate);
  const key = display
    ? `${player!.id}:${display.a}:${display.b}:${display.t}`
    : `${player?.id ?? "idle"}:0`;
  const state = useMemo<TrajectoryFrameState | null>(
    () =>
      trajectory
        ? Object.freeze({
          trajectory,
          requested: clamped,
          displayed: display ? Object.freeze({ ...display }) : null,
          frame: display
            ? display.a + display.t * (display.b - display.a)
            : null,
          box: player!.box(display),
        })
        : null,
    [trajectory, clamped, key],
  );
  const scope = useMemo(() =>
    Object.freeze({
      owner: upstream.resource,
      state,
      status: failedStatus ?? sourceStatus,
    }), [upstream.resource, state, failedStatus, sourceStatus]);
  if (idle) {
    // Same element types as playback below keep children mounted. An opening
    // or failed inner source shadows outer metadata while copying coordinates.
    return provide(
      TrajectoryContext,
      scope,
      use(CoordinateKernel, {
        upstream,
        shader: COPY_UPSTREAM,
        args: [],
        sources: [],
        parameterKey: "idle",
        children,
      }),
    );
  }

  return provide(
    TrajectoryContext,
    scope,
    use(CoordinateKernel, {
      upstream,
      ...playbackKernel(player, display, pbc, key),
      children,
    }),
  );
};

const defaultLoader: TrajectoryLoader = ioLoader((io, src, signal) =>
  io.openTrajectory(src, { signal })
);

/**
 * Play a trajectory over the nearest coordinates (a coordinate provider): descendants see its frames; topology never changes. `frame`
 * is a fractional frame or a timeline curve. Frames stream on demand; until
 * the first one lands, and for rows outside `atomMap`, upstream coordinates
 * show. With `src`, children render unmoved while the file opens and stay
 * mounted when playback attaches. A failed source or frame read passes
 * upstream coordinates through and is reported through `onStatus` (or logged
 * once), never thrown.
 */
export const Trajectory: ViewerComponent<TrajectoryProps> = (
  {
    data,
    src,
    loader = defaultLoader,
    frame,
    interpolate = "linear",
    pbc = "none",
    onStatus,
    children,
  },
) => {
  if (data !== undefined && src !== undefined) {
    throw new TypeError("<Trajectory> accepts either data or src, not both");
  }
  if (data === undefined && src === undefined) {
    throw new TypeError("<Trajectory> requires data or src");
  }
  if (src !== undefined && typeof src !== "string") {
    throw new TypeError("<Trajectory> src must be a string");
  }
  if (typeof loader !== "function") {
    throw new TypeError("<Trajectory> loader must be a function");
  }
  if (!["linear", "nearest"].includes(interpolate)) {
    throw new TypeError("<Trajectory> interpolate must be linear or nearest");
  }
  if (!["none", "minimum-image"].includes(pbc)) {
    throw new TypeError("<Trajectory> pbc must be none or minimum-image");
  }
  const request = useSourceRequest(
    data === undefined
      ? async (signal: AbortSignal) =>
        await loader(src!, () => signal.aborted, signal)
      : null,
    [data, src, loader],
  );
  const loaded = request.state === "resolved" ? request.value : null;
  const trajectory = data ?? loaded ?? null;
  const pending = request.state === "pending";
  const failed = request.state === "rejected";
  const status = useMemo<TrajectoryStatus | null>(
    () =>
      request.state === "pending"
        ? Object.freeze({ status: "opening" as const })
        : request.state === "rejected"
        ? Object.freeze({
          status: "error",
          phase: "source" as const,
          frame: null,
          error: request.error,
        })
        : trajectory
        ? Object.freeze({ status: "ready", frameCount: trajectory.frameCount })
        : null,
    [request, trajectory],
  );
  useTrajectoryStatus(onStatus, status);
  // Pending, failed or cancelled sources pass upstream coordinates through,
  // in the same subtree that playback later attaches to.
  const playable = pending || failed ? null : trajectory;
  return (use(TrajectoryProvider, {
    trajectory: playable,
    sourceStatus: status,
    frame,
    interpolate,
    pbc,
    onStatus,
    children: children,
  }));
};
