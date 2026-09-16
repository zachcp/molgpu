// Atom sources for S1. Real structures where available; synthetic globular clouds
// to reach counts no single PDB entry gives us.
import { parsePDBText } from './pdb.mjs';

const VDW = [1.7, 1.55, 1.52, 1.8, 1.8];   // C N O S P — plausible radius mix

export async function loadReal(id) {
  const text = await (await fetch(`./data/${id}.pdb`)).text();
  return parsePDBText(text);
}

/** Space-filling globular cloud: roughly protein-like density, so occlusion is realistic. */
export function synthetic(count, seed = 1) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  // pack at ~1 atom per 12 A^3, which is near real protein interior density
  const R = Math.cbrt((count * 12) / (4 / 3 * Math.PI));
  const x = new Float32Array(count), y = new Float32Array(count), z = new Float32Array(count);
  const radius = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // rejection-free: uniform in sphere via cube-root radius
    const u = rnd(), v = rnd(), w = rnd();
    const r = R * Math.cbrt(u), th = 2 * Math.PI * v, ph = Math.acos(2 * w - 1);
    x[i] = r * Math.sin(ph) * Math.cos(th);
    y[i] = r * Math.sin(ph) * Math.sin(th);
    z[i] = r * Math.cos(ph);
    radius[i] = VDW[(rnd() * VDW.length) | 0];
  }
  return { x, y, z, radius, count, extent: R * 2 };
}

/** Interleave into the vec3<f32> + f32 buffers the layers want. */
export function toBuffers(a) {
  const positions = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) {
    positions[i*3] = a.x[i]; positions[i*3+1] = a.y[i]; positions[i*3+2] = a.z[i];
  }
  let ex = a.extent;
  if (ex == null) {
    let mn = Infinity, mx = -Infinity;
    for (const arr of [a.x, a.y, a.z]) for (let i = 0; i < a.count; i++) {
      if (arr[i] < mn) mn = arr[i]; if (arr[i] > mx) mx = arr[i];
    }
    ex = mx - mn;
  }
  return { positions, radius: Float32Array.from(a.radius), count: a.count, extent: ex };
}
