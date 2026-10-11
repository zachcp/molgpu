// Caller-facing playback contracts. Scientific frames, atom maps and time units
// belong to @molgpu/table; the player owns packed XYZ storage and its GPU window.
// TrajectoryFrameState describes displayed metadata, not GPU completion or the
// coordinate publication identity owned by CoordinateKernel.
import type { TrajectoryData } from "@molgpu/table";
import type { Curve } from "@molgpu/timeline";
import type { ViewerElement } from "../types.ts";

/** Open with a request signal; replacement/unmount aborts it and suppresses stale results. */
export type TrajectoryLoader = (
  src: string,
  cancelled: () => boolean,
  signal?: AbortSignal,
) => TrajectoryData | null | Promise<TrajectoryData | null>;

/**
 * Source and frame state of one `<Trajectory>`. On `error`, upstream
 * coordinates pass through until the source changes; `phase` says whether
 * opening the source or reading `frame` failed.
 */
export type TrajectoryStatus =
  | { readonly status: "opening" }
  | { readonly status: "ready"; readonly frameCount: number }
  | {
    readonly status: "error";
    readonly phase: "source" | "frame";
    /** The frame that failed to load, or null for a source failure. */
    readonly frame: number | null;
    readonly error: unknown;
  };

/**
 * `<Trajectory>` props: playback (`frame`, `interpolate`, `pbc`) plus exactly
 * one of `data` (opened already, e.g. with `openTrajectory` from @molgpu/io) or
 * `src` (a DCD/XTC/TRR URL streamed through @molgpu/io).
 */
export type TrajectoryProps =
  & {
    children?: ViewerElement;
    /**
     * Fractional frame index, or a curve from timeline seconds to frames (see
     * `frameCurve` in @molgpu/timeline). Clamped to `[0, frameCount - 1]`.
     */
    frame: number | Curve<number>;
    /** `"linear"` (default) blends neighbouring frames; `"nearest"` rounds. */
    interpolate?: "linear" | "nearest";
    /**
     * `"minimum-image"` interpolates each atom along the shortest periodic
     * displacement when both frames carry a box, so atoms that wrap do not
     * cross the box on screen. Default `"none"`.
     */
    pbc?: "none" | "minimum-image";
    /**
     * Source and frame state. Failures pass upstream coordinates through and
     * are reported here instead of thrown; without a callback each failure is
     * logged once with `console.error`.
     */
    onStatus?: (status: TrajectoryStatus) => void;
  }
  & (
    | { data: TrajectoryData; src?: undefined; loader?: undefined }
    | {
      src: string;
      data?: undefined;
      /** Defaults to `openTrajectory(src)` (HTTP Range reads). Pass a stable function. */
      loader?: TrajectoryLoader;
    }
  );

/** What the nearest `<Trajectory>` shows, from `useTrajectoryFrame()`. */
export interface TrajectoryFrameState {
  readonly trajectory: TrajectoryData;
  /** The clamped frame asked for (after sampling a curve). */
  readonly requested: number;
  /**
   * Frames on screen, `a + t (b - a)`. It trails `requested` while frames
   * load, and is null before the first frame lands (upstream coordinates show).
   */
  readonly displayed: {
    readonly a: number;
    readonly b: number;
    readonly t: number;
  } | null;
  /** `a + t (b - a)` of `displayed`, or null. */
  readonly frame: number | null;
  /** Interpolated column-major box of the displayed frames, if both have one. */
  readonly box: Float32Array | null;
}
