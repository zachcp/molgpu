// <Bonds> — a representation over derived connectivity.
// It needs per-endpoint arrays rather than per-atom ones, so it builds its own
// sources from the table. The structure still owns the table; this owns the
// derivation.
import { use, useMemo } from '@use-gpu/live';
import { LineLayer, useRawSource } from '@use-gpu/workbench';
import { useStructure } from './structure.mjs';
import { inferBonds } from './table.mjs';

export const Bonds = ({ width = 3, cutoff = 1.9 }) => {
  const { table } = useStructure();

  const built = useMemo(() => {
    const pairs = inferBonds(table, cutoff);
    const n = pairs.length;                 // one vertex per endpoint
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 4);
    const segments = new Int32Array(n);     // MUST be i32 (see examples README)
    for (let k = 0; k < n; k++) {
      const i = pairs[k];
      positions[k*3]   = table.positions[i*3];
      positions[k*3+1] = table.positions[i*3+1];
      positions[k*3+2] = table.positions[i*3+2];
      colors.set(table.colors.subarray(i*4, i*4 + 4), k*4);
      segments[k] = k % 2 === 0 ? 1 : 2;    // [1,2] repeated = discrete strokes
    }
    return { positions, colors, segments, count: n };
  }, [table, cutoff]);

  const positions = useRawSource(built.positions, 'vec3<f32>');
  const colors = useRawSource(built.colors, 'vec4<f32>');
  const segments = useRawSource(built.segments, 'i32');

  return use(LineLayer, { positions, colors, segments, width, join: 'round' });
};
