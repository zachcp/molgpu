// LineLayer — bonds as discrete segments.
//
// Two things to know, both found the hard way:
//  1. `segments` MUST be bound as i32. The line vertex shader declares
//     getSegment as i32; binding f32 fails WGSL validation and draws nothing.
//  2. Per-vertex codes [1,2] repeated give one discrete stroke per PAIR.
//     (For a single continuous run use the scalar `segment` prop — see trace.mjs.)
import { use } from '@use-gpu/live';
import { RawData, LineLayer } from '@use-gpu/workbench';
import { atoms, bonds } from '../mol.mjs';

export const title = 'LineLayer — bonds';
export const camera = { radius: 34 };

export function body() {
  const a = atoms();
  const pairs = bonds(a);          // flat [i0,j0, i1,j1, ...]
  const n = pairs.length;          // one vertex per bond endpoint

  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 4);
  const segments = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const i = pairs[k];
    positions[k*3]   = a.positions[i*3];
    positions[k*3+1] = a.positions[i*3+1];
    positions[k*3+2] = a.positions[i*3+2];
    colors.set(a.colors.subarray(i*4, i*4 + 4), k*4);
    segments[k] = k % 2 === 0 ? 1 : 2;      // start, end, start, end, ...
  }

  return use(RawData, { data: segments,  format: 'i32',       render: (segSrc) =>
         use(RawData, { data: positions, format: 'vec3<f32>', render: (posSrc) =>
         use(RawData, { data: colors,    format: 'vec4<f32>', render: (colSrc) =>
    use(LineLayer, {
      positions: posSrc, colors: colSrc, segments: segSrc,
      width: 3, join: 'round',
    })
  })})});
}
