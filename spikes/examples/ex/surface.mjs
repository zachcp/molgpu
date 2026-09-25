// <Surface>: the solvent-excluded molecular surface (Mol*'s field kernel via
// @molgpu/io, marching cubes via @molgpu/geo, drawn with FaceLayer). Only
// `probeRadius`/`resolution` rebuild the mesh (through useGeometryJob, so the
// latest request wins); colour/opacity are bindings.
import { use } from '@use-gpu/live';
import { coordinateBounds } from '@molgpu/table';
import { byElement } from '@molgpu/fields';
import { Structure, Surface, BallAndStick } from '@molgpu/viewer';
import { crambinStructure } from '../lib/crambin-structure.mjs';
import { withVariants } from '../lib/variants.mjs';

export const title = 'Surface — solvent-excluded';

const data = crambinStructure();
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
export const camera = { radius: extent * 1.7, target: bounds.center };

export const body = () => withVariants({
  opaque: () => use(Structure, { data, children: use(Surface, { color: [0.75, 0.78, 0.86, 1] }) }),
  'no probe': () => use(Structure, { data, children: use(Surface, { probeRadius: 0, color: [0.86, 0.78, 0.7, 1] }) }),
  glass: () => use(Structure, { data, children: [
    use(BallAndStick, { ball: 0.25, stick: 0.18, color: byElement() }),
    use(Surface, { color: [0.55, 0.72, 0.98, 0.3] }),
  ] }),
});
