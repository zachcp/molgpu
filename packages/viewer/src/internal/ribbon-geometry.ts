// Pure CPU shape for <Ribbon>: an oriented cross-section extruded
// along each run's spline, built from the already-ported Mol* curve-segment
// kernel (0sj.1) fed by the shared trace (0sj.4) and its per-residue
// direction/secondary-structure data (0sj.2). No second polymer walk: this
// only reads trace.guide/trace.residue/trace.runs and ss.direction/kind/
// first/last, exactly as they come out of traceTable/secondaryStructureTrace.
//
// This remains a compact ribbon representation: sheet ends get a widened
// shoulder and pointed terminus, while helix axes and coil profiles are not
// fitted as in a full molecular-cartoon implementation.
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

// Mol* 5.11's default cartoon uses sizeFactor 0.2 and aspectRatio 5.
// Here dimensions are full diameters: width follows the binormal, height
// follows the normal. Keeping that axis order makes sheets read as sheets.
const RIBBON_WIDTH: Record<SecondaryStructureTrace["kind"][number], number> = {
  helix: 0.4,
  sheet: 0.4,
  coil: 0.4,
};
const RIBBON_HEIGHT: Record<SecondaryStructureTrace["kind"][number], number> = {
  helix: 2,
  sheet: 2,
  coil: 0.4,
};
const RING_SIDES = 16;
const SHEET_ARROW_SHOULDER = 1.5;

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
const dot3 = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Mol*-inspired sheet control points and matched directions over one run. */
function runFrames(
  trace: TraceRuns,
  ss: TraceFrames,
  start: number,
  count: number,
): { guides: Vec3[]; directions: Vec3[] } {
  const guides = Array.from(
    { length: count },
    (_, k) => vec3At(trace.guide, start + k),
  );
  const raw = Array.from(
    { length: count },
    (_, k) => unit3(vec3At(ss.direction, start + k)),
  );
  for (let k = 1; k < count; k++) {
    if (dot3(raw[k - 1], raw[k]) < 0) {
      raw[k] = [-raw[k][0], -raw[k][1], -raw[k][2]];
    }
  }
  const directions = raw.map((current, k) => {
    const prev = raw[Math.max(0, k - 1)];
    const next = raw[Math.min(count - 1, k + 1)];
    return unit3([
      (prev[0] + 2 * current[0] + next[0]) / 4,
      (prev[1] + 2 * current[1] + next[1]) / 4,
      (prev[2] + 2 * current[2] + next[2]) / 4,
    ]);
  });
  const smoothGuides = guides.map((current, k) => {
    if (ss.kind[start + k] !== "sheet") return current;
    const prev = guides[Math.max(0, k - 1)];
    const next = guides[Math.min(count - 1, k + 1)];
    return [0, 1, 2].map((axis) =>
      (prev[axis] + 2 * current[axis] + next[axis]) / 4
    ) as Vec3;
  });
  return { guides: smoothGuides, directions };
}

function pushOutwardTriangle(
  indices: number[],
  positions: number[],
  normals: number[],
  a: number,
  b: number,
  c: number,
): void {
  const ax = positions[a * 3],
    ay = positions[a * 3 + 1],
    az = positions[a * 3 + 2];
  const abx = positions[b * 3] - ax,
    aby = positions[b * 3 + 1] - ay,
    abz = positions[b * 3 + 2] - az;
  const acx = positions[c * 3] - ax,
    acy = positions[c * 3 + 1] - ay,
    acz = positions[c * 3 + 2] - az;
  const faceX = aby * acz - abz * acy;
  const faceY = abz * acx - abx * acz;
  const faceZ = abx * acy - aby * acx;
  const normalX = normals[a * 3] + normals[b * 3] + normals[c * 3];
  const normalY = normals[a * 3 + 1] + normals[b * 3 + 1] +
    normals[c * 3 + 1];
  const normalZ = normals[a * 3 + 2] + normals[b * 3 + 2] +
    normals[c * 3 + 2];
  if (faceX * normalX + faceY * normalY + faceZ * normalZ < 0) {
    indices.push(a, c, b);
  } else indices.push(a, b, c);
}

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
  const { guides, directions } = runFrames(trace, ss, start, count);
  let prevRing: number[] | null = null;
  let firstRing: number[] | null = null;
  let firstTangent: Vec3 = [0, 0, 1];
  let lastTangent: Vec3 = [0, 0, 1];

  const cap = (ring: number[], tangent: Vec3, reverse: boolean): void => {
    const normal: Vec3 = reverse
      ? [-tangent[0], -tangent[1], -tangent[2]]
      : tangent;
    const center = positions.length / 3;
    const p = ring.reduce<Vec3>((sum, vertex) => [
      sum[0] + positions[vertex * 3] / RING_SIDES,
      sum[1] + positions[vertex * 3 + 1] / RING_SIDES,
      sum[2] + positions[vertex * 3 + 2] / RING_SIDES,
    ], [0, 0, 0]);
    positions.push(...p);
    normals.push(...normal);
    residueOut.push(residueOut[ring[0]]);
    const capRing = ring.map((vertex) => {
      const i = positions.length / 3;
      positions.push(...vec3At(positions, vertex));
      normals.push(...normal);
      residueOut.push(residueOut[vertex]);
      return i;
    });
    for (let side = 0; side < RING_SIDES; side++) {
      pushOutwardTriangle(
        indices,
        positions,
        normals,
        center,
        capRing[side],
        capRing[(side + 1) % RING_SIDES],
      );
    }
  };

  for (let k = 0; k < count - 1; k++) {
    const at = (offset: number): number =>
      start + clampIndex(k + offset, count);
    const local = (offset: number): number => clampIndex(k + offset, count);
    const controls = {
      p0: guides[local(-1)],
      p1: guides[local(0)],
      p2: guides[local(1)],
      p3: guides[local(2)],
      p4: guides[local(3)],
      d12: directions[local(0)],
      d23: directions[local(1)],
      secStrucFirst: !!ss.first[at(0)],
      secStrucLast: !!ss.last[at(1)],
    };
    const w0 = RIBBON_WIDTH[ss.kind[at(0)]],
      w1 = RIBBON_WIDTH[ss.kind[at(1)]],
      w2 = RIBBON_WIDTH[ss.kind[at(2)]];
    const h0 = RIBBON_HEIGHT[ss.kind[at(0)]],
      h1 = RIBBON_HEIGHT[ss.kind[at(1)]],
      h2 = RIBBON_HEIGHT[ss.kind[at(2)]];

    const state = createCurveSegmentState(linearSegments);
    const tension = ss.kind[at(0)] === "helix" || ss.kind[at(1)] === "helix"
      ? 0.9
      : 0.5;
    // Shift zero samples the Catmull-Rom segment from residue k to k+1.
    // The half-shifted Mol* iterator is centered on a different residue and
    // requires its own endpoint clipping; using it here skipped/misplaced the
    // run ends and left repeated, degenerate rings at the termini.
    interpolateCurveSegment(state, controls, tension, 0);
    interpolateSizes(
      state,
      w0,
      w1,
      w2,
      h0,
      h1,
      h2,
      0,
    );
    if (ss.kind[at(0)] !== ss.kind[at(1)]) {
      for (let j = 0; j <= linearSegments; j++) {
        const t = j / linearSegments;
        const eased = t * t * (3 - 2 * t);
        state.widthValues[j] = w0 + (w1 - w0) * eased;
        state.heightValues[j] = h0 + (h1 - h0) * eased;
      }
    }

    const samples = linearSegments + 1;
    const beginAt = k === 0 ? 0 : 1; // sample 0 duplicates the previous segment's last sample
    for (let j = beginAt; j < samples; j++) {
      const [cx, cy, cz] = vec3At(state.curvePoints, j);
      const [tx, ty, tz] = vec3At(state.tangentVectors, j);
      const [rawNx, rawNy, rawNz] = vec3At(state.normalVectors, j);
      const alongTangent = tx * rawNx + ty * rawNy + tz * rawNz;
      const [nx, ny, nz] = unit3([
        rawNx - tx * alongTangent,
        rawNy - ty * alongTangent,
        rawNz - tz * alongTangent,
      ]);
      const [bx, by, bz] = unit3([
        ty * nz - tz * ny,
        tz * nx - tx * nz,
        tx * ny - ty * nx,
      ]);
      const sampleIndex = j === linearSegments ? at(1) : at(0);
      const t = j / linearSegments;
      const isArrowApproach = at(2) < start + count &&
        ss.kind[at(0)] === "sheet" && ss.kind[at(1)] === "sheet" &&
        ss.kind[at(2)] === "sheet" && ss.last[at(2)] === 1;
      const isArrowTip = ss.kind[at(0)] === "sheet" &&
        ss.kind[at(1)] === "sheet" && ss.last[at(1)] === 1;
      const eased = t * t * (3 - 2 * t);
      const heightScale = isArrowTip
        ? SHEET_ARROW_SHOULDER * (1 - eased)
        : isArrowApproach
        ? 1 + (SHEET_ARROW_SHOULDER - 1) * eased
        : 1;
      const halfW = state.widthValues[j] / 2,
        halfH = state.heightValues[j] / 2 * heightScale;
      // Mol* uses a flat-sided sheet mesh and an elliptical helix/coil tube.
      // A continuous superellipse profile lets this shared ring mesh move
      // between those forms without opening the transition.
      const profilePower = 2 + 6 * (
            (ss.kind[at(0)] === "sheet" ? 1 : 0) * (1 - eased) +
            (ss.kind[at(1)] === "sheet" ? 1 : 0) * eased
          );
      const ringBase = positions.length / 3;
      const sourceResidue = trace.residue[sampleIndex];
      for (let side = 0; side < RING_SIDES; side++) {
        const angle = side / RING_SIDES * Math.PI * 2;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        const sw = Math.sign(cos) * Math.abs(cos) ** (2 / profilePower);
        const sh = Math.sign(sin) * Math.abs(sin) ** (2 / profilePower);
        positions.push(
          cx + bx * sw * halfW + nx * sh * halfH,
          cy + by * sw * halfW + ny * sh * halfH,
          cz + bz * sw * halfW + nz * sh * halfH,
        );
        const normalWidth = halfW > 1e-8
          ? Math.sign(sw) * Math.abs(sw) ** (profilePower - 1) / halfW
          : sw;
        const normalHeight = halfH > 1e-8
          ? Math.sign(sh) * Math.abs(sh) ** (profilePower - 1) / halfH
          : sh;
        const [ux, uy, uz] = unit3([
          nx * normalHeight + bx * normalWidth,
          ny * normalHeight + by * normalWidth,
          nz * normalHeight + bz * normalWidth,
        ]);
        normals.push(ux, uy, uz);
        residueOut.push(sourceResidue);
      }
      if (prevRing) {
        for (let side = 0; side < RING_SIDES; side++) {
          const a = prevRing[side],
            b = prevRing[(side + 1) % RING_SIDES],
            c = ringBase + side,
            d = ringBase + (side + 1) % RING_SIDES;
          // Keep face winding aligned with the interpolated outward normals.
          // Tight turns can twist one side of a ring quad past 90 degrees.
          pushOutwardTriangle(indices, positions, normals, a, d, b);
          pushOutwardTriangle(indices, positions, normals, a, c, d);
        }
      }
      prevRing = Array.from(
        { length: RING_SIDES },
        (_, side) => ringBase + side,
      );
      if (!firstRing) {
        firstRing = prevRing;
        firstTangent = [tx, ty, tz];
      }
      lastTangent = [tx, ty, tz];
    }
  }
  if (firstRing && prevRing) {
    cap(firstRing, firstTangent, true);
    cap(prevRing, lastTangent, false);
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
