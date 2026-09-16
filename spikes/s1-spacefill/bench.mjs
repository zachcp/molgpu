// Frame-time sampler. Results land on window.__bench so they can be read
// programmatically instead of squinting at a HUD.
export function startBench({ warmup = 60, sample = 180, label = '' } = {}) {
  const st = { label, warmup, sample, frames: [], stats: null, done: false };
  window.__bench = st;
  let n = 0, last = performance.now();
  const tick = () => {
    const now = performance.now();
    const dt = now - last; last = now;
    n++;
    if (n > warmup) st.frames.push(dt);
    if (st.frames.length >= sample) {
      const f = st.frames.slice().sort((a, b) => a - b);
      const at = (q) => f[Math.min(f.length - 1, Math.floor(q * f.length))];
      st.stats = {
        label, frames: f.length,
        medianMs: +at(0.5).toFixed(2), p95Ms: +at(0.95).toFixed(2),
        minMs: +f[0].toFixed(2), maxMs: +f[f.length-1].toFixed(2),
        medianFps: +(1000 / at(0.5)).toFixed(1),
      };
      st.done = true;
      return;                       // stop sampling
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return st;
}
