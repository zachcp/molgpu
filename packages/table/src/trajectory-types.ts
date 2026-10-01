// Frame samples and lazy trajectory sources over fixed molecular topology.
/**
 * One decoded trajectory frame. Immutable by contract: once a source returns
 * it, nobody writes its arrays, and consumers may retain it.
 */
export interface TrajectoryFrame {
  /** x, y, z per trajectory atom in Å, in trajectory atom order. */
  readonly positions: Float32Array;
  /** Column-major 3×3 box vectors in Å (a, b, c as columns); absent if none. */
  readonly box?: Float32Array;
  /** Å/ps in the layout of `positions`; only when a reader was asked for them. */
  readonly velocities?: Float32Array;
}
/**
 * Decodes frames on demand, so a trajectory never has to fit in memory. Return
 * fresh arrays (or ones never written again) on each read: do not reuse a
 * decode buffer. `createTrajectory` validates every frame a source returns.
 */
export interface FrameSource {
  /** Decode frame `index`. Rejects with an `AbortError` when `signal` aborts. */
  read(index: number, signal?: AbortSignal): Promise<TrajectoryFrame>;
}
/**
 * Time axis of a trajectory: picoseconds, integrator steps, or plain frame
 * indices when the source records no time (NMR models).
 */
export type TrajectoryTimeUnit = "ps" | "step" | "index";
/** Input to `createTrajectory`: in-memory `frames`, or a `source` and `frameCount`. */
export interface TrajectoryInput {
  readonly atomCount: number;
  readonly frames?: readonly TrajectoryFrame[];
  readonly source?: FrameSource;
  readonly frameCount?: number;
  /** Per-frame time, nondecreasing. Default: the frame index, unit "index". */
  readonly time?: ArrayLike<number>;
  readonly timeUnit?: TrajectoryTimeUnit;
  /** Topology row of each trajectory atom, for trajectories over a subset. */
  readonly atomMap?: ArrayLike<number>;
}
/** A validated, immutable trajectory: coordinates only; topology is the structure's. */
export interface TrajectoryData {
  /** Atoms per frame. */
  readonly atomCount: number;
  readonly frameCount: number;
  readonly time: Float64Array;
  readonly timeUnit: TrajectoryTimeUnit;
  /** Trajectory atom `i` moves topology row `atomMap[i]`; other rows keep upstream coordinates. */
  readonly atomMap?: Uint32Array;
  readonly source: FrameSource;
}
