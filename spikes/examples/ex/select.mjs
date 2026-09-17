// Selections as values. ?sel=all | carbon | noncarbon | sulfur | union
//
// Each variant draws the SAME bound per-atom buffers; only the index buffer
// handed to `instances` differs. If a subset renders, selections cost one small
// u32 upload and nothing else.
import { use } from '@use-gpu/live';
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

export function body() {
  const which = new URLSearchParams(location.search).get('sel') ?? 'carbon';
  const sels = {
    all:        () => all(table),
    carbon:     () => element(table, C),
    noncarbon:  () => difference(all(table), element(table, C)),
    sulfur:     () => element(table, S),
    union:      () => union(element(table, N), element(table, O)),
  };
  const select = (sels[which] ?? sels.carbon)();
  document.getElementById('title').textContent =
    `Selections — ${select.key} (${select.indices.length}/${table.count} atoms)`;

  return use(Structure, { table, children: [
    use(Bonds, { width: 2 }),
    use(Spacefill, { scale: 0.45, select }),
  ] });
}
