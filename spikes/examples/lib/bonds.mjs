// <Bonds> — a representation over derived connectivity.
//
// It needs per-ENDPOINT arrays (2 vertices per bond), a different cardinality
// than the per-atom columns, so it derives and uploads its own sources. The
// structure owns the table; the representation owns derivations at its own
// cardinality.
import { use, useMemo } from '@use-gpu/live';
import { LineLayer, RawData, useRawSource } from '@use-gpu/workbench';
import { useStructure } from './structure.mjs';
import { inferBonds } from './table.mjs';

// `shaded` + `sides` makes each bond a real extruded cylinder instead of a flat
// camera-facing strip, which is what a stick should look like. Each bond is its
// own [1,2] (start,end) run, so the per-pair extrusion is correct here.
export const Bonds = ({ width = 0.5, cutoff = 1.9, select = null, sides = 6, shaded = true }) => {
  const { table } = useStructure();

  const built = useMemo(() => {
    const pairs = inferBonds(table, cutoff);
    // A selection restricts bonds to those with BOTH endpoints selected, which
    // is what makes "show sidechains of these residues" look right.
    const keep = select ? new Set(select.indices) : null;
    const use_ = [];
    for (let b = 0; b < pairs.length; b += 2) {
      const i = pairs[b], j = pairs[b+1];
      if (!keep || (keep.has(i) && keep.has(j))) use_.push(i, j);
    }

    const n = use_.length;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 4);
    const segments = new Int32Array(n);     // MUST be i32
    for (let k = 0; k < n; k++) {
      const i = use_[k];
      positions[k*3]   = table.positions[i*3];
      positions[k*3+1] = table.positions[i*3+1];
      positions[k*3+2] = table.positions[i*3+2];
      colors.set(table.colors.subarray(i*4, i*4 + 4), k*4);
      segments[k] = k % 2 === 0 ? 1 : 2;    // [1,2] repeated = discrete strokes
    }
    // Never hand a zero-length array to useRawSource: the hooks below must run
    // unconditionally to keep hook order stable, so keep a 1-element floor and
    // render nothing instead.
    if (n === 0) {
      return { positions: new Float32Array(3), colors: new Float32Array(4),
               segments: new Int32Array(1), count: 0 };
    }
    return { positions, colors, segments, count: n };
  }, [table, cutoff, select?.key]);

  if (!built.count) return null;

  // NOTE: these are RawData COMPONENTS, not useRawSource hooks. The hook does not
  // appear to produce an equivalent source for `segments` — with the hook the
  // strip ignores the segment codes and draws the cross-pair connectors, with
  // identical data and identical props. See findings.
  return use(RawData, { data: built.segments, format: 'i32', render: (segments) =>
         use(RawData, { data: built.positions, format: 'vec3<f32>', render: (positions) =>
         use(RawData, { data: built.colors, format: 'vec4<f32>', render: (colors) =>
    use(LineLayer, {
      positions, colors, segments, width,
      join: 'round',
      ...(shaded ? { shaded: true, sides, depth: -1 } : {}),
    })
  })})});
};
