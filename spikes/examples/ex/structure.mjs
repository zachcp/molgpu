// The ergonomics payoff: no data plumbing, no nesting pyramid in the scene code.
// <Structure> captures the table; representations pull it from context.
//
//   ?rep=ballstick | spacefill | bonds
import { use } from '@use-gpu/live';
import { Structure, computeBounds } from '../lib/structure.mjs';
import { Spacefill } from '../lib/spacefill.mjs';
import { Bonds } from '../lib/bonds.mjs';
import { BallAndStick } from '../lib/ballstick.mjs';
import { crambinTable } from '../lib/table.mjs';

export const title = '<Structure> — data intermediary';

const table = crambinTable();
const bounds = computeBounds(table);

// Framing derives from the structure's own bounds, not a magic number.
export const camera = { radius: bounds.extent * 1.5, target: bounds.center };

export function body() {
  // Default to spacefill: ball-and-stick of a whole 327-atom protein is
  // intrinsically cluttered, which is why real viewers reserve it for a selected
  // site (see ?ex=scene) and use spacefill or cartoon for the whole chain.
  const rep = new URLSearchParams(location.search).get('rep') ?? 'spacefill';

  if (rep === 'spacefill') return use(Structure, { table, children: use(Spacefill, { scale: 1 }) });
  if (rep === 'bonds') {
    const w = parseFloat(new URLSearchParams(location.search).get('w') ?? '0.22');
    return use(Structure, { table, children: use(Bonds, { width: w }) });
  }

  // Default: a coherent ball-and-stick. Both halves are shaded 3D geometry at
  // world-space sizes, so balls and sticks read as one object.
  return use(Structure, { table, children:
    use(BallAndStick, {
      ball: parseFloat(new URLSearchParams(location.search).get('b') ?? '0.3'),
      stick: parseFloat(new URLSearchParams(location.search).get('w') ?? '0.5'),
    }) });
}
