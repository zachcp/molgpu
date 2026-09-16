// LineLayer — one continuous polyline (a backbone trace).
// Same layer as lines.mjs, but a single run. The SCALAR `segment` prop is the
// reliable way to get continuity: it compiles the segment lookup as a shader
// constant instead of reading a per-vertex buffer.
// This is the shape a cartoon/ribbon path will take.
import { use } from '@use-gpu/live';
import { RawData, LineLayer } from '@use-gpu/workbench';
import { atoms } from '../mol.mjs';

export const title = 'LineLayer — backbone trace';
export const camera = { radius: 34 };

export function body() {
  const a = atoms();
  // Our compact crambin form has no atom names, so approximate a trace by
  // walking every 4th heavy atom — enough to show one continuous run.
  const idx = [];
  for (let i = 0; i < a.count; i += 4) idx.push(i);

  const positions = new Float32Array(idx.length * 3);
  idx.forEach((i, k) => {
    positions[k*3]   = a.positions[i*3];
    positions[k*3+1] = a.positions[i*3+1];
    positions[k*3+2] = a.positions[i*3+2];
  });

  return use(RawData, { data: positions, format: 'vec3<f32>', render: (posSrc) =>
    use(LineLayer, {
      positions: posSrc,
      segment: 0,                 // scalar => one continuous strip
      color: [0.45, 0.78, 0.95, 1], width: 6, join: 'round',
    })
  });
}
