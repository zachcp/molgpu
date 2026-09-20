// Small renderer-free adapter over the pure math kernels in pinned use.gpu
// 0.20.0. This follows its EaseNumber/EaseAngle and automaticKeyframes math,
// but imports only core ESM functions: the workbench ESM helper cannot load in
// Node because its @use-gpu/core root import omits named ESM exports. Its CJS
// fallback bundled the whole workbench (424 kB unminified).
import {
  bezierEase, catmullRomWeightedDual, clerp, cubicBezier, lerp,
  makeArcLengthMap, sampleToCubicBezier, velocityToBezierEase,
} from '@use-gpu/core/mjs/ease.mjs';

const map = (a, fn) => typeof a === 'number' ? fn(a, 0) : Array.from(a, fn);
const zip = (a, b, fn) => map(a, (v, i) => fn(v, typeof b === 'number' ? b : b[i]));
const zip4 = (a, b, c, d, fn) => map(a, (v, i) => fn(v,
  typeof b === 'number' ? b : b[i], typeof c === 'number' ? c : c[i], typeof d === 'number' ? d : d[i]));
const measure = (a, b, angle) => Math.sqrt(
  (typeof a === 'number' ? [a] : a).reduce((sum, v, i) => {
    const w = typeof b === 'number' ? b : b[i];
    const delta = v - (angle ? clerp(v, w, 1) : w);
    return sum + delta * delta;
  }, 0));

function spline(a, b, knots, angle) {
  if (!knots) return (_target, t) => zip(a, b, (x, y) => angle ? clerp(x, y, t) : lerp(x, y, t));
  let [k1, k2] = knots;
  if (angle) {
    k1 = zip(a, k1, (x, y) => clerp(x, y, 1));
    k2 = zip(k1, k2, (x, y) => clerp(x, y, 1));
    b = zip(k2, b, (x, y) => clerp(x, y, 1));
  }
  return (_target, t) => zip4(a, k1, k2, b, (x, y, z, w) => cubicBezier(t, x, y, z, w));
}

function autoKnots(a, b, c, d, angle) {
  const l1 = measure(a, b, angle), l2 = measure(b, c, angle), l3 = measure(c, d, angle);
  if (angle) {
    a = zip(b, a, (x, y) => clerp(x, y, 1));
    const next = zip(b, c, (x, y) => clerp(x, y, 1));
    d = zip(c, d, (x, y) => clerp(x, y, 1));
    c = next;
  }
  const values = zip4(a, b, c, d, (w, x, y, z) => {
    const [, k1, k2] = sampleToCubicBezier((t) => catmullRomWeightedDual(t, w, x, y, z, l1, l2, l3));
    return [k1, k2];
  });
  if (typeof b === 'number') return values;
  return [values.map((pair) => pair[0]), values.map((pair) => pair[1])];
}

const type = (name) => name === 'number' || name === 'angle'
  ? { spline: (a, b, knots) => spline(a, b, knots, name === 'angle'),
      measure: (a, b) => measure(a, b, name === 'angle') }
  : undefined;

export const easingType = type;
export const bezier = (fraction, knots) => bezierEase(fraction, ...knots);

export function automatic(frames, name) {
  const et = type(name);
  const n = frames.length;
  const intervals = frames.slice(0, -1).map((frame, i) => ({
    duration: frames[i + 1].time - frame.time,
    knots: frame.knots ?? autoKnots(frames[i - 1]?.value ?? frame.value,
      frame.value, frames[i + 1].value, frames[i + 2]?.value ?? frames[i + 1].value, name === 'angle'),
  }));
  const arcLengths = intervals.map(({ knots }, i) => {
    const sp = et.spline(frames[i].value, frames[i + 1].value, knots);
    if (et.measure(frames[i].value, frames[i + 1].value) === 0) return 0;
    return makeArcLengthMap((t1, t2) => et.measure(sp(null, t1), sp(null, t2))).length;
  });
  const speeds = frames.map((frame, i) => {
    if (frame.speed !== undefined) return frame.speed;
    const duration = (intervals[i - 1]?.duration ?? 0) + (intervals[i]?.duration ?? 0);
    const distance = (arcLengths[i - 1] ?? 0) + (arcLengths[i] ?? 0);
    return duration ? distance / duration : 0;
  });
  return [
    ...intervals.map(({ duration, knots }, i) => ({
      time: frames[i].time, value: frames[i].value, ease: 'bezier', knots,
      bezier: velocityToBezierEase(duration, arcLengths[i], speeds[i], speeds[i + 1], frames[i].out, frames[i + 1].in),
    })),
    { time: frames[n - 1].time, value: frames[n - 1].value },
  ];
}
