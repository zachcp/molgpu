// Small renderer-free adapter over the pure math kernels in pinned use.gpu
// 0.20.0. This follows its EaseNumber/EaseAngle and automaticKeyframes math,
// but imports only core ESM functions: the workbench ESM helper cannot load in
// Node because its @use-gpu/core root import omits named ESM exports. Its CJS
// fallback bundled the whole workbench (424 kB unminified).
import {
  bezierEase, catmullRomWeightedDual, clerp, cubicBezier, lerp,
  makeArcLengthMap, sampleToCubicBezier, velocityToBezierEase,
} from '@use-gpu/core/mjs/ease.mjs';

/** A value being interpolated: a number, or a vector as a plain array. */
export type Value = number | number[];
/** Two spline control values with the same shape as the endpoints. */
export type Knots = readonly [Value, Value];
/** Interpolate one segment at eased fraction `t`. `target` is unused (kept for the upstream shape). */
export type Spline = (target: unknown, t: number) => Value;
export type Ease = 'linear' | 'cosine' | 'hold' | 'bezier';

/** A normalized frame, as createCurve builds it. */
export interface Frame {
  readonly time: number;
  readonly value: Value;
  readonly ease?: Ease;
  readonly bezier?: readonly number[];
  readonly knots?: Knots;
  readonly speed?: number;
  readonly in?: number;
  readonly out?: number;
}

export interface EasingType {
  spline(a: Value, b: Value, knots?: Knots): Spline;
  measure(a: Value, b: Value): number;
}

const component = (v: Value, i: number): number => typeof v === 'number' ? v : v[i];
const map = (a: Value, fn: (v: number, i: number) => number): Value =>
  typeof a === 'number' ? fn(a, 0) : Array.from(a, fn);
const zip = (a: Value, b: Value, fn: (x: number, y: number) => number): Value =>
  map(a, (v, i) => fn(v, component(b, i)));
const zip4 = (a: Value, b: Value, c: Value, d: Value, fn: (w: number, x: number, y: number, z: number) => number): Value =>
  map(a, (v, i) => fn(v, component(b, i), component(c, i), component(d, i)));
const measure = (a: Value, b: Value, angle: boolean): number => Math.sqrt(
  (typeof a === 'number' ? [a] : a).reduce((sum, v, i) => {
    const w = component(b, i);
    const delta = v - (angle ? clerp(v, w, 1) : w);
    return sum + delta * delta;
  }, 0));

function spline(a: Value, b: Value, knots: Knots | undefined, angle: boolean): Spline {
  if (!knots) return (_target, t) => zip(a, b, (x, y) => angle ? clerp(x, y, t) : lerp(x, y, t));
  let [k1, k2] = knots;
  if (angle) {
    k1 = zip(a, k1, (x, y) => clerp(x, y, 1));
    k2 = zip(k1, k2, (x, y) => clerp(x, y, 1));
    b = zip(k2, b, (x, y) => clerp(x, y, 1));
  }
  return (_target, t) => zip4(a, k1, k2, b, (x, y, z, w) => cubicBezier(t, x, y, z, w));
}

function autoKnots(a: Value, b: Value, c: Value, d: Value, angle: boolean): Knots {
  const l1 = measure(a, b, angle), l2 = measure(b, c, angle), l3 = measure(c, d, angle);
  if (angle) {
    a = zip(b, a, (x, y) => clerp(x, y, 1));
    const next = zip(b, c, (x, y) => clerp(x, y, 1));
    d = zip(c, d, (x, y) => clerp(x, y, 1));
    c = next;
  }
  // Each component yields its [k1, k2] pair; split them into two knot values.
  const pairs = (typeof b === 'number' ? [0] : b).map((_, i) => {
    const [, k1, k2] = sampleToCubicBezier((t: number) =>
      catmullRomWeightedDual(t, component(a, i), component(b, i), component(c, i), component(d, i), l1, l2, l3));
    return [k1, k2];
  });
  if (typeof b === 'number') return [pairs[0][0], pairs[0][1]];
  return [pairs.map((pair) => pair[0]), pairs.map((pair) => pair[1])];
}

const type = (name: string): EasingType | undefined => name === 'number' || name === 'angle'
  ? { spline: (a, b, knots) => spline(a, b, knots, name === 'angle'),
      measure: (a, b) => measure(a, b, name === 'angle') }
  : undefined;

export const easingType: (name: string) => EasingType | undefined = type;
export const bezier = (fraction: number, knots: readonly number[]): number =>
  bezierEase(fraction, knots[0], knots[1], knots[2], knots[3]);

export function automatic(frames: readonly Frame[], name: string): Frame[] {
  const et = type(name)!;
  const n = frames.length;
  const intervals = frames.slice(0, -1).map((frame, i) => ({
    duration: frames[i + 1].time - frame.time,
    knots: frame.knots ?? autoKnots(frames[i - 1]?.value ?? frame.value,
      frame.value, frames[i + 1].value, frames[i + 2]?.value ?? frames[i + 1].value, name === 'angle'),
  }));
  const arcLengths = intervals.map(({ knots }, i) => {
    const sp = et.spline(frames[i].value, frames[i + 1].value, knots);
    if (et.measure(frames[i].value, frames[i + 1].value) === 0) return 0;
    return makeArcLengthMap((t1: number, t2: number) => et.measure(sp(null, t1), sp(null, t2))).length;
  });
  const speeds = frames.map((frame, i) => {
    if (frame.speed !== undefined) return frame.speed;
    const duration = (intervals[i - 1]?.duration ?? 0) + (intervals[i]?.duration ?? 0);
    const distance = (arcLengths[i - 1] ?? 0) + (arcLengths[i] ?? 0);
    return duration ? distance / duration : 0;
  });
  return [
    ...intervals.map(({ duration, knots }, i): Frame => ({
      time: frames[i].time, value: frames[i].value, ease: 'bezier', knots,
      bezier: velocityToBezierEase(duration, arcLengths[i], speeds[i], speeds[i + 1], frames[i].out, frames[i + 1].in),
    })),
    { time: frames[n - 1].time, value: frames[n - 1].value },
  ];
}
