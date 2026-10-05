import { useSourceRequest } from "./internal/source-request.ts";
// <Trajectory>: a coordinate provider that plays a TrajectoryData over the
// nearest coordinates. Frames stream through a CPU cache into a four-slot GPU
// window; one kernel interpolates the displayed pair (optionally by minimum
// image) and scatters it through the atomMap. Rows outside the map, and every
// row before the first frame lands, copy upstream. See
// docs/findings/2026-09-26-trajectory-plan.md.
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
import type { StorageSource } from "@use-gpu/core";
import { wgsl } from "@use-gpu/shader/wgsl";
import { LoopContext, useDeviceContext } from "@use-gpu/workbench";
import { type TrajectoryData, validateTrajectory } from "@molgpu/table";
import { type Curve, sample } from "@molgpu/timeline";
import type { PeriodicBox } from "@molgpu/dynamics";
import type {
  TrajectoryFrameState,
  TrajectoryLoader,
  TrajectoryProps,
  TrajectoryStatus,
  ViewerComponent,
} from "./types.ts";
import { useCoordinates } from "./coordinates-context.ts";
import { TimelineContext } from "./timeline-context.ts";
import { CoordinateKernel } from "./internal/coordinate-kernel.ts";
import { FrameCache } from "./internal/frame-cache.ts";
import {
  type FramePair,
  FrameScheduler,
  trajectoryImageBox,
  TrajectoryImageBoxLimitError,
  WINDOW_SLOTS,
} from "./internal/frame-window.ts";
import {
  count,
  gauge,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";

import { TrajectoryContext } from "./trajectory-context.ts";

const STORAGE = 0x0080;
const COPY_DST = 0x0008;
const COPY_SRC = 0x0004;
/** Frames read ahead of the playhead. */
const PREFETCH = 2;

// Shared by both kernel variants: arguments in link order (args, sources,
// upstream source, output). Modes: 0 copy upstream, 1 lerp, 2 minimum image.
const HEAD = `
@link fn getSize() -> vec2<u32>;
@link fn getMode() -> f32;
@link fn getSlotA() -> f32;
@link fn getSlotB() -> f32;
@link fn getMix() -> f32;
@link fn getFrameAtoms() -> f32;
@link fn getBox0() -> vec3<f32>;
@link fn getBox1() -> vec3<f32>;
@link fn getBox2() -> vec3<f32>;
@link fn getInv0() -> vec3<f32>;
@link fn getInv1() -> vec3<f32>;
@link fn getInv2() -> vec3<f32>;
@link fn getInvNorm() -> f32;
@link fn getWindow(i: u32) -> f32;
`;
const BODY = `
@link fn getInput(i: u32) -> vec3<f32>;
@link var<storage, read_write> output: array<f32>;

fn frameAt(slot: u32, j: u32) -> vec3<f32> {
  let k = (slot * u32(getFrameAtoms()) + j) * 3u;
  return vec3<f32>(getWindow(k), getWindow(k + 1u), getWindow(k + 2u));
}

struct Best { residual: vec3<f32>, shift: vec3<f32>, squared: f32 };
fn trial(delta: vec3<f32>, candidate: vec3<f32>, best: ptr<function, Best>) {
  let residual = delta -
    mat3x3<f32>(getBox0(), getBox1(), getBox2()) * candidate;
  let squared = dot(residual, residual);
  let eps = 1e-6 * max(max((*best).squared, squared), 1e-30);
  let tie = abs(squared - (*best).squared) <= eps;
  let smaller = candidate.x < (*best).shift.x ||
    (candidate.x == (*best).shift.x && (candidate.y < (*best).shift.y ||
      (candidate.y == (*best).shift.y && candidate.z < (*best).shift.z)));
  if (squared < (*best).squared - eps || (tie && smaller)) {
    (*best).residual = residual;
    (*best).shift = candidate;
    (*best).squared = squared;
  }
}
fn nearest(delta: vec3<f32>) -> vec3<f32> {
  let fractional =
    mat3x3<f32>(getInv0(), getInv1(), getInv2()) * delta;
  let seed = round(fractional);
  var best = Best(delta, seed, 3.0e38);
  for (var x = -1.0; x <= 1.0; x += 1.0) {
    for (var y = -1.0; y <= 1.0; y += 1.0) {
      for (var z = -1.0; z <= 1.0; z += 1.0) {
        trial(delta, seed + vec3<f32>(x, y, z), &best);
      }
    }
  }
  let radius = sqrt(best.squared) * getInvNorm() + 1e-4;
  let low = ceil(fractional - vec3<f32>(radius));
  let high = floor(fractional + vec3<f32>(radius));
  for (var x = low.x; x <= high.x; x += 1.0) {
    for (var y = low.y; y <= high.y; y += 1.0) {
      for (var z = low.z; z <= high.z; z += 1.0) {
        trial(delta, vec3<f32>(x, y, z), &best);
      }
    }
  }
  return best.residual;
}

fn blend(j: u32) -> vec3<f32> {
  let p0 = frameAt(u32(getSlotA()), j);
  let p1 = frameAt(u32(getSlotB()), j);
  var d = p1 - p0;
  if (u32(getMode()) == 2u) {
    d = nearest(d);
  }
  return p0 + getMix() * d;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= getSize().x) { return; }
  var p = getInput(i);
  if (u32(getMode()) != 0u) {
    ROW
  }
  output[i * 3u] = p.x;
  output[i * 3u + 1u] = p.y;
  output[i * 3u + 2u] = p.z;
}
`;
// Every topology row is trajectory atom i.
const WHOLE = wgsl`${HEAD}${BODY.replace("ROW", "p = blend(i);")}`;
// No trajectory yet (opening or failed): copy upstream through the same kernel,
// so descendants keep one subtree when playback attaches.
const COPY = wgsl`
@link fn getSize() -> vec2<u32>;
@link fn getInput(i: u32) -> vec3<f32>;
@link var<storage, read_write> output: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= getSize().x) { return; }
  let p = getInput(i);
  output[i * 3u] = p.x;
  output[i * 3u + 1u] = p.y;
  output[i * 3u + 2u] = p.z;
}
`;
// A subset: getRow maps a topology row to its trajectory atom, or ~0u.
const SUBSET = wgsl`${HEAD}@link fn getRow(i: u32) -> u32;
${
  BODY.replace(
    "ROW",
    "let j = getRow(i);\n    if (j != 0xffffffffu) { p = blend(j); }",
  )
}`;

let players = 0;

/** Owns the frame window, the inverse atom map and the CPU cache for one mount. */
class Player {
  readonly id = ++players;
  readonly window: StorageSource;
  readonly rows: StorageSource | null;
  readonly cache: FrameCache;
  readonly scheduler: FrameScheduler;
  constructor(device: GPUDevice, trajectory: TrajectoryData, rows: number) {
    const n = trajectory.atomCount;
    const bytes = WINDOW_SLOTS * n * 12;
    const limit = device.limits.maxStorageBufferBindingSize;
    if (bytes > limit) {
      throw new RangeError(
        `<Trajectory>: ${WINDOW_SLOTS} frames of ${n} atoms need ${bytes} bytes, ` +
          `over this device's maxStorageBufferBindingSize (${limit})`,
      );
    }
    const buffer = device.createBuffer({
      size: bytes,
      usage: STORAGE | COPY_DST | COPY_SRC,
      label: "molgpu:coords:trajectory:window",
    });
    trackOwnedBuffer(buffer, "coords:trajectory:window");
    gauge("coords:trajectory:window:bytes", bytes);
    this.window = Object.freeze({
      buffer,
      format: "f32",
      length: WINDOW_SLOTS * n * 3,
      size: [WINDOW_SLOTS * n * 3],
      version: 1,
    }) as StorageSource;
    const map = trajectory.atomMap;
    if (map) {
      const inverse = new Uint32Array(rows).fill(0xffffffff);
      map.forEach((row, j) => inverse[row] = j);
      const rowBuffer = device.createBuffer({
        size: Math.max(4, inverse.byteLength),
        usage: STORAGE | COPY_DST,
        label: "molgpu:coords:trajectory:map",
      });
      device.queue.writeBuffer(rowBuffer, 0, inverse);
      trackOwnedBuffer(rowBuffer, "coords:trajectory:map");
      count("uploadBytes", "coords:trajectory:map", inverse.byteLength);
      this.rows = Object.freeze({
        buffer: rowBuffer,
        format: "u32",
        length: rows,
        size: [rows],
        version: 1,
      }) as StorageSource;
    } else this.rows = null;
    this.cache = new FrameCache(trajectory.source, trajectory.frameCount);
    this.scheduler = new FrameScheduler(
      this.cache,
      trajectory.frameCount,
      (slot, index, frame) => {
        if (frame.positions.length !== n * 3) {
          throw new TypeError(
            `<Trajectory>: frame ${index} has ${
              frame.positions.length / 3
            } atoms, expected ${n}`,
          );
        }
        device.queue.writeBuffer(buffer, slot * n * 12, frame.positions);
        count(
          "uploadBytes",
          "coords:trajectory:frame",
          frame.positions.byteLength,
        );
      },
      { slots: WINDOW_SLOTS, prefetch: PREFETCH },
    );
  }

  box(display: FramePair | null): Float32Array | null {
    if (!display) return null;
    const a = this.cache.get(display.a)?.box,
      b = this.cache.get(display.b)?.box;
    if (!a || !b) return null;
    return a.map((v, i) => v + display.t * (b[i] - v));
  }

  close(): void {
    this.cache.close();
    for (const source of [this.window, this.rows]) {
      if (!source) continue;
      releaseOwnedBuffer(source.buffer);
      source.buffer.destroy();
    }
  }
}

const ZERO3 = [0, 0, 0];

type StatusCallback = ((status: TrajectoryStatus) => void) | undefined;

/**
 * Deliver each distinct status once, after render. A failure without a
 * callback is logged once instead of thrown: Live has no error boundary.
 */
function useTrajectoryStatus(
  onStatus: StatusCallback,
  status: TrajectoryStatus | null,
): void {
  const callback = useRef<StatusCallback>(onStatus);
  callback.current = onStatus;
  useResource(() => {
    if (!status) return;
    if (callback.current) callback.current(status);
    else if (status.status === "error") {
      console.error(
        status.phase === "source"
          ? "<Trajectory>: source failed to open"
          : `<Trajectory>: frame ${status.frame} failed to load`,
        status.error,
      );
    }
  }, [status]);
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
        shader: COPY,
        args: [],
        sources: [],
        parameterKey: "idle",
        children,
      }),
    );
  }

  const box = player.box(display);
  const a = display ? player.cache.get(display.a)?.box : undefined;
  const minimumImage = pbc === "minimum-image" && box && a ? a : null;
  let prepared: PeriodicBox | null = null;
  if (minimumImage) {
    try {
      prepared = trajectoryImageBox(minimumImage);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      // A singular box has no periodic image; a valid box over the bounded
      // search convention fails loudly instead of displaying a wrong path.
      if (error instanceof TrajectoryImageBoxLimitError) throw error;
    }
  }
  const mode = !display ? 0 : prepared ? 2 : 1;
  const slotA = display ? player.scheduler.slots.slotOf(display.a) : 0;
  const slotB = display ? player.scheduler.slots.slotOf(display.b) : 0;
  const column = (m: ArrayLike<number> | null, c: number) =>
    m ? [m[c * 3], m[c * 3 + 1], m[c * 3 + 2]] : ZERO3;
  const args = [
    mode,
    slotA,
    slotB,
    display?.t ?? 0,
    trajectory.atomCount,
    column(minimumImage, 0),
    column(minimumImage, 1),
    column(minimumImage, 2),
    prepared
      ? [prepared.inverse[0], prepared.inverse[3], prepared.inverse[6]]
      : ZERO3,
    prepared
      ? [prepared.inverse[1], prepared.inverse[4], prepared.inverse[7]]
      : ZERO3,
    prepared
      ? [prepared.inverse[2], prepared.inverse[5], prepared.inverse[8]]
      : ZERO3,
    prepared?.inverseNorm ?? 0,
  ];
  const parameterKey = `${key}:${mode}:${slotA}:${slotB}`;
  const sources = player.rows ? [player.window, player.rows] : [player.window];
  return provide(
    TrajectoryContext,
    scope,
    use(CoordinateKernel, {
      upstream,
      shader: player.rows ? SUBSET : WHOLE,
      args,
      sources,
      parameterKey,
      children,
    }),
  );
};

const defaultLoader: TrajectoryLoader = async (src, cancelled, signal) => {
  const { openTrajectory } = await import("@molgpu/io");
  const trajectory = await openTrajectory(src, { signal });
  return cancelled() ? null : trajectory;
};

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
