import { easingType, automatic, bezier } from './internal/upstream-interpolation.mjs';

const finite = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
};
const clone = (value) => typeof value === 'number' ? value : Array.from(value);

/** Named instants in one global clock. All times are seconds. */
export function createTimeline(beats) {
  if (!Array.isArray(beats) || !beats.length) throw new TypeError('beats must be a nonempty array');
  const byName = new Map();
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
    time: (name) => {
      if (!byName.has(name)) throw new RangeError(`unknown beat: ${name}`);
      return byName.get(name);
    },
  });
}

/** Build a reusable curve. Frames are {time, value, ease?}; ease describes the
 * segment starting at that frame. Values are numbers or equal-length vectors.
 * The last frame is the value at the exact endpoint. */
export function createCurve(frames, { type = 'number', automatic: auto = false, extrapolate = 'clamp' } = {}) {
  if (!Array.isArray(frames) || frames.length < 2) throw new TypeError('curve needs at least two frames');
  if (!['number', 'angle'].includes(type)) throw new TypeError(`unsupported curve type: ${type}`);
  if (!['clamp', 'loop'].includes(extrapolate)) throw new TypeError('extrapolate must be clamp or loop');
  let previous = -Infinity;
  let width;
  const input = frames.map((frame, i) => {
    finite(frame?.time, `frame ${i} time`);
    if (frame.time <= previous) throw new RangeError('frame times must strictly increase');
    previous = frame.time;
    const value = frame.value;
    if (typeof value === 'number') finite(value, `frame ${i} value`);
    else if (!Array.isArray(value) && !ArrayBuffer.isView(value)) throw new TypeError(`frame ${i} value must be a number or vector`);
    const shape = typeof value === 'number' ? 0 : value.length;
    if (typeof value !== 'number' && (!shape || Array.from(value).some((v) => !Number.isFinite(v))))
      throw new TypeError(`frame ${i} vector must be nonempty and finite`);
    if (width === undefined) width = shape;
    if (shape !== width || (shape !== 0 && shape < 1)) throw new TypeError('all frame values must have the same shape');
    if (frame.ease !== undefined && !['linear', 'cosine', 'hold', 'bezier'].includes(frame.ease)) throw new TypeError(`unsupported ease: ${frame.ease}`);
    if (frame.ease === 'bezier' && (!Array.isArray(frame.bezier) || frame.bezier.length !== 4 || frame.bezier.some((x) => !Number.isFinite(x)))) throw new TypeError('bezier ease needs four finite controls');
    return { time: frame.time, value: clone(value), ease: frame.ease, bezier: frame.bezier, knots: frame.knots };
  });
  if (auto && input.some((frame) => frame.ease || frame.knots)) throw new TypeError('automatic curves do not accept explicit easing or knots');
  const keyframes = auto ? automatic(input, type) : input;
  const et = easingType(type);
  const splines = keyframes.slice(0, -1).map((frame, i) => et.spline(frame.value, keyframes[i + 1].value, frame.knots));
  return Object.freeze({ unit: 'seconds', type, extrapolate, keyframes, splines });
}

/** Pure arbitrary-time sample. Repeated, reversed and out-of-range reads do not
 * depend on wall time or previous samples. Returned vectors are fresh values. */
export function sample(curve, time) {
  finite(time, 'sample time');
  const { keyframes, splines, extrapolate } = curve;
  const start = keyframes[0].time, end = keyframes.at(-1).time;
  const t = extrapolate === 'loop' && (time < start || time >= end)
    ? start + (((time - start) % (end - start)) + (end - start)) % (end - start)
    : Math.max(start, Math.min(end, time));
  if (t === end) return clone(keyframes.at(-1).value);
  let i = 0;
  while (i < splines.length - 1 && t >= keyframes[i + 1].time) i++;
  const frame = keyframes[i];
  const u = (t - frame.time) / (keyframes[i + 1].time - frame.time);
  const ease = frame.ease ?? 'linear';
  const eased = ease === 'hold' ? 0 : ease === 'cosine' ? (1 - Math.cos(Math.PI * u)) / 2
    : ease === 'bezier' ? bezier(u, frame.bezier) : u;
  const target = clone(frame.value);
  return splines[i](target, eased);
}
