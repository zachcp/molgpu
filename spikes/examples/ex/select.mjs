// @molgpu/select on real data. Every button resolves a SelectionQuery against
// the SAME crambin StructureData and highlights the resolved atoms over a dim
// copy of the whole protein. The title shows the selection's domain, atom count,
// and library-owned id — note the id changes with membership but never with the
// caller's label, and that residue/set/within queries all land back on atoms for
// rendering through the documented conversions.
//
//   all     every atom (all('atom'))
//   sulfur  element(16)
//   cys     comp(['CYS']) resolved on residues, then toAtoms (keeps a source map)
//   near    within(5, comp(['CYS']))            — position-dependent
//   shell   near \ cys                          — set difference of the two
import { use, useState } from '@use-gpu/live';
import { coordinateBounds } from '@molgpu/table';
import { all, element, comp, within, difference, toAtoms, resolve, count } from '@molgpu/select';
import { WorldSpacePointLayer } from '@molgpu/viewer';
import { ColumnSource } from '@molgpu/viewer/src/internal/column-source.mjs';
import { crambinStructure, elementColors } from '../lib/crambin-structure.mjs';

export const title = 'Selections — @molgpu/select';

const data = crambinStructure();
const colors = elementColors(data);
const radius = data.topology.atoms.radius;
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
export const camera = { radius: extent * 1.7, target: bounds.center };

// Each entry resolves to an ATOM-domain Selection against the passed dataset, so
// a residue query (`cys`) and set/within queries all render the same way.
const SELECTIONS = {
  all:    (d) => resolve(all('atom'), d),
  sulfur: (d) => resolve(element(16), d),
  cys:    (d) => toAtoms(resolve(comp(['CYS']), d), d),
  near:   (d) => resolve(within(5, comp(['CYS'])), d),
  shell:  (d) => difference(resolve(within(5, comp(['CYS'])), d), toAtoms(resolve(comp(['CYS']), d), d)),
};

/** Copy the selected atoms' columns into fresh packed arrays (the accepted
 *  correctness-first gather; indirect draw is a separate optimization). */
function gather(indices) {
  const n = indices.length;
  const positions = new Float32Array(n * 3);
  const colorCols = new Float32Array(n * 4);
  const radii = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = indices[k];
    positions[k * 3] = data.positions[i * 3];
    positions[k * 3 + 1] = data.positions[i * 3 + 1];
    positions[k * 3 + 2] = data.positions[i * 3 + 2];
    colorCols.set(colors.subarray(i * 4, i * 4 + 4), k * 4);
    radii[k] = radius[i];
  }
  return { positions, colors: colorCols, radii, count: n };
}

/** A spacefill layer over a pre-gathered column set. A flat `color` overrides
 *  the per-atom element colours (used to draw the dim context layer). */
function points({ positions, colors, radii, count: n }, { scale, color }) {
  if (!n) return null;
  const layer = (posSrc, colSrc) => use(WorldSpacePointLayer, {
    positions: posSrc, colors: color ? undefined : colSrc, radii, count: n,
    scale, color, shape: 'circle', shaded: true,
  });
  return use(ColumnSource, { data: positions, format: 'vec3<f32>', render: (posSrc) =>
    use(ColumnSource, { data: colors, format: 'vec4<f32>', render: (colSrc) => layer(posSrc, colSrc) }) });
}

// Context is the whole protein, gathered once and drawn small and dim.
const context = gather(Uint32Array.from({ length: data.topology.atoms.count }, (_, i) => i));

// DOM toolbar <-> live state bridge (built once, outside the live tree).
let setWhich = null;

function buildToolbar(initial) {
  const bar = document.getElementById('toolbar');
  bar.innerHTML = '';
  for (const key of Object.keys(SELECTIONS)) {
    const btn = document.createElement('button');
    btn.textContent = key;
    btn.setAttribute('aria-current', String(key === initial));
    btn.addEventListener('click', () => setWhich?.(key));
    bar.appendChild(btn);
  }
}

function syncToolbar(which) {
  for (const btn of document.querySelectorAll('#toolbar button')) {
    btn.setAttribute('aria-current', String(btn.textContent === which));
  }
}

const SelectionView = ({ initial }) => {
  const [which, set] = useState(initial);
  setWhich = set;
  syncToolbar(which);

  const sel = (SELECTIONS[which] ?? SELECTIONS.all)(data);
  document.getElementById('title').textContent =
    `@molgpu/select — ${sel.label}: ${count(sel)} ${sel.domain}s · id ${sel.id}`;

  return [
    // faint whole-protein context so the highlighted selection reads in place
    points(context, { scale: 0.35, color: [0.30, 0.33, 0.40, 1] }),
    // the resolved selection, element-coloured at full size
    points(gather(sel.indices), { scale: 1 }),
  ];
};

export function body() {
  const initial = new URLSearchParams(location.search).get('sel');
  const start = initial && initial in SELECTIONS ? initial : 'cys';
  buildToolbar(start);
  return use(SelectionView, { initial: start });
}
