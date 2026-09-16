// The columnar atom table — the shape @molgpu/table would own.
// Plain typed arrays, no GPU and no Mol* types. Everything downstream is a
// function of this.
import { XYZ, EL, VDW } from '../crambin.mjs';

export const ELEMENT_COLOR = [
  [0.78, 0.80, 0.84, 1],   // C
  [0.35, 0.50, 0.92, 1],   // N
  [0.90, 0.36, 0.33, 1],   // O
  [0.95, 0.80, 0.30, 1],   // S
  [0.95, 0.55, 0.25, 1],   // P
];

/** @returns {{count:number, positions:Float32Array, radius:Float32Array, colors:Float32Array, element:Uint32Array}} */
export function crambinTable() {
  const count = EL.length;
  const positions = new Float32Array(count * 3);
  const radius = new Float32Array(count);
  const colors = new Float32Array(count * 4);
  const element = new Uint32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i*3]   = XYZ[i*3]   / 100;
    positions[i*3+1] = XYZ[i*3+1] / 100;
    positions[i*3+2] = XYZ[i*3+2] / 100;
    radius[i] = VDW[EL[i]];
    colors.set(ELEMENT_COLOR[EL[i]] ?? ELEMENT_COLOR[0], i * 4);
    element[i] = EL[i];
  }
  return { count, positions, radius, colors, element };
}

/** Naive distance-based bonds, as flat [i,j] pairs. A real build infers these properly. */
export function inferBonds(table, cutoff = 1.9) {
  const { positions, count } = table;
  const out = [];
  const c2 = cutoff * cutoff;
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    const dx = positions[i*3] - positions[j*3];
    const dy = positions[i*3+1] - positions[j*3+1];
    const dz = positions[i*3+2] - positions[j*3+2];
    if (dx*dx + dy*dy + dz*dz < c2) out.push(i, j);
  }
  return Uint32Array.from(out);
}
