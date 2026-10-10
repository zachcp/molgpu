// Pure CPU shape for <Tube>: per-run centripetal Catmull-Rom subdivision of a
// @molgpu/table trace, plus the RawLines segment codes that keep GPU tube
// extrusion (@use-gpu/wgsl/geometry/tube via LineLayer's `shaded` mode) from
// bridging one run into the next.
//
// Segment codes, as verified by the retired gallery's regression tests: a continuous
// strip is 1 (start), 3 (middle) ... 3, 2 (end) per vertex. A code of 0
// draws but extrudes each vertex pair as its own cone when shaded — the
// spiky artifact this avoids. A run needs at least 2 guide points to have a
// direction at all, so a single-residue run contributes no tube geometry.
// A namespace import, not a named one: Vite resolves @use-gpu/core's real ESM
// build (named export works directly), but plain `deno test` resolves its
// CJS build, whose named exports Node's static CJS/ESM interop cannot always
// see — falling back to the namespace's `default` (the full module.exports)
// covers that case too.
import * as useGpuCore from "@use-gpu/core";
import type { Trace } from "@molgpu/table";
import { count as countWork } from "../internal/instrumentation.ts";

const catmullRomWeighted: typeof useGpuCore.catmullRomWeighted =
  useGpuCore.catmullRomWeighted ??
    (useGpuCore as unknown as { default: typeof useGpuCore }).default
      .catmullRomWeighted;
function fail(message: string): never {
  throw new TypeError(`Tube geometry: ${message}`);
}

/** CPU tube geometry: RawLines positions and segment codes, plus each sample's residue row. */
export interface TubeGeometry {
  readonly count: number;
  readonly positions: Float32Array;
  readonly segments: Int32Array;
  readonly residue: Uint32Array;
}

const dist3 = (guide: Float32Array, i: number, j: number): number =>
  Math.hypot(
    guide[i] - guide[j],
    guide[i + 1] - guide[j + 1],
    guide[i + 2] - guide[j + 2],
  );

/**
 * Subdivide one run's guide points with @use-gpu/core's centripetal
 * (power=0.5) Catmull-Rom, which — unlike a uniform parameterization — stays
 * well-behaved when consecutive guide points are unevenly spaced. `at(k)`
 * clamps to this run's own ends, never a neighbor run's.
 */
function subdivideRun(
  guide: Float32Array,
  residue: Uint32Array,
  start: number,
  count: number,
  perSegment: number,
): { positions: Float32Array; residue: Uint32Array } {
  const at = (k: number): number => Math.min(count - 1, Math.max(0, k));
  const segs = count - 1;
  const n = segs * perSegment + 1;
  const positions = new Float32Array(n * 3);
  const sourceResidue = new Uint32Array(n);
  let w = 0;
  for (let s = 0; s < segs; s++) {
    const i0 = (start + at(s - 1)) * 3,
      i1 = (start + at(s)) * 3,
      i2 = (start + at(s + 1)) * 3,
      i3 = (start + at(s + 2)) * 3;
    const ab = dist3(guide, i0, i1),
      bc = dist3(guide, i1, i2),
      cd = dist3(guide, i2, i3);
    for (let j = 0; j < perSegment; j++) {
      const t = j / perSegment;
      for (let c = 0; c < 3; c++) {
        positions[w * 3 + c] = catmullRomWeighted(
          t,
          guide[i0 + c],
          guide[i1 + c],
          guide[i2 + c],
          guide[i3 + c],
          ab,
          bc,
          cd,
        );
      }
      sourceResidue[w] = residue[start + s];
      w++;
    }
  }
  for (let c = 0; c < 3; c++) {
    positions[w * 3 + c] = guide[(start + count - 1) * 3 + c];
  }
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
export function buildTubeGeometry(
  trace: Pick<Trace, "guide" | "residue" | "runs">,
  perSegment = 6,
): TubeGeometry {
  if (!Number.isInteger(perSegment) || perSegment < 1) {
    fail("perSegment must be a positive integer");
  }
  countWork("geometryBuilds", "tube:spline");
  const runs: { positions: Float32Array; residue: Uint32Array }[] = [];
  for (let r = 0; r < trace.runs.length - 1; r++) {
    const start = trace.runs[r], count = trace.runs[r + 1] - start;
    if (count >= 2) {
      runs.push(
        subdivideRun(trace.guide, trace.residue, start, count, perSegment),
      );
    }
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
    for (let k = 0; k < m; k++) {
      segments[offset + k] = k === 0 ? 1 : k === m - 1 ? 2 : 3;
    }
    offset += m;
  }
  return { count, positions, segments, residue };
}
