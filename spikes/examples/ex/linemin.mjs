// Settle the LineLayer `segments` convention with UNAMBIGUOUS geometry.
//
// Three short "dumbbells" placed far apart in a triangle. A real segment is a
// SHORT stroke; a cross-pair connector is a LONG stroke between dumbbells. So
// the correct encoding shows exactly 3 short strokes and nothing else.
//
//   ?codes=1,2      per-vertex codes, repeated across the 3 pairs
//   ?w=3
import { use } from '@use-gpu/live';
import { RawData, LineLayer } from '@use-gpu/workbench';

export const title = 'LineLayer segments — dumbbell test';
export const camera = { radius: 26, pitch: 0.9 };

export function body() {
  const q = new URLSearchParams(location.search);
  const codes = (q.get('codes') ?? '1,2').split(',').map(Number);
  const w = parseFloat(q.get('w') ?? '3');

  // 3 dumbbells, each 2 A long, centres 9 A apart on a triangle
  const centres = [[-8, -5, 0], [8, -5, 0], [0, 7, 0]];
  const pts = [];
  for (const [cx, cy, cz] of centres) {
    pts.push(cx - 1, cy, cz);
    pts.push(cx + 1, cy, cz);
  }
  const positions = Float32Array.from(pts);
  const n = positions.length / 3;

  const segments = new Int32Array(n);
  for (let k = 0; k < n; k++) segments[k] = codes[k % codes.length];

  return use(RawData, { data: segments, format: 'i32', render: (segSrc) =>
         use(RawData, { data: positions, format: 'vec3<f32>', render: (posSrc) =>
    use(LineLayer, {
      positions: posSrc, segments: segSrc,
      color: [0.45, 0.85, 0.6, 1], width: w, join: 'round',
    })
  })});
}
