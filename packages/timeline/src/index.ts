import { easingType, automatic, bezier, type Frame, type Knots, type Spline, type Value } from './internal/upstream-interpolation.ts';

/** A sampled curve value: a number, or a fresh fixed-width vector. */
export type CurveValue = number | readonly number[];

export interface Beat { readonly name: string; readonly time: number }
export interface Timeline {
  readonly unit: 'seconds';
  readonly beats: readonly Beat[];
  /** Seconds for a named beat; throws RangeError for an unknown name. */
  time(name: string): number;
}

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

/** What a curve holds besides its public fields. Only this module reads it. */
interface CurveState<T extends CurveValue> extends Curve<T> {
  readonly keyframes: readonly Frame[];
  readonly splines: readonly Spline[];
}

type AnyVector = readonly number[] | Float32Array | Float64Array;

const finite = (value: unknown, label: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
};
const clone = (value: number | ArrayLike<number>): Value => typeof value === 'number' ? value : Array.from(value);

/** Named instants in one global clock. Beats need unique nonempty names and
 * times strictly increasing from 0 or later. All times are seconds. */
export function createTimeline(beats: readonly Beat[]): Timeline {
  if (!Array.isArray(beats) || !beats.length) throw new TypeError('beats must be a nonempty array');
  const byName = new Map<string, number>();
  let previous = -Infinity;
  for (const beat of beats) {
    if (typeof beat?.name !== 'string' || !beat.name) throw new TypeError('beat name must be nonempty');
    finite(beat.time, `beat ${beat.name} time`);
    if (beat.time < 0 || beat.time <= previous) throw new RangeError('beat times must increase from zero or later');
    if (byName.has(beat.name)) throw new TypeError(`duplicate beat: ${beat.name}`);
    byName.set(beat.name, beat.time);
    previous = beat.time;
  }
  return Object.freeze({
    unit: 'seconds',
    beats: Object.freeze(beats.map(({ name, time }) => Object.freeze({ name, time }))),
    time: (name: string): number => {
      const time = byName.get(name);
      if (time === undefined) throw new RangeError(`unknown beat: ${name}`);
      return time;
    },
  });
}

/** Build a reusable curve from at least two frames with strictly increasing
 * times. All frame values must share one shape (all numbers, or all vectors of
 * one length). Scalar frames sample to `number`; vector frames sample to a fresh
 * `number[]`. `ease` describes the segment starting at its frame, and the last
 * frame is the value at the exact endpoint. */
export function createCurve(frames: readonly Keyframe<number>[], options?: CurveOptions): Curve<number>;
export function createCurve(frames: readonly Keyframe<readonly number[] | Float32Array | Float64Array>[], options?: CurveOptions): Curve<number[]>;
export function createCurve(frames: readonly Keyframe<number | AnyVector>[], options: CurveOptions = {}): Curve<number | number[]> {
  const { type = 'number', automatic: auto = false, extrapolate = 'clamp' } = options;
  if (!Array.isArray(frames) || frames.length < 2) throw new TypeError('curve needs at least two frames');
  if (!['number', 'angle'].includes(type)) throw new TypeError(`unsupported curve type: ${type}`);
  if (!['clamp', 'loop'].includes(extrapolate)) throw new TypeError('extrapolate must be clamp or loop');
  let previous = -Infinity;
  let width: number | undefined;
  const input = frames.map((frame, i): Frame => {
    finite(frame?.time, `frame ${i} time`);
    if (frame.time <= previous) throw new RangeError('frame times must strictly increase');
    previous = frame.time;
    // Frames may come from untyped callers: validate the value as unknown input.
    const value = frame.value as number | ArrayLike<number>;
    if (typeof value === 'number') finite(value, `frame ${i} value`);
    else if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw new TypeError(`frame ${i} value must be a number or vector`);
    const shape = typeof value === 'number' ? 0 : value.length;
    if (typeof value !== 'number' && (!shape || Array.from(value).some((v) => !Number.isFinite(v))))
      throw new TypeError(`frame ${i} vector must be nonempty and finite`);
    if (width === undefined) width = shape;
    if (shape !== width || (shape !== 0 && shape < 1)) throw new TypeError('all frame values must have the same shape');
    if (frame.ease !== undefined && !['linear', 'cosine', 'hold', 'bezier'].includes(frame.ease)) throw new TypeError(`unsupported ease: ${frame.ease}`);
    const controls: readonly number[] | undefined = frame.bezier;
    if (frame.ease === 'bezier' && (!Array.isArray(controls) || controls.length !== 4 || controls.some((x) => !Number.isFinite(x)))) throw new TypeError('bezier ease needs four finite controls');
    return { time: frame.time, value: clone(value), ease: frame.ease, bezier: frame.bezier, knots: frame.knots as Knots | undefined };
  });
  if (auto && input.some((frame) => frame.ease || frame.knots)) throw new TypeError('automatic curves do not accept explicit easing or knots');
  const keyframes = auto ? automatic(input, type) : input;
  const et = easingType(type)!;
  const splines = keyframes.slice(0, -1).map((frame, i) => et.spline(frame.value, keyframes[i + 1].value, frame.knots));
  const curve: CurveState<number | number[]> = Object.freeze({ unit: 'seconds', type, extrapolate, keyframes, splines });
  return curve;
}

/** Pure arbitrary-time sample in seconds. Throws TypeError for non-finite time.
 * Repeated, reversed and out-of-range reads do not depend on wall time or
 * previous samples. Returned vectors are fresh arrays the caller owns. */
export function sample<T extends CurveValue>(curve: Curve<T>, time: number): T {
  finite(time, 'sample time');
  const { keyframes, splines, extrapolate } = curve as CurveState<T>;
  const start = keyframes[0].time, end = keyframes.at(-1)!.time;
  const t = extrapolate === 'loop' && (time < start || time >= end)
    ? start + (((time - start) % (end - start)) + (end - start)) % (end - start)
    : Math.max(start, Math.min(end, time));
  if (t === end) return clone(keyframes.at(-1)!.value) as T;
  let i = 0;
  while (i < splines.length - 1 && t >= keyframes[i + 1].time) i++;
  const frame = keyframes[i];
  const u = (t - frame.time) / (keyframes[i + 1].time - frame.time);
  const ease = frame.ease ?? 'linear';
  const eased = ease === 'hold' ? 0 : ease === 'cosine' ? (1 - Math.cos(Math.PI * u)) / 2
    : ease === 'bezier' ? bezier(u, frame.bezier!) : u;
  const target = clone(frame.value);
  return splines[i](target, eased) as T;
}
