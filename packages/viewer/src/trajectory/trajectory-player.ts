// Playback mechanics for <Trajectory>: the per-mount Player that owns the GPU
// frame window, the inverse atom map and the CPU frame cache, and the kernels
// and arguments that interpolate the displayed pair over upstream coordinates.
// The component in ../trajectory.ts owns orchestration, status and scope.
import type { StorageSource } from "@use-gpu/core";
import { wgsl } from "@use-gpu/shader/wgsl";
import type { TrajectoryData } from "@molgpu/table";
import type { PeriodicBox } from "@molgpu/dynamics";
import { FrameCache } from "./frame-cache.ts";
import {
  type FramePair,
  FrameScheduler,
  trajectoryImageBox,
  TrajectoryImageBoxLimitError,
  WINDOW_SLOTS,
} from "./frame-window.ts";
import { count, gauge } from "../internal/instrumentation.ts";
import { ComputeBuffers } from "../internal/compute-buffers.ts";

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
export const COPY_UPSTREAM = wgsl`
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
export class Player {
  readonly id = ++players;
  readonly atomCount: number;
  readonly window: StorageSource;
  readonly rows: StorageSource | null;
  readonly cache: FrameCache;
  readonly scheduler: FrameScheduler;
  readonly #buffers: ComputeBuffers;
  constructor(device: GPUDevice, trajectory: TrajectoryData, rows: number) {
    const n = trajectory.atomCount;
    this.atomCount = n;
    const bytes = WINDOW_SLOTS * n * 12;
    const limit = device.limits.maxStorageBufferBindingSize;
    if (bytes > limit) {
      throw new RangeError(
        `<Trajectory>: ${WINDOW_SLOTS} frames of ${n} atoms need ${bytes} bytes, ` +
          `over this device's maxStorageBufferBindingSize (${limit})`,
      );
    }
    this.#buffers = new ComputeBuffers(device);
    const buffer = this.#buffers.buffer(
      bytes,
      STORAGE | COPY_DST | COPY_SRC,
      "coords:trajectory:window",
      undefined,
      4,
    );
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
      this.rows = this.#buffers.source(
        inverse,
        STORAGE | COPY_DST,
        "coords:trajectory:map",
      );
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
    this.#buffers.destroy();
  }
}

const ZERO3 = [0, 0, 0];

/** Shader, link arguments and sources for one displayed pair. Modes: 0 copy
 * upstream (no pair yet), 1 lerp, 2 minimum image. */
export function playbackKernel(
  player: Player,
  display: FramePair | null,
  pbc: "none" | "minimum-image",
  key: string,
): {
  shader: typeof COPY_UPSTREAM;
  args: unknown[];
  sources: StorageSource[];
  parameterKey: string;
} {
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
    player.atomCount,
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
  return {
    shader: player.rows ? SUBSET : WHOLE,
    args,
    sources,
    parameterKey,
  };
}
