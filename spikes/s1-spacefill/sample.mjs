import { EaseTypes } from '@use-gpu/workbench/mjs/animate/interpolate.mjs';

// A deliberately small spike: explicit seconds, linear color keyframes, clamped
// endpoints. Uses upstream interpolation without Animate's wall clock.
export function makeSampler(keys) {
  if (keys.length < 2 || keys.some((k, i) => !Number.isFinite(k.time) ||
      (i && k.time <= keys[i - 1].time))) throw new Error('Expected increasing finite keyframe times');
  const splines = keys.slice(0, -1).map((k, i) => EaseTypes.number.spline(k.value, keys[i + 1].value));
  return t => {
    if (!Number.isFinite(t)) throw new Error('Time must be finite');
    let i = 0;
    while (i < keys.length - 2 && t >= keys[i + 1].time) i++;
    const a = keys[i], b = keys[i + 1];
    const u = Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time)));
    return splines[i]([...a.value], u);
  };
}
