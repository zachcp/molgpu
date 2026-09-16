// <Spacefill> — a representation. Pulls what it needs from <Structure> context.
// No data props: that is the whole point of the intermediary.
import { use, useMemo } from '@use-gpu/live';
import { PointLayer, useRawSource } from '@use-gpu/workbench';
import { useStructure } from './structure.mjs';

// At depth:1 PointLayer's `sizes` is world-space but not raw Angstrom. This
// factor depends on fov and viewport and MUST be derived in real code
// (bead molgpu-sept-jy6.5); hardcoded here because the harness camera is fixed.
const A_TO_SIZE = 296;

export const Spacefill = ({ scale = 1 }) => {
  const { count, table, sources } = useStructure();

  // A DERIVED field. Note the cost: `radius` is already on the GPU, but scaling
  // it needs a second CPU array and a second upload, because there is no
  // shader-side expression layer yet. This is exactly what CONCEPT 3 (fields
  // compiling to WGSL) exists to remove.
  const sizes = useMemo(
    () => Float32Array.from(table.radius, (r) => r * scale * A_TO_SIZE),
    [table.radius, scale],
  );
  const sizeSource = useRawSource(sizes, 'f32');

  return use(PointLayer, {
    positions: sources.positions,
    colors: sources.colors,
    sizes: sizeSource,
    count,
    shape: 'circle',
    shaded: true,
    depth: 1,
  });
};
