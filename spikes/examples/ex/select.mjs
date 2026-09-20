// Gate 2, end to end: one @molgpu/select selection and one @molgpu/fields colour
// field drive a real <Spacefill> through <Structure>. The dim context is the
// whole structure in a flat colour; the highlighted subset is the resolved
// selection coloured by `byElement`, composed shader-side (no per-atom colour
// upload). Every button reselects; the title shows the selection's label, atom
// count, and library id.
//
//   all     every atom
//   sulfur  element(16)
//   cys     comp(['CYS']) resolved on residues, then toAtoms
//   near    within(5, comp(['CYS']))
//   shell   near \ cys
import { use, useState } from '@use-gpu/live';
import { coordinateBounds } from '@molgpu/table';
import { all, element, comp, within, difference, toAtoms, resolve, count } from '@molgpu/select';
import { byElement } from '@molgpu/fields';
import { Structure, Spacefill, BallAndStick } from '@molgpu/viewer';
import { crambinStructure } from '../lib/crambin-structure.mjs';

export const title = 'Selections × fields — Gate 2';

const data = crambinStructure();
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
export const camera = { radius: extent * 1.7, target: bounds.center };

// The byElement built-in field: element atomic number -> CPK colour, composed
// shader-side (molgpu-sept-urn.3).
const elementColor = byElement();

const SELECTIONS = {
  all:    (d) => resolve(all('atom'), d),
  sulfur: (d) => resolve(element(16), d),
  cys:    (d) => toAtoms(resolve(comp(['CYS']), d), d),
  near:   (d) => resolve(within(5, comp(['CYS'])), d),
  shell:  (d) => difference(resolve(within(5, comp(['CYS'])), d), toAtoms(resolve(comp(['CYS']), d), d)),
};

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
    `select × fields — ${sel.label}: ${count(sel)} ${sel.domain}s · id ${sel.id}`;

  return use(Structure, { data, children: [
    // dim whole-structure context in a flat colour (keeps the shared source)
    use(Spacefill, { scale: 0.35, color: [0.30, 0.33, 0.40, 1] }),
    // the resolved selection, coloured by the element field, as ball-and-stick
    use(BallAndStick, { select: sel, ball: 0.35, stick: 0.28, color: elementColor }),
  ] });
};

export function body() {
  const initial = new URLSearchParams(location.search).get('sel');
  const start = initial && initial in SELECTIONS ? initial : 'cys';
  buildToolbar(start);
  return use(SelectionView, { initial: start });
}
