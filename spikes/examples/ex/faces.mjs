// FaceLayer — real triangle geometry from a CPUGeometry mesh.
// GeometryData uploads a CPUGeometry and yields a GPUGeometry for `mesh`.
//
// Three things to know:
//  1. makeSphereGeometry returns vec4 positions/normals (stride 4, NOT 3) and
//     u16 indices, and its `count` is the INDEX count (6912 here, 1225 verts).
//  2. It is a UNIT-DIAMETER sphere: coordinates span -0.5..0.5.
//  3. side:'both' is required — its winding is back-facing by use.gpu's
//     convention, so the default side:'front' culls the whole mesh and you get
//     a blank screen with no error.
import { use } from '@use-gpu/live';
import { GeometryData, FaceLayer, makeSphereGeometry } from '@use-gpu/workbench';

export const title = 'FaceLayer — mesh geometry';
export const camera = { radius: 3 };

export function body() {
  const sphere = makeSphereGeometry({ detail: [24, 48] });
  return use(GeometryData, {
    ...sphere,                      // count, topology, attributes, formats
    render: (mesh) => use(FaceLayer, {
      mesh,
      color: [0.62, 0.76, 0.93, 1],
      shaded: true,
      side: 'both',
    }),
  });
}
