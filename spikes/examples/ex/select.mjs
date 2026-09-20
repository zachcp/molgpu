// Selections as values. Click a button to swap selections live, or start
// with ?sel=all | carbon | noncarbon | sulfur | union.
//
// Each variant draws the SAME bound per-atom buffers; only the index buffer
// handed to `instances` differs. If a subset renders, selections cost one small
// u32 upload and nothing else — clicking between buttons never regenerates
// geometry, only re-evaluates the selection and re-binds `select`.
import { use, useState } from '@use-gpu/live';
import { Structure, computeBounds } from '../lib/structure.mjs';
import { Spacefill } from '../lib/spacefill.mjs';
import { Bonds } from '../lib/bonds.mjs';
import { crambinTable } from '../lib/table.mjs';
import { all, element, union, difference } from '../lib/select.mjs';

export const title = 'Selections — indirect draw';

const table = crambinTable();
const bounds = computeBounds(table);
export const camera = { radius: bounds.extent * 1.8, target: bounds.center };

// element indices: 0=C 1=N 2=O 3=S
const C = 0, N = 1, O = 2, S = 3;

const SELECTIONS = {
  all:        () => all(table),
  carbon:     () => element(table, C),
  noncarbon:  () => difference(all(table), element(table, C)),
  sulfur:     () => element(table, S),
  union:      () => union(element(table, N), element(table, O)),
};

// Bridges the DOM toolbar (built once, outside the live tree) to the live
// component's own state. Set on first render, read from button click handlers.
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

const SelectableStructure = ({ initial }) => {
  const [which, set] = useState(initial);
  setWhich = set;
  syncToolbar(which);

  const select = (SELECTIONS[which] ?? SELECTIONS.carbon)();
  document.getElementById('title').textContent =
    `Selections — ${select.key} (${select.indices.length}/${table.count} atoms)`;

  return use(Structure, { table, children: [
    use(Bonds, { width: 2 }),
    use(Spacefill, { scale: 0.45, select }),
  ] });
};

export function body() {
  const initial = new URLSearchParams(location.search).get('sel') ?? 'carbon';
  buildToolbar(initial in SELECTIONS ? initial : 'carbon');
  return use(SelectableStructure, { initial });
}
