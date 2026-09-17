// The ergonomics payoff: no RawData, no data plumbing, no nesting pyramid.
// <Structure> captures the table; representations pull it from context.
//
//   ?rep=both | spacefill | bonds
import { use } from '@use-gpu/live';
import { Structure, computeBounds } from '../lib/structure.mjs';
import { Spacefill } from '../lib/spacefill.mjs';
import { Bonds } from '../lib/bonds.mjs';
import { crambinTable } from '../lib/table.mjs';

export const title = '<Structure> — data intermediary';

const table = crambinTable();
const bounds = computeBounds(table);

// Framing derives from the structure's own bounds, not a magic number.
export const camera = { radius: bounds.extent * 1.8, target: bounds.center };

export function body() {
  const q = new URLSearchParams(location.search);
  const rep = q.get('rep') ?? 'both';
  return use(Structure, { table, children: [
    (rep === 'both' || rep === 'spacefill') && use(Spacefill, { scale: 0.4 }),
    (rep === 'both' || rep === 'bonds') && use(Bonds, { width: parseFloat(q.get('w') ?? '3'), shaded: q.get('shaded') === '1' }),
  ].filter(Boolean) });
}
