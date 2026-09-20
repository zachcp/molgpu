// Measure visible frame cadence only after the renderer has submitted work.
// GPU submissions are checked separately: rAF alone can time an idle scene.
export function startBench({ warmup = 60, sample = 180, label = '' } = {}) {
  const st = { label, warmup, sample, frames: [], stats: null, done: false };
  window.__bench = st;
  let n = 0, last = null, firstSubmit = null;
  const tick = (now) => {
    const submissions = window.__gpuProbe?.submissions ?? 0;
    if (!submissions || document.visibilityState !== 'visible') {
      last = null;
      requestAnimationFrame(tick);
      return;
    }
    if (last !== null) {
      n++;
      if (n === warmup) firstSubmit = submissions;
      if (n > warmup) st.frames.push(now - last);
    }
    last = now;
    if (st.frames.length >= sample) {
      const f = st.frames.slice().sort((a, b) => a - b);
      const at = (q) => f[Math.min(f.length - 1, Math.floor(q * f.length))];
      st.stats = {
        label, frames: f.length, submissions: submissions - firstSubmit,
        medianMs: +at(0.5).toFixed(2), p95Ms: +at(0.95).toFixed(2),
        minMs: +f[0].toFixed(2), maxMs: +f.at(-1).toFixed(2),
        medianFps: +(1000 / at(0.5)).toFixed(1),
      };
      st.done = true;
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return st;
}
