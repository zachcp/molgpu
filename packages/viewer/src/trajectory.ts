// <Trajectory>: a coordinate provider that plays a TrajectoryData over the
// nearest coordinates. Frames stream through a CPU cache into a four-slot GPU
// window; one kernel interpolates the displayed pair (optionally by minimum
// image) and scatters it through the atomMap. Rows outside the map, and every
// row before the first frame lands, copy upstream. See
// docs/findings/2026-09-26-trajectory-plan.md.
import {
  type LC,
  type LiveContext,
  type LiveElement,
  makeContext,
  provide,
  use,
  useAwait,
  useContext,
  useMemo,
  useResource,
  useState,
} from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import { wgsl } from "@use-gpu/shader/wgsl";
import { LoopContext, useDeviceContext } from "@use-gpu/workbench";
import { type TrajectoryData, validateTrajectory } from "@molgpu/table";
import { type Curve, sample } from "@molgpu/timeline";
import type {
  TrajectoryFrameState,
  TrajectoryLoader,
  TrajectoryProps,
  ViewerComponent,
} from "./types.ts";
import { useCoordinates } from "./coordinates-context.ts";
import { TimelineContext } from "./timeline-context.ts";
import { CoordinateKernel } from "./internal/coordinate-kernel.ts";
import { FrameCache } from "./internal/frame-cache.ts";
import {
  type FramePair,
  FrameScheduler,
  invert3,
  WINDOW_SLOTS,
} from "./internal/frame-window.ts";
import {
  count,
  gauge,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";
import { live, viewer } from "./internal/elements.ts";

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
@link fn getWindow(i: u32) -> f32;
`;
const BODY = `
@link fn getInput(i: u32) -> vec3<f32>;
@link var<storage, read_write> output: array<f32>;

fn frameAt(slot: u32, j: u32) -> vec3<f32> {
  let k = (slot * u32(getFrameAtoms()) + j) * 3u;
  return vec3<f32>(getWindow(k), getWindow(k + 1u), getWindow(k + 2u));
}

fn blend(j: u32) -> vec3<f32> {
  let p0 = frameAt(u32(getSlotA()), j);
  let p1 = frameAt(u32(getSlotB()), j);
  var d = p1 - p0;
  if (u32(getMode()) == 2u) {
    var s = mat3x3<f32>(getInv0(), getInv1(), getInv2()) * d;
    s = s - floor(s + vec3<f32>(0.5));
    d = mat3x3<f32>(getBox0(), getBox1(), getBox2()) * s;
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

export const TrajectoryContext: LiveContext<TrajectoryFrameState | null> =
  makeContext<TrajectoryFrameState | null>(null, "TrajectoryContext");

/** What the nearest `<Trajectory>` shows; null outside one. */
export function useTrajectoryFrame(): TrajectoryFrameState | null {
  return useContext(TrajectoryContext);
}

const ZERO3 = [0, 0, 0];

type PlayerProps = {
  trajectory: TrajectoryData;
  frame: number | Curve<number>;
  interpolate: "linear" | "nearest";
  pbc: "none" | "minimum-image";
  children: LiveElement;
};

/** An empty structure has nothing to move. */
const TrajectoryProvider: LC<PlayerProps> = (props) =>
  useCoordinates() ? use(TrajectoryPlayer, props) : props.children;

const TrajectoryPlayer: LC<PlayerProps> = (
  { trajectory, frame, interpolate, pbc, children },
) => {
  const upstream = useCoordinates()!;
  const time = useContext(TimelineContext);
  const device = useDeviceContext();
  const requestRepaint = useContext(LoopContext);
  const [, setLanded] = useState(0);
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
  useMemo(() => validateTrajectory(structure, trajectory), [
    structure,
    trajectory,
  ]);
  const player = useMemo(
    () => new Player(device, trajectory, upstream.count),
    [device, trajectory, upstream.count],
  );
  useResource((dispose) => {
    player.cache.onLoad = () => {
      setLanded((n) => n + 1);
      requestRepaint();
    };
    player.cache.onError = (index, error) => {
      console.error(`<Trajectory>: frame ${index} failed to load`, error);
    };
    dispose(() => player.close());
  }, [player]);

  const clamped = Math.min(Math.max(requested, 0), trajectory.frameCount - 1);
  const display = player.scheduler.update(requested, interpolate);
  const box = player.box(display);
  const a = display ? player.cache.get(display.a)?.box : undefined;
  const minimumImage = pbc === "minimum-image" && box && a ? a : null;
  const inverse = minimumImage ? invert3(minimumImage) : null;
  const mode = !display ? 0 : inverse ? 2 : 1;
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
    column(inverse, 0),
    column(inverse, 1),
    column(inverse, 2),
  ];
  const key = display
    ? `${player.id}:${mode}:${display.a}@${slotA}:${display.b}@${slotB}:${display.t}`
    : `${player.id}:0`;
  const sources = player.rows ? [player.window, player.rows] : [player.window];
  const state = useMemo<TrajectoryFrameState>(() =>
    Object.freeze({
      trajectory,
      requested: clamped,
      displayed: display ? Object.freeze({ ...display }) : null,
      frame: display ? display.a + display.t * (display.b - display.a) : null,
      box,
    }), [trajectory, clamped, key]);
  return provide(
    TrajectoryContext,
    state,
    use(CoordinateKernel, {
      upstream,
      shader: player.rows ? SUBSET : WHOLE,
      args,
      sources,
      parameterKey: key,
      children,
    }),
  );
};

const defaultLoader: TrajectoryLoader = async (src, cancelled) => {
  const { openTrajectory } = await import("@molgpu/io");
  const trajectory = await openTrajectory(src);
  return cancelled() ? null : trajectory;
};

/**
 * Play a trajectory over the nearest coordinates (a coordinate provider,
 * INVARIANT 6): descendants see its frames; topology never changes. `frame`
 * is a fractional frame or a timeline curve. Frames stream on demand; until
 * the first one lands, and for rows outside `atomMap`, upstream coordinates
 * show. With `src`, children render unmoved while the file opens, then
 * remount once under the trajectory.
 */
export const Trajectory: ViewerComponent<TrajectoryProps> = (
  {
    data,
    src,
    loader = defaultLoader,
    frame,
    interpolate = "linear",
    pbc = "none",
    children,
  },
) => {
  if (data !== undefined && src !== undefined) {
    throw new TypeError("<Trajectory> accepts either data or src, not both");
  }
  if (data === undefined && src === undefined) {
    throw new TypeError("<Trajectory> requires data or src");
  }
  if (!["linear", "nearest"].includes(interpolate)) {
    throw new TypeError("<Trajectory> interpolate must be linear or nearest");
  }
  if (!["none", "minimum-image"].includes(pbc)) {
    throw new TypeError("<Trajectory> pbc must be none or minimum-image");
  }
  const [loaded, failure] = useAwait(
    data === undefined
      ? async (cancelled: () => boolean) => loader(src!, cancelled)
      : null,
    [src, loader],
  );
  if (failure) throw failure;
  const trajectory = data ?? loaded;
  if (!trajectory) return children;
  return viewer(
    use(TrajectoryProvider, {
      trajectory,
      frame,
      interpolate,
      pbc,
      children: live(children),
    }),
  );
};
