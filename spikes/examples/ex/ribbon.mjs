// <Ribbon>: a flat, oriented cartoon ribbon — CPU-extruded cross-sections,
// wide through helix/sheet residues and narrow through coil (no strand
// arrowheads yet). `smooth` (samples per guide segment) rebuilds the spline;
// colour only updates a binding.
//
// Loads the real 1CRN BinaryCIF rather than lib/crambin-structure.mjs: the
// ribbon's width comes from secondary structure, which that fixture lacks (it
// would draw every residue as narrow coil).
import { use } from '@use-gpu/live';
import { coordinateBounds } from '@molgpu/table';
import { structureFromBcif } from '@molgpu/io';
import { Structure, Ribbon, Tube } from '@molgpu/viewer';
import { withVariants } from '../lib/variants.mjs';
import bcifUrl from '../../../packages/io/test/fixtures/1crn.bcif?url';

export const title = 'Ribbon — secondary-structure cartoon';

const data = await structureFromBcif(new Uint8Array(await (await fetch(bcifUrl)).arrayBuffer()));
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
export const camera = { radius: extent * 1.6, target: bounds.center };

export const body = () => withVariants({
  smooth: () => use(Structure, { data, children: use(Ribbon, {}) }),
  coarse: () => use(Structure, { data, children: use(Ribbon, { smooth: 1 }) }),
  'with tube': () => use(Structure, { data, children: [
    use(Ribbon, { color: [0.85, 0.55, 0.35, 1] }),
    use(Tube, { radius: 0.2, color: [0.45, 0.78, 0.95, 1] }),
  ] }),
});
