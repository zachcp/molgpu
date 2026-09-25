/** A sampled curve value: a number, or a fresh fixed-width vector. */
export type CurveValue = number | readonly number[];

export interface Beat { readonly name: string; readonly time: number }
export interface Timeline {
  readonly unit: 'seconds';
  readonly beats: readonly Beat[];
  /** Seconds for a named beat; throws RangeError for an unknown name. */
  time(name: string): number;
}
/** Beats need unique nonempty names and times strictly increasing from 0 or later. */
export function createTimeline(beats: readonly Beat[]): Timeline;

/**
 * One curve frame. `ease` describes the segment starting at this frame
 * (`'bezier'` requires `bezier` controls); `knots` are explicit spline control
 * values with the same shape as `value`. Vector values may be plain arrays or
 * Float32Array/Float64Array; they are copied on construction.
 */
export interface Keyframe<T extends number | readonly number[] | Float32Array | Float64Array = CurveValue> {
  readonly time: number;
  readonly value: T;
  readonly ease?: 'linear' | 'cosine' | 'hold' | 'bezier';
  readonly bezier?: readonly [number, number, number, number];
  readonly knots?: readonly [T, T];
}

/** An immutable, opaque curve. Read it only through `sample`. */
export interface Curve<T extends CurveValue> {
  readonly unit: 'seconds';
  readonly type: 'number' | 'angle';
  readonly extrapolate: 'clamp' | 'loop';
}

export interface CurveOptions {
  /** `'angle'` interpolates along the short arc. Default `'number'`. */
  readonly type?: 'number' | 'angle';
  /** Derive smooth knots and easing; frames must not set `ease` or `knots`. */
  readonly automatic?: boolean;
  /** Out-of-range samples clamp (default) or wrap. */
  readonly extrapolate?: 'clamp' | 'loop';
}

/** Build a reusable curve from at least two frames with strictly increasing
 * times. All frame values must share one shape (all numbers, or all vectors of
 * one length). Scalar frames sample to `number`; vector frames sample to a fresh
 * `number[]`. */
export function createCurve(frames: readonly Keyframe<number>[], options?: CurveOptions): Curve<number>;
export function createCurve(frames: readonly Keyframe<readonly number[] | Float32Array | Float64Array>[], options?: CurveOptions): Curve<number[]>;

/** Pure arbitrary-time sample in seconds. Throws TypeError for non-finite time.
 * Returned vectors are fresh arrays the caller owns. */
export function sample<T extends CurveValue>(curve: Curve<T>, time: number): T;
