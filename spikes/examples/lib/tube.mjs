// <Tube> — cartoon, the cheap half. Driven by the residue TRACE table.
//
// No mesh building: RawLines imports @use-gpu/wgsl/geometry/tube and sets
// LINE_STRIP_DETAIL = sides when shaded, so the extrusion happens on the GPU.
// Per-point width is a bound field, so tapering regenerates nothing.
//
// Sizing is finicky: depth:-1 (absolute/world) works with SMALL widths;
// width >= ~3 renders nothing at all, with no error.
import { use, useMemo } from '@use-gpu/live';
import { LineLayer, RawData } from '@use-gpu/workbench';
import { useStructure } from './structure.mjs';
import { traceTable, subdivideTrace } from './table.mjs';

export const Tube = ({ width = 1.4, sides = 8, color = [0.45, 0.78, 0.95, 1], taper = 0.35, smooth = 6, join = 'round' }) => {
  const { table } = useStructure();

  // Spline the CA path before extruding: straight-through extrusion spikes at
  // the sharp kinks between consecutive CAs.
  const trace = useMemo(() => subdivideTrace(traceTable(table), smooth), [table, smooth]);

  const widths = useMemo(() => {
    const w = new Float32Array(trace.count);
    for (let k = 0; k < trace.count; k++) {
      // taper>0 narrows the ends, the way a ribbon would at chain termini
      const u = trace.count > 1 ? k / (trace.count - 1) : 0.5;
      const ends = taper ? 1 - taper * Math.pow(Math.abs(u - 0.5) * 2, 3) : 1;
      // Floor the width: below roughly 1.1 world units the tube stops rendering
      // entirely (no error), so never let taper push it under that.
      w[k] = Math.max(1.1, width * ends);
    }
    return w;
  }, [trace, width, taper]);

  // Continuous run encoded per-vertex as 1 (start), 3 (middle)..., 2 (end).
  // The scalar `segment: 0` prop DRAWS, but when shaded it extrudes each pair as
  // a separate cone, which is the spiky artifact. See findings.
  const segments = useMemo(() => {
    const g = new Int32Array(trace.count);
    for (let k = 0; k < trace.count; k++) g[k] = k === 0 ? 1 : k === trace.count - 1 ? 2 : 3;
    return g;
  }, [trace]);

  // RawData COMPONENTS, not useRawSource hooks: the hook does not produce an
  // equivalent source for `segments` and the strip then ignores the codes.
  return use(RawData, { data: segments, format: 'i32', render: (segmentSource) =>
         use(RawData, { data: trace.guide, format: 'vec3<f32>', render: (positions) =>
         use(RawData, { data: widths, format: 'f32', render: (widthSource) =>
    use(LineLayer, {
      positions,
      segments: segmentSource,
      ...(taper === 0 ? { width } : { widths: widthSource }),
      shaded: true,
      sides,
      join,
      depth: -1,
      color,
    })
  })})});
};
