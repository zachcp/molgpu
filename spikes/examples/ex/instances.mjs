// Minimal upstream repro for use.gpu 0.20.0's RawQuads `instances` codegen.
// This intentionally fails shader compilation; keep it out of the navigation
// and regular screenshot suite. Open `?ex=instances` in a fresh tab to inspect
// the generated `loadInstance(...)->void` diagnostic.
import { use } from '@use-gpu/live';
import { PointLayer, RawData } from '@use-gpu/workbench';

export const title = 'UPSTREAM REPRO — PointLayer instances';
export const camera = { radius: 8 };

const positions = Float32Array.from([-2, 0, 0, 2, 0, 0]);
const instances = Uint32Array.from([1, 0]);

export function body() {
  return use(RawData, { data: positions, format: 'vec3<f32>', render: (positionSource) =>
    use(RawData, { data: instances, format: 'u32', render: (instanceSource) =>
      use(PointLayer, {
        positions: positionSource, instances: instanceSource, count: 2,
        size: 48, color: [0.9, 0.5, 0.2, 1], shape: 'circle',
      })
    })
  });
}
