// Pure playback logic for <Trajectory>: which frames a fractional frame needs,
// what to show while they load, which GPU slot a frame goes to, and a CPU
// reference for the interpolation kernel. See the trajectory plan, section 3.
import type { TrajectoryFrame } from "@molgpu/table";

/** Frames interpolated on screen: `a + t * (b - a)` per atom. */
export interface FramePair {
  readonly a: number;
  readonly b: number;
  readonly t: number;
}

/** Fractional frames this close to an integer show that frame alone. */
export const FRAME_SNAP = 1e-6;

/** GPU slots in the frame window: the displayed pair plus two prefetches. */
export const WINDOW_SLOTS = 4;

/**
 * The pair a fractional `frame` needs, clamped to `[0, frameCount - 1]`.
 * `"nearest"` rounds; `"linear"` interpolates `floor` toward `floor + 1`. An
 * integral frame needs one frame (`a === b`).
 */
export function framePair(
  frame: number,
  frameCount: number,
  interpolate: "linear" | "nearest",
): FramePair {
  if (!Number.isFinite(frame)) {
    throw new TypeError("<Trajectory> frame must be finite");
  }
  let f = Math.min(Math.max(frame, 0), frameCount - 1);
  // A beat placed at frameTime(i) samples to i ± rounding error; show frame i
  // alone rather than a pair that needs its neighbour loaded too.
  if (Math.abs(f - Math.round(f)) < FRAME_SNAP) f = Math.round(f);
  if (interpolate === "nearest") {
    const a = Math.round(f);
    return { a, b: a, t: 0 };
  }
  const a = Math.floor(f);
  const t = f - a;
  return t === 0 ? { a, b: a, t: 0 } : { a, b: a + 1, t };
}

/** Frames to read ahead of `pair` in the direction of travel (+1 or -1). */
export function prefetchFrames(
  pair: FramePair,
  direction: 1 | -1,
  depth: number,
  frameCount: number,
): number[] {
  const from = direction > 0
    ? Math.max(pair.a, pair.b)
    : Math.min(pair.a, pair.b);
  const out: number[] = [];
  for (let k = 1; k <= depth; k++) {
    const i = from + direction * k;
    if (i >= 0 && i < frameCount) out.push(i);
  }
  return out;
}

/**
 * What to show for `wanted` given which frames are resident on the GPU: the
 * pair itself; else the resident frame of the pair nearer the requested
 * position; else the last displayed pair (still resident, because displayed
 * slots are pinned); else null, meaning "copy upstream".
 */
export function resolveDisplay(
  wanted: FramePair,
  resident: (frame: number) => boolean,
  last: FramePair | null,
): FramePair | null {
  const ra = resident(wanted.a), rb = resident(wanted.b);
  if (ra && rb) return wanted;
  const near = wanted.t < 0.5 ? [wanted.a, wanted.b] : [wanted.b, wanted.a];
  for (const f of near) if (resident(f)) return { a: f, b: f, t: 0 };
  return last;
}

/** Which frame each GPU slot holds, with least-recently-used replacement. */
export class SlotTable {
  readonly #frames: (number | null)[];
  readonly #used: number[];
  #clock = 0;
  constructor(slots: number = WINDOW_SLOTS) {
    this.#frames = new Array(slots).fill(null);
    this.#used = new Array(slots).fill(0);
  }
  /** The slot holding `frame`, or -1; marks it recently used. */
  slotOf(frame: number): number {
    const slot = this.#frames.indexOf(frame);
    if (slot >= 0) this.#used[slot] = ++this.#clock;
    return slot;
  }
  has(frame: number): boolean {
    return this.#frames.includes(frame);
  }
  /**
   * The slot `frame` should be written to: an empty slot, else the least
   * recently used slot whose frame is not pinned. -1 when every slot is
   * pinned. The caller writes the frame, then the table records it.
   */
  assign(frame: number, pinned: ReadonlySet<number>): number {
    const existing = this.#frames.indexOf(frame);
    if (existing >= 0) return existing;
    let best = -1;
    for (let s = 0; s < this.#frames.length; s++) {
      const held = this.#frames[s];
      if (held === null) {
        best = s;
        break;
      }
      if (pinned.has(held)) continue;
      if (best < 0 || this.#used[s] < this.#used[best]) best = s;
    }
    if (best >= 0) {
      this.#frames[best] = frame;
      this.#used[best] = ++this.#clock;
    }
    return best;
  }
  frames(): readonly (number | null)[] {
    return [...this.#frames];
  }
}

/** The subset of FrameCache the scheduler drives. */
interface FrameStore {
  want(needed: readonly number[], prefetch?: readonly number[]): void;
  get(index: number): TrajectoryFrame | undefined;
}

/**
 * Playback policy with the GPU write injected: which frames to want, which
 * cached frames to upload into which slot, and what to display. `<Trajectory>`
 * runs one per mount; tests drive it with a fake `upload`.
 */
export class FrameScheduler {
  readonly slots: SlotTable;
  last: FramePair | null = null;
  /** Updates whose wanted pair was not on screen (it showed a fallback). */
  holds = 0;
  #direction: 1 | -1 = 1;
  #previous = NaN;
  readonly #cache: FrameStore;
  readonly #frameCount: number;
  readonly #upload: (
    slot: number,
    index: number,
    frame: TrajectoryFrame,
  ) => void;
  readonly #depth: number;

  constructor(
    cache: FrameStore,
    frameCount: number,
    upload: (slot: number, index: number, frame: TrajectoryFrame) => void,
    options: { slots?: number; prefetch?: number } = {},
  ) {
    this.#cache = cache;
    this.#frameCount = frameCount;
    this.#upload = upload;
    this.slots = new SlotTable(options.slots ?? WINDOW_SLOTS);
    this.#depth = options.prefetch ?? 2;
  }

  /**
   * Ask for `requested`: pin the wanted and displayed pairs, upload any
   * cached frame the pair or the prefetch needs into an unpinned slot, and
   * return what can be shown now (null: copy upstream).
   */
  update(
    requested: number,
    interpolate: "linear" | "nearest",
  ): FramePair | null {
    const pair = framePair(requested, this.#frameCount, interpolate);
    if (requested > this.#previous) this.#direction = 1;
    else if (requested < this.#previous) this.#direction = -1;
    this.#previous = requested;
    const needed = pair.a === pair.b ? [pair.a] : [pair.a, pair.b];
    const shown = this.last ? [this.last.a, this.last.b] : [];
    const prefetch = prefetchFrames(
      pair,
      this.#direction,
      this.#depth,
      this.#frameCount,
    );
    this.#cache.want([...needed, ...shown], prefetch);
    // The displayed pair may still be read by a dispatch that has not run,
    // and the wanted pair is about to be: neither may be overwritten.
    const pinned = new Set([...needed, ...shown]);
    for (const f of [...needed, ...prefetch]) {
      if (this.slots.has(f)) continue;
      const frame = this.#cache.get(f);
      if (!frame) continue;
      const slot = this.slots.assign(f, pinned);
      if (slot >= 0) this.#upload(slot, f, frame);
    }
    const display = resolveDisplay(pair, (f) => this.slots.has(f), this.last);
    if (display !== pair) this.holds++;
    this.last = display;
    return display;
  }
}

/** Inverse of a column-major 3×3 matrix, or null when singular. */
export function invert3(m: ArrayLike<number>): Float64Array | null {
  const [a, b, c, d, e, f, g, h, i] = Array.from(m);
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return Float64Array.from([
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ]);
}

/**
 * CPU reference for the interpolation kernel: `p0 + t (p1 - p0)` per atom, or
 * with `box` the minimum-image displacement in that box's fractional
 * coordinates. The WGSL kernel implements the same arithmetic.
 */
export function interpolatePositions(
  p0: Float32Array,
  p1: Float32Array,
  t: number,
  box?: ArrayLike<number>,
): Float32Array {
  const out = new Float32Array(p0.length);
  const inv = box ? invert3(box) : null;
  for (let i = 0; i < p0.length; i += 3) {
    let d = [p1[i] - p0[i], p1[i + 1] - p0[i + 1], p1[i + 2] - p0[i + 2]];
    if (box && inv) {
      const s = [0, 1, 2].map((r) => {
        const v = inv[r] * d[0] + inv[3 + r] * d[1] + inv[6 + r] * d[2];
        return v - Math.round(v);
      });
      d = [0, 1, 2].map((r) =>
        box[r] * s[0] + box[3 + r] * s[1] + box[6 + r] * s[2]
      );
    }
    out[i] = p0[i] + t * d[0];
    out[i + 1] = p0[i + 1] + t * d[1];
    out[i + 2] = p0[i + 2] + t * d[2];
  }
  return out;
}
