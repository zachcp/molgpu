// Pure CPU shape for <Ribbon>: a flat, oriented cross-section extruded
// along each run's spline, built from the already-ported Mol* curve-segment
// kernel (0sj.1) fed by the shared trace (0sj.4) and its per-residue
// direction/secondary-structure data (0sj.2). No second polymer walk: this
// only reads trace.guide/trace.residue/trace.runs and ss.direction/kind/
// first/last, exactly as they come out of traceTable/secondaryStructureTrace.
//
// Scope, deliberate (confirmed with the project owner): flat ribbon only —
// helix/sheet get a wide cross-section, coil a narrow one, but there is no
// beta-strand arrowhead taper yet. That is real follow-up work, not
// something silently approximated here.
import {
  createCurveSegmentState,
  interpolateCurveSegment,
  interpolateSizes,
} from "@molgpu/geo";
import type { SecondaryStructureTrace, Trace } from "@molgpu/table";
import { count as countWork } from "./instrumentation.ts";

/** The trace columns the kernel reads. */
type TraceRuns = Pick<Trace, "guide" | "residue" | "runs">;
type TraceFrames = Pick<
  SecondaryStructureTrace,
  "direction" | "kind" | "first" | "last"
>;

type Vec3 = [number, number, number];

/** An indexed ribbon mesh, with each vertex's source residue row. */
export interface RibbonGeometry {
  readonly count: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly residue: Uint32Array;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

const RIBBON_WIDTH: Record<SecondaryStructureTrace["kind"][number], number> = {
  helix: 2.2,
  sheet: 2.2,
  coil: 0.7,
};
const RIBBON_HEIGHT = 0.35;

const clampIndex = (i: number, n: number): number =>
  Math.min(n - 1, Math.max(0, i));
const vec3At = (
  arr: ArrayLike<number>,
  i: number,
): Vec3 => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
const unit3 = ([x, y, z]: Vec3): Vec3 => {
  const l = Math.hypot(x, y, z);
  return l > 1e-9 ? [x / l, y / l, z / l] : [0, 0, 1];
};

/** One run's ribbon mesh, or null if the run has fewer than 2 guide points (no direction to extrude). */
function buildRun(
  trace: TraceRuns,
  ss: TraceFrames,
  start: number,
  count: number,
  linearSegments: number,
): {
  positions: number[];
  normals: number[];
  indices: number[];
  residue: number[];
} | null {
  if (count < 2) return null;
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [],
    residueOut: number[] = [];
  let prevRing: number[] | null = null;

  for (let k = 0; k < count - 1; k++) {
    const at = (offset: number): number =>
      start + clampIndex(k + offset, count);
    const controls = {
      p0: vec3At(trace.guide, at(-1)),
      p1: vec3At(trace.guide, at(0)),
      p2: vec3At(trace.guide, at(1)),
      p3: vec3At(trace.guide, at(2)),
      p4: vec3At(trace.guide, at(3)),
      d12: vec3At(ss.direction, at(0)),
      d23: vec3At(ss.direction, at(1)),
      secStrucFirst: !!ss.first[at(0)],
      secStrucLast: !!ss.last[at(0)],
    };
    const w0 = RIBBON_WIDTH[ss.kind[at(-1)]],
      w1 = RIBBON_WIDTH[ss.kind[at(0)]],
      w2 = RIBBON_WIDTH[ss.kind[at(1)]];

    const state = createCurveSegmentState(linearSegments);
    interpolateCurveSegment(state, controls, 0.5, 0.5);
    interpolateSizes(
      state,
      w0,
      w1,
      w2,
      RIBBON_HEIGHT,
      RIBBON_HEIGHT,
      RIBBON_HEIGHT,
      0.5,
    );

    const samples = linearSegments + 1;
    const beginAt = k === 0 ? 0 : 1; // sample 0 duplicates the previous segment's last sample
    for (let j = beginAt; j < samples; j++) {
      const [cx, cy, cz] = vec3At(state.curvePoints, j);
      const [nx, ny, nz] = vec3At(state.normalVectors, j);
      const [bx, by, bz] = vec3At(state.binormalVectors, j);
      const halfW = state.widthValues[j] / 2, halfH = state.heightValues[j] / 2;
      const ringBase = positions.length / 3;
      const sourceResidue = trace.residue[j === linearSegments ? at(1) : at(0)];
      for (const [sw, sh] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
        positions.push(
          cx + bx * sw * halfW + nx * sh * halfH,
          cy + by * sw * halfW + ny * sh * halfH,
          cz + bz * sw * halfW + nz * sh * halfH,
        );
        const [ux, uy, uz] = unit3([
          nx * sh + bx * sw,
          ny * sh + by * sw,
          nz * sh + bz * sw,
        ]);
        normals.push(ux, uy, uz);
        residueOut.push(sourceResidue);
      }
      if (prevRing) {
        for (let side = 0; side < 4; side++) {
          const a = prevRing[side],
            b = prevRing[(side + 1) % 4],
            c = ringBase + side,
            d = ringBase + (side + 1) % 4;
          indices.push(a, b, d, a, d, c);
        }
      }
      prevRing = [ringBase, ringBase + 1, ringBase + 2, ringBase + 3];
    }
  }
  return { positions, normals, indices, residue: residueOut };
}

/**
 * Build ribbon geometry from a @molgpu/table trace plus its
 * secondaryStructureTrace: concatenated, per-run flat cross-section
 * extrusion, never bridged across a run boundary. `linearSegments` is
 * samples per residue-to-residue segment (matching 0sj.1's curve-segment
 * state). Returns `{ count, positions, normals, indices, residue }`;
 * `count === 0` when nothing in the trace can form a ribbon.
 */
export function buildRibbonGeometry(
  trace: TraceRuns,
  ss: TraceFrames,
  linearSegments = 8,
): RibbonGeometry {
  if (!Number.isInteger(linearSegments) || linearSegments < 1) {
    throw new TypeError(
      "Ribbon geometry: linearSegments must be a positive integer",
    );
  }
  countWork("geometryBuilds", "ribbon:mesh");
  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [],
    residue: number[] = [];
  for (let r = 0; r < trace.runs.length - 1; r++) {
    const start = trace.runs[r], count = trace.runs[r + 1] - start;
    const run = buildRun(trace, ss, start, count, linearSegments);
    if (!run) continue;
    const offset = positions.length / 3;
    positions.push(...run.positions);
    normals.push(...run.normals);
    residue.push(...run.residue);
    for (const i of run.indices) indices.push(i + offset);
  }
  return {
    count: positions.length / 3,
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    residue: Uint32Array.from(residue),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}
