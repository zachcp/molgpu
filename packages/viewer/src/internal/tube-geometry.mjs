// Pure CPU shape for <Tube>: per-run Catmull-Rom subdivision of a
// @molgpu/table trace, plus the RawLines segment codes that keep GPU tube
// extrusion (@use-gpu/wgsl/geometry/tube via LineLayer's `shaded` mode) from
// bridging one run into the next.
//
// Segment codes, as verified in spikes/examples/lib/tube.mjs: a continuous
// strip is 1 (start), 3 (middle) ... 3, 2 (end) per vertex. A code of 0
// draws but extrudes each vertex pair as its own cone when shaded — the
// spiky artifact this avoids. A run needs at least 2 guide points to have a
// direction at all, so a single-residue run contributes no tube geometry.
const fail = message => { throw new TypeError(`Tube geometry: ${message}`); };

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t * t2;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Subdivide one run's guide points; `at(k)` clamps to this run's own ends, never a neighbor run's. */
function subdivideRun(guide, residue, start, count, perSegment) {
  const at = k => Math.min(count - 1, Math.max(0, k));
  const segs = count - 1;
  const n = segs * perSegment + 1;
  const positions = new Float32Array(n * 3);
  const sourceResidue = new Uint32Array(n);
  let w = 0;
  for (let s = 0; s < segs; s++) {
    for (let j = 0; j < perSegment; j++) {
      const t = j / perSegment;
      for (let c = 0; c < 3; c++) {
        const p0 = guide[(start + at(s - 1)) * 3 + c], p1 = guide[(start + at(s)) * 3 + c];
        const p2 = guide[(start + at(s + 1)) * 3 + c], p3 = guide[(start + at(s + 2)) * 3 + c];
        positions[w * 3 + c] = catmullRom(p0, p1, p2, p3, t);
      }
      sourceResidue[w] = residue[start + s];
      w++;
    }
  }
  for (let c = 0; c < 3; c++) positions[w * 3 + c] = guide[(start + count - 1) * 3 + c];
  sourceResidue[w] = residue[start + count - 1];
  return { positions, residue: sourceResidue };
}

/**
 * Build tube geometry from a @molgpu/table trace: concatenated, per-run
 * subdivided positions, RawLines segment codes, and a sample-to-residue
 * mapping. Runs of fewer than 2 guide points are dropped (no direction to
 * extrude). Returns `{ count, positions, segments, residue }`; `count === 0`
 * when nothing in the trace can form a tube.
 */
export function buildTubeGeometry(trace, perSegment = 6) {
  if (!Number.isInteger(perSegment) || perSegment < 1) fail('perSegment must be a positive integer');
  const runs = [];
  for (let r = 0; r < trace.runs.length - 1; r++) {
    const start = trace.runs[r], count = trace.runs[r + 1] - start;
    if (count >= 2) runs.push(subdivideRun(trace.guide, trace.residue, start, count, perSegment));
  }
  const count = runs.reduce((sum, run) => sum + run.residue.length, 0);
  const positions = new Float32Array(count * 3);
  const segments = new Int32Array(count);
  const residue = new Uint32Array(count);
  let offset = 0;
  for (const run of runs) {
    const m = run.residue.length;
    positions.set(run.positions, offset * 3);
    residue.set(run.residue, offset);
    for (let k = 0; k < m; k++) segments[offset + k] = k === 0 ? 1 : k === m - 1 ? 2 : 3;
    offset += m;
  }
  return { count, positions, segments, residue };
}
