// Cartoon tube from the residue trace table — GPU-extruded, no mesh building.
//   ?width=1.4&sides=10&taper=0.5&smooth=6   (smooth=1 shows the raw CA kinks)
import { use } from '@use-gpu/live';
import { Structure, computeBounds } from '../lib/structure.mjs';
import { Tube } from '../lib/tube.mjs';
import { crambinTable } from '../lib/table.mjs';

export const title = 'Tube — GPU-extruded cartoon';

const table = crambinTable();
const bounds = computeBounds(table);
export const camera = { radius: bounds.extent * 1.8, target: bounds.center };

export function body() {
  const q = new URLSearchParams(location.search);
  return use(Structure, { table, children:
    use(Tube, {
      width: parseFloat(q.get('width') ?? '1.4'),
      sides: parseInt(q.get('sides') ?? '10', 10),
      taper: parseFloat(q.get('taper') ?? '0.5'),
      smooth: parseInt(q.get('smooth') ?? '6', 10),
      join: q.get('join') ?? 'round',
    }) });
}
