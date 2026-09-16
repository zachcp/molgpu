// PointLayer — spacefill. The core pattern: wrap each attribute array in RawData
// to get a ShaderSource, then bind the sources to the layer. Nothing is
// materialised on the CPU per frame.
import { use } from '@use-gpu/live';
import { RawData, PointLayer } from '@use-gpu/workbench';
import { atoms } from '../mol.mjs';

export const title = 'PointLayer — spacefill';
export const camera = { radius: 34 };

export function body() {
  const a = atoms();
  // depth:1 puts `sizes` in world space. The ~296 factor converts Angstrom to
  // whatever units the layer wants; it depends on fov/viewport and should be
  // derived, not hardcoded (see the S1 finding).
  const sizes = Float32Array.from(a.radius, (r) => r * 296);

  return use(RawData, { data: a.positions, format: 'vec3<f32>', render: (positions) =>
         use(RawData, { data: sizes,       format: 'f32',       render: (sizeSrc) =>
         use(RawData, { data: a.colors,    format: 'vec4<f32>', render: (colorSrc) =>
    use(PointLayer, {
      positions, sizes: sizeSrc, colors: colorSrc, count: a.count,
      shape: 'circle',
      shaded: true,     // real sphere impostors, with per-fragment depth
      depth: 1,         // 1 = world-space radius, 0 = pixels
    })
  })})});
}
