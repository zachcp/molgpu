// <Surface>: the solvent-excluded molecular surface (Mol*'s field kernel via
// @molgpu/io, marching cubes via @molgpu/geo, drawn with FaceLayer). Only
// `probeRadius`/`resolution` rebuild the mesh (through useGeometryJob, so the
// latest request wins); colour/opacity/material are bindings.
import { use } from '@use-gpu/live';
import { coordinateBounds } from '@molgpu/table';
import { byElement } from '@molgpu/fields';
import { Structure, Surface, BallAndStick, AmbientLight, DirectionalLight } from '@molgpu/viewer';
import { crambinStructure } from '../lib/crambin-structure.mjs';
import { withVariants } from '../lib/variants.mjs';

export const title = 'Surface — solvent-excluded';

const data = crambinStructure();
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
export const camera = { radius: extent * 1.7, target: bounds.center };
// Order-independent transparency, so the translucent glass surface (opacity
// < 1 draws in transparent mode) composites correctly over the atoms inside.
export const pass = { oit: true };

// On top of the harness's ambient + key light: a cool fill from the opposite
// side, a warm rim from behind, and a little more ambient, so the concave
// pockets of a surface don't fall to black.
const lights = [
  use(AmbientLight, { intensity: 0.1 }),
  use(DirectionalLight, { direction: [1.2, 0.6, 1], color: [0.8, 0.88, 1], intensity: 0.4 }),
  use(DirectionalLight, { direction: [0.3, 1, -2], color: [1, 0.92, 0.8], intensity: 0.35 }),
];
const lit = (...children) => use(Structure, { data, children: [...lights, ...children] });

export const body = () => withVariants({
  opaque: () => lit(use(Surface, { color: [0.75, 0.78, 0.86, 1] })),
  'no probe': () => lit(use(Surface, { probeRadius: 0, color: [0.86, 0.78, 0.7, 1] })),
  glass: () => lit(
    use(BallAndStick, { ball: 0.25, stick: 0.18, color: byElement() }),
    use(Surface, { color: [0.55, 0.72, 0.98, 1], opacity: 0.3 }),
  ),
  // A small probe and a fine grid keep every atom's bump and crevice, and a
  // fully rough, non-metallic stone albedo reads as porous volcanic rock.
  pumice: () => lit(use(Surface, {
    probeRadius: 0.5, resolution: 0.35, color: [0.52, 0.5, 0.47, 1],
    material: { type: 'pbr', roughness: 1, metalness: 0 },
  })),
  // Neon green: a dark body with a strong emissive term, which adds light the
  // scene lights don't, so the surface glows even on its shadowed side. (The
  // emissive alpha is 0: the emissive vec4 is added to the output, alpha too.)
  glow: () => lit(use(Surface, {
    color: [0.12, 0.6, 0.22, 1],
    material: { type: 'pbr', roughness: 0.3, emissive: [0.04, 0.4, 0.12, 0] },
  })),
});
