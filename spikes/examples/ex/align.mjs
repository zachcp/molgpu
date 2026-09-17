// Alignment test: ONE bond, two atoms, zoomed in.
// If <Spacefill> and <Bonds> agree on position, the stick passes through both
// ball centres. Any offset is immediately obvious at this scale.
//   ?b=0.3&w=0.5
import { use } from '@use-gpu/live';
import { Structure } from '../lib/structure.mjs';
import { Spacefill } from '../lib/spacefill.mjs';
import { Bonds } from '../lib/bonds.mjs';
import { crambinTable, BACKBONE } from '../lib/table.mjs';
import { where } from '../lib/select.mjs';

export const title = 'Alignment — one bond';

const full = crambinTable();

// Take residue 0's N and CA: a real, known ~1.46 A bond.
const i0 = [...full.backbone].findIndex((b) => b === BACKBONE.N);
const i1 = [...full.backbone].findIndex((b) => b === BACKBONE.CA);

// Build a 2-atom table so nothing else can be confused for the bond.
const table = (() => {
  const idx = [i0, i1];
  const count = 2;
  const positions = new Float32Array(6);
  const radius = new Float32Array(2);
  const colors = new Float32Array(8);
  const element = new Uint32Array(2);
  const residue = new Uint32Array(2);
  const backbone = new Uint32Array(2);
  idx.forEach((i, k) => {
    positions[k*3] = full.positions[i*3];
    positions[k*3+1] = full.positions[i*3+1];
    positions[k*3+2] = full.positions[i*3+2];
    radius[k] = full.radius[i];
    colors.set(full.colors.subarray(i*4, i*4+4), k*4);
    element[k] = full.element[i];
    residue[k] = 0;
    backbone[k] = full.backbone[i];
  });
  return { count, positions, radius, colors, element, residue, backbone,
           residues: { count: 1, name: ['X'], seq: Uint16Array.from([1]) } };
})();

const mid = [0,1,2].map((c) => (table.positions[c] + table.positions[3+c]) / 2);
const len = Math.hypot(
  table.positions[0]-table.positions[3],
  table.positions[1]-table.positions[4],
  table.positions[2]-table.positions[5]);

export const camera = { radius: 6, target: mid };

export function body() {
  const q = new URLSearchParams(location.search);
  document.getElementById('title').textContent =
    `Alignment — one bond, length ${len.toFixed(2)} A`;
  return use(Structure, { table, children: [
    use(Spacefill, { scale: parseFloat(q.get('b') ?? '0.3') }),
    use(Bonds, { width: parseFloat(q.get('w') ?? '0.5'), cutoff: 2.0 }),
  ] });
}
