// A byte-capped LRU of decoded trajectory frames in front of a FrameSource,
// with cancellable prefetch. Renderer-free; see the trajectory plan, section 3.
import type { FrameSource, TrajectoryFrame } from "@molgpu/table";

/** Default CPU cache cap: 256 MiB of decoded frames. */
export const FRAME_CACHE_BYTES = 256 * 1024 * 1024;

const frameBytes = (frame: TrajectoryFrame): number =>
  frame.positions.byteLength + (frame.box?.byteLength ?? 0) +
  (frame.velocities?.byteLength ?? 0);

export interface FrameCacheStats {
  /** Decoded frames currently held. */
  readonly frames: number;
  readonly bytes: number;
  /** Reads started (misses), and reads aborted before they landed. */
  readonly reads: number;
  readonly aborted: number;
  readonly failures: number;
}

/**
 * Holds decoded frames up to `maxBytes`, never fewer than the frames the
 * caller currently wants. `want(needed, prefetch)` starts the missing reads
 * and aborts in-flight reads that are in neither list. `onLoad` fires when a
 * frame lands; `onError` when a needed frame fails.
 */
export class FrameCache {
  readonly #source: FrameSource;
  readonly #frameCount: number;
  readonly #maxBytes: number;
  readonly #frames = new Map<number, TrajectoryFrame>(); // insertion = LRU order
  readonly #inflight = new Map<number, AbortController>();
  #pinned = new Set<number>();
  #bytes = 0;
  #reads = 0;
  #aborted = 0;
  #failures = 0;
  #closed = false;
  onLoad: (index: number) => void = () => {};
  onError: (index: number, error: unknown) => void = () => {};

  constructor(
    source: FrameSource,
    frameCount: number,
    maxBytes: number = FRAME_CACHE_BYTES,
  ) {
    this.#source = source;
    this.#frameCount = frameCount;
    this.#maxBytes = maxBytes;
  }

  get stats(): FrameCacheStats {
    return {
      frames: this.#frames.size,
      bytes: this.#bytes,
      reads: this.#reads,
      aborted: this.#aborted,
      failures: this.#failures,
    };
  }

  /** The decoded frame if it is cached; marks it recently used. */
  get(index: number): TrajectoryFrame | undefined {
    const frame = this.#frames.get(index);
    if (frame) {
      this.#frames.delete(index);
      this.#frames.set(index, frame);
    }
    return frame;
  }

  has(index: number): boolean {
    return this.#frames.has(index);
  }

  /**
   * Declare the frames on screen or about to be (`needed`, pinned against
   * eviction) and the frames worth reading ahead (`prefetch`, in priority
   * order). Out-of-range indices are ignored.
   */
  want(needed: readonly number[], prefetch: readonly number[] = []): void {
    if (this.#closed) return;
    const valid = (i: number) =>
      Number.isInteger(i) && i >= 0 && i < this.#frameCount;
    this.#pinned = new Set(needed.filter(valid));
    const wanted = new Set([...this.#pinned, ...prefetch.filter(valid)]);
    for (const [index, controller] of this.#inflight) {
      if (!wanted.has(index)) {
        controller.abort();
        this.#inflight.delete(index);
        this.#aborted++;
      }
    }
    for (const index of wanted) {
      if (!this.#frames.has(index) && !this.#inflight.has(index)) {
        this.#start(index);
      }
    }
    for (const index of this.#pinned) this.get(index);
  }

  #start(index: number): void {
    const controller = new AbortController();
    this.#inflight.set(index, controller);
    this.#reads++;
    this.#source.read(index, controller.signal).then(
      (frame) => {
        if (this.#inflight.get(index) !== controller || this.#closed) return;
        this.#inflight.delete(index);
        this.#frames.set(index, frame);
        this.#bytes += frameBytes(frame);
        this.#evict();
        this.onLoad(index);
      },
      (error) => {
        if (this.#inflight.get(index) !== controller || this.#closed) return;
        this.#inflight.delete(index);
        this.#failures++;
        this.onError(index, error);
      },
    );
  }

  #evict(): void {
    for (const [index, frame] of this.#frames) {
      if (this.#bytes <= this.#maxBytes) break;
      if (this.#pinned.has(index)) continue;
      this.#frames.delete(index);
      this.#bytes -= frameBytes(frame);
    }
  }

  /** Abort every read and drop every frame. */
  close(): void {
    this.#closed = true;
    for (const controller of this.#inflight.values()) controller.abort();
    this.#inflight.clear();
    this.#frames.clear();
    this.#bytes = 0;
  }
}
