// PointLayer — spacefill. The core pattern: wrap each attribute array in RawData
// to get a ShaderSource, then bind the sources to the layer. Nothing is
// materialised on the CPU per frame.
import { use } from '@use-gpu/live';
import { RawData } from '@use-gpu/workbench';
import { WorldSpacePointLayer } from '@molgpu/viewer';
import { atoms } from '../mol.mjs';

export const title = 'PointLayer — spacefill';
export const camera = { radius: 34 };

export function body() {
  const a = atoms();
  return use(RawData, { data: a.positions, format: 'vec3<f32>', render: (positions) =>
         use(RawData, { data: a.colors,    format: 'vec4<f32>', render: (colorSrc) =>
    use(WorldSpacePointLayer, {
      positions, colors: colorSrc, radii: a.radius, count: a.count,
      shape: 'circle',
      shaded: true,     // real sphere impostors, with per-fragment depth
    })
  })});
}
