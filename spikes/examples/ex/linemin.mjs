// Isolation harness for LineLayer's `segments` convention.
//   ?seg=1,2,2,3   explicit per-vertex segment codes (bound as i32)
//   ?seg=scalar    the scalar `segment` prop instead of an array
// Points are laid out in a zigzag so breaks are obvious.
import { use } from '@use-gpu/live';
import { RawData, LineLayer } from '@use-gpu/workbench';

export const title = 'LineLayer isolation';
export const camera = { radius: 16 };

export function body() {
  const q = new URLSearchParams(location.search);
  const seg = q.get('seg') ?? '1,2,2,3';

  const n = seg === 'scalar' ? 4 : seg.split(',').length;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i*3]   = (i - (n - 1) / 2) * 3;
    positions[i*3+1] = i % 2 === 0 ? -2 : 2;
    positions[i*3+2] = 0;
  }

  const withColors = q.get('colors') === '1';
  const layer = (posSrc, segSrc, colSrc) => use(LineLayer, {
    positions: posSrc,
    ...(segSrc ? { segments: segSrc } : { segment: 0 }),
    ...(colSrc ? { colors: colSrc } : { color: [0.45, 0.85, 0.6, 1] }),
    width: 10, join: 'round',
  });

  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) colors.set([0.45, 0.85, 0.6, 1], i * 4);
  const wrapColors = (fn) => withColors
    ? use(RawData, { data: colors, format: 'vec4<f32>', render: fn })
    : fn(null);

  if (seg === 'scalar') {
    return wrapColors((c) =>
      use(RawData, { data: positions, format: 'vec3<f32>', render: (p) => layer(p, null, c) }));
  }
  // getSegment is declared i32 in the line vertex shader, so this MUST be i32.
  const segments = Int32Array.from(seg.split(',').map(Number));
  return wrapColors((c) =>
    use(RawData, { data: segments, format: 'i32', render: (s) =>
    use(RawData, { data: positions, format: 'vec3<f32>', render: (p) => layer(p, s, c) }) }));
}
