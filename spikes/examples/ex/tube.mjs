// <Tube>: the backbone as a GPU-extruded tube (LineLayer's shaded mode, no CPU
// mesh). `radius` is in Ångström and only updates a binding; `select` rebuilds
// the trace, and a selection that drops residues ends the run rather than
// bridging the gap — the `gapped` variant shows two separate tubes.
import { use } from '@use-gpu/live';
import { coordinateBounds } from '@molgpu/table';
import { where, resolve } from '@molgpu/select';
import { Structure, Tube } from '@molgpu/viewer';
import { crambinStructure } from '../lib/crambin-structure.mjs';
import { withVariants } from '../lib/variants.mjs';

export const title = 'Tube — backbone trace';

const data = crambinStructure();
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
export const camera = { radius: extent * 1.7, target: bounds.center };

const residue = data.topology.atoms.residue;
const gapped = resolve(where('atom', 'not residues 20-26', (d, i) => residue[i] < 19 || residue[i] > 25), data);

export const body = () => withVariants({
  thin: () => use(Structure, { data, children: use(Tube, { radius: 0.3 }) }),
  thick: () => use(Structure, { data, children: use(Tube, { radius: 0.9, color: [0.55, 0.85, 0.6, 1] }) }),
  gapped: () => use(Structure, { data, children: use(Tube, { select: gapped, radius: 0.5 }) }),
});
