// Tiny molecule source so the examples show real data, not abstract shapes.
// Crambin (PDB 1CRN) coordinates are inlined in crambin.mjs.
import { XYZ, EL, VDW } from './crambin.mjs';

const COLOR = [                     // CPK-ish, by element index
  [0.78, 0.80, 0.84, 1],             // C
  [0.35, 0.50, 0.92, 1],             // N
  [0.90, 0.36, 0.33, 1],             // O
  [0.95, 0.80, 0.30, 1],             // S
  [0.95, 0.55, 0.25, 1],             // P
];

export function atoms() {
  const n = EL.length;
  const positions = new Float32Array(n * 3);
  const radius = new Float32Array(n);
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    positions[i*3]   = XYZ[i*3]   / 100;
    positions[i*3+1] = XYZ[i*3+1] / 100;
    positions[i*3+2] = XYZ[i*3+2] / 100;
    radius[i] = VDW[EL[i]];
    const c = COLOR[EL[i]] ?? COLOR[0];
    colors.set(c, i * 4);
  }
  // Centre on the centroid so the default camera (target [0,0,0]) frames it.
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += positions[i*3]; cy += positions[i*3+1]; cz += positions[i*3+2]; }
  cx /= n; cy /= n; cz /= n;
  for (let i = 0; i < n; i++) {
    positions[i*3] -= cx; positions[i*3+1] -= cy; positions[i*3+2] -= cz;
  }
  return { positions, radius, colors, count: n };
}

/** Naive distance-based bonds. Fine for a spike; a real build infers these properly. */
export function bonds({ positions, count }, cutoff = 1.9) {
  const pairs = [];
  const c2 = cutoff * cutoff;
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    const dx = positions[i*3] - positions[j*3];
    const dy = positions[i*3+1] - positions[j*3+1];
    const dz = positions[i*3+2] - positions[j*3+2];
    const d2 = dx*dx + dy*dy + dz*dz;
    if (d2 < c2) pairs.push(i, j);
  }
  return Uint32Array.from(pairs);
}
