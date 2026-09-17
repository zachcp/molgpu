// <Spacefill> — a representation. Pulls what it needs from <Structure> context.
// No data props: that is the point of the intermediary.
import { use, useMemo } from '@use-gpu/live';
import { PointLayer, useRawSource } from '@use-gpu/workbench';
import { useStructure } from './structure.mjs';

// At depth:1 PointLayer's `sizes` is world-space but not raw Angstrom. This
// factor depends on fov and viewport and MUST be derived in real code
// (bead molgpu-sept-jy6.5); hardcoded here because the harness camera is fixed.
const A_TO_SIZE = 296;

export const Spacefill = ({ scale = 1, select = null }) => {
  const { count, table, sources } = useStructure();

  // SELECTION STRATEGY: gather (compact), not indirect draw.
  //
  // The design we want is indirect: leave the full per-atom buffers bound and
  // hand the layer an index buffer via `instances`. RawQuads supports that, and
  // PointLayer forwards it — but it is BROKEN in use.gpu 0.20.0: the generated
  // `loadInstance` is emitted as `fn loadInstance(a: u32) -> void`, and `void`
  // is not a WGSL type, so the shader fails to compile. See
  // docs/findings/2026-09-17-selections-and-cartoon.md.
  //
  // So we compact instead: build subset buffers for the selection. Correct
  // today, but it costs uploads proportional to the selection whenever it
  // changes, which indirect draw would not.
  const packed = useMemo(() => {
    const idx = select ? select.indices : null;
    const n = idx ? idx.length : count;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 4);
    const sizes = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const i = idx ? idx[k] : k;
      positions[k*3]   = table.positions[i*3];
      positions[k*3+1] = table.positions[i*3+1];
      positions[k*3+2] = table.positions[i*3+2];
      colors.set(table.colors.subarray(i*4, i*4 + 4), k*4);
      sizes[k] = table.radius[i] * scale * A_TO_SIZE;
    }
    return { positions, colors, sizes, count: n };
    // memoized on the selection KEY, not the index array identity — which is
    // exactly why a Selection carries a key (CONCEPT 2).
  }, [table, scale, select?.key, count]);

  const positions = useRawSource(packed.positions, 'vec3<f32>');
  const colors = useRawSource(packed.colors, 'vec4<f32>');
  const sizes = useRawSource(packed.sizes, 'f32');

  return use(PointLayer, {
    positions, colors, sizes, count: packed.count,
    shape: 'circle', shaded: true, depth: 1,
  });
};
