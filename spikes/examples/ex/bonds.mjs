// <Bonds>: covalent bonds as world-space sticks from the shared bond topology
// (explicit, else inferred). By default each bond splits at its midpoint into
// its two atoms' element colours; an explicit `color` draws one unsplit stroke.
// `select` keeps bonds whose endpoints match (`endpoints: 'both' | 'either'`).
import { use } from '@use-gpu/live';
import { coordinateBounds } from '@molgpu/table';
import { comp, toAtoms, resolve } from '@molgpu/select';
import { Structure, Bonds } from '@molgpu/viewer';
import { crambinStructure } from '../lib/crambin-structure.mjs';
import { withVariants } from '../lib/variants.mjs';

export const title = 'Bonds — sticks from bond topology';

const data = crambinStructure();
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
export const camera = { radius: extent * 1.5, target: bounds.center };

const cys = toAtoms(resolve(comp(['CYS']), data), data);

export const body = () => withVariants({
  element: () => use(Structure, { data, children: use(Bonds, { width: 0.25 }) }),
  flat: () => use(Structure, { data, children: use(Bonds, { width: 0.25, color: [0.7, 0.74, 0.82, 1] }) }),
  'cys only': () => use(Structure, { data, children: use(Bonds, { select: cys, width: 0.35 }) }),
});
