// Pure CPU shape for <Ribbon> and the trace part of <Cartoon>. A port of
// Mol* 5.12.0's MIT-licensed polymer-trace visual
// (mol-repr/structure/visual/polymer-trace-mesh.js), its per-residue
// neighbourhood (visual/util/polymer/trace-iterator.js) and its sheet and
// tube mesh builders (mol-geo/geometry/mesh/builder/{sheet,tube}.js).
//
// Each residue owns one curve segment, half-shifted so that it runs from the
// midpoint with the previous residue to the midpoint with the next one, and
// one builder: a box with an optional arrowhead for sheets, an elliptical
// tube for helices and coil, a flat box for nucleic strands. Run termini are
// clipped and given Mol*'s overhang. This reads only trace.guide/residue/
// runs/runKind and ss.direction/kind as they come out of traceTable and
// secondaryStructureTrace: no second polymer walk, no Mol* runtime types.
//
// Not ported: tubular helices (helix-orientation axis fit), rounded profiles
// and caps, cyclic polymers, coarse-grained size scaling and triangle-normal
// directions for residues without direction atoms.
import {
  createCurveSegmentState,
  type CurveSegmentState,
  interpolateCurveSegment,
  interpolateSizes,
} from "@molgpu/geo";
import type { SecondaryStructureTrace, Trace } from "@molgpu/table";
import { count as countWork } from "../../internal/instrumentation.ts";
import {
  type MeshBuilder,
  meshBuilder,
  type MeshParts,
} from "../mesh-builder.ts";

/** The trace columns the kernel reads; runKind defaults to protein. */
type TraceRuns =
  & Pick<Trace, "guide" | "residue" | "runs">
  & Partial<Pick<Trace, "runKind">>;
type TraceFrames = Pick<SecondaryStructureTrace, "direction" | "kind">;
type Kind = SecondaryStructureTrace["kind"][number];

type Vec3 = [number, number, number];

/** An indexed ribbon mesh, with each vertex's source residue row. */
export interface RibbonGeometry extends MeshParts {
  readonly count: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
}

// Mol* 5.12 cartoon defaults: uniform size 1 times sizeFactor 0.2, aspect
// ratio 5, arrow factor 1.5, 16 radial segments. Widths and heights are
// half-extents: width follows the binormal, height the normal.
export const CARTOON_SIZE = 0.2;
const ASPECT_RATIO = 5;
const ARROW_FACTOR = 1.5;
const RADIAL_SEGMENTS = 16;
const HELIX_TENSION = 0.9;
const STANDARD_TENSION = 0.5;
const STANDARD_SHIFT = 0.5;
const NUCLEIC_SHIFT = 0.3;
const OVERHANG_FACTOR = 2;
const TERMINUS_EXTENSION = 1.5;

const v3 = (arr: ArrayLike<number>, i: number): Vec3 => [
  arr[i * 3],
  arr[i * 3 + 1],
  arr[i * 3 + 2],
];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const setMagnitude = (a: Vec3, m: number): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 0 ? scale(a, m / l) : [0, 0, 0];
};
const matchDirection = (a: Vec3, b: Vec3): Vec3 =>
  dot(a, b) < 0 ? scale(a, -1) : a;

/** Mol*'s sheet mesh: a box whose last residue may form an arrowhead. Set arrowHeight 0 for none. */
export function addSheet(
  b: MeshBuilder,
  points: Float32Array,
  normals: Float32Array,
  binormals: Float32Array,
  segments: number,
  widths: Float32Array,
  heights: Float32Array,
  arrowHeight: number,
  startCap: boolean,
  endCap: boolean,
): void {
  const base = b.vertexCount();
  const offsetLength = arrowHeight > 0
    ? arrowHeight /
      Math.hypot(...sub(v3(points, segments), v3(points, 0)))
    : 0;
  for (let i = 0; i <= segments; ++i) {
    const height = arrowHeight === 0
      ? heights[i]
      : arrowHeight * (1 - i / segments);
    const n = v3(normals, i), t = v3(binormals, i), p = v3(points, i);
    const vertical = scale(n, height), horizontal = scale(t, widths[i]);
    // Tilting the broad faces by the arrow's slope shades its taper.
    const offset = arrowHeight > 0
      ? scale(cross(n, t), offsetLength)
      : [0, 0, 0] as Vec3;
    const up = add(n, offset), down = add(scale(n, -1), offset);
    const left = scale(t, -1);
    const pp = add(add(p, horizontal), vertical);
    const mp = add(sub(p, horizontal), vertical);
    const mm = sub(sub(p, horizontal), vertical);
    const pm = sub(add(p, horizontal), vertical);
    b.vertex(pp, up);
    b.vertex(mp, up);
    b.vertex(mp, left);
    b.vertex(mm, left);
    b.vertex(mm, down);
    b.vertex(pm, down);
    b.vertex(pm, t);
    b.vertex(pp, t);
  }
  for (let i = 0; i < segments; ++i) {
    // Opposing triangles of the box align, so tight curves do not make the
    // faces intersect.
    for (let j = 0; j < 2; j++) {
      const a = base + i * 8 + 2 * j, d = base + (i + 1) * 8 + 2 * j;
      b.triangle(a, d + 1, a + 1);
      b.triangle(a, d, d + 1);
    }
    for (let j = 2; j < 4; j++) {
      const a = base + i * 8 + 2 * j, d = base + (i + 1) * 8 + 2 * j;
      b.triangle(a, d, a + 1);
      b.triangle(d, d + 1, a + 1);
    }
  }
  if (startCap) {
    const h = arrowHeight === 0 ? heights[0] : arrowHeight;
    addSheetCap(b, points, normals, binormals, 0, widths[0], h, h, false);
  } else if (arrowHeight > 0) {
    // The arrow's back face: two strips from the body to the barbs.
    const width = widths[0], height = heights[0];
    addSheetCap(
      b,
      points,
      normals,
      binormals,
      0,
      width,
      arrowHeight,
      -height,
      false,
    );
    addSheetCap(
      b,
      points,
      normals,
      binormals,
      0,
      width,
      -arrowHeight,
      height,
      false,
    );
  }
  if (endCap && arrowHeight === 0) {
    const h = heights[segments];
    addSheetCap(
      b,
      points,
      normals,
      binormals,
      segments,
      widths[segments],
      h,
      h,
      true,
    );
  }
}

function addSheetCap(
  b: MeshBuilder,
  points: Float32Array,
  normals: Float32Array,
  binormals: Float32Array,
  at: number,
  width: number,
  leftHeight: number,
  rightHeight: number,
  flip: boolean,
): void {
  const n = v3(normals, at), t = v3(binormals, at), p = v3(points, at);
  const vLeft = scale(n, leftHeight), vRight = scale(n, rightHeight);
  const horizontal = scale(t, width);
  const normal = cross(t, n);
  const p1 = add(add(p, horizontal), vRight);
  const p2 = sub(add(p, horizontal), vLeft);
  const p3 = sub(sub(p, horizontal), vLeft);
  const p4 = add(sub(p, horizontal), vRight);
  const corners = leftHeight < rightHeight
    ? [p4, p3, p2, p1]
    : [p1, p2, p3, p4];
  const capNormal = flip ? scale(normal, -1) : normal;
  const base = b.vertexCount();
  for (const corner of corners) b.vertex(corner, capNormal);
  if (flip) {
    b.triangle(base, base + 1, base + 2);
    b.triangle(base + 2, base + 3, base);
  } else {
    b.triangle(base + 2, base + 1, base);
    b.triangle(base, base + 3, base + 2);
  }
}

const COS = Array.from(
  { length: RADIAL_SEGMENTS },
  (_, j) => Math.cos(j * 2 / RADIAL_SEGMENTS * Math.PI),
);
const SIN = Array.from(
  { length: RADIAL_SEGMENTS },
  (_, j) => Math.sin(j * 2 / RADIAL_SEGMENTS * Math.PI),
);

/** Mol*'s elliptical tube mesh with flat caps. */
export function addTube(
  b: MeshBuilder,
  points: Float32Array,
  normals: Float32Array,
  binormals: Float32Array,
  segments: number,
  widths: Float32Array,
  heights: Float32Array,
  startCap: boolean,
  endCap: boolean,
): void {
  const r = RADIAL_SEGMENTS;
  const base = b.vertexCount();
  for (let i = 0; i <= segments; ++i) {
    const u = v3(normals, i), v = v3(binormals, i), c = v3(points, i);
    const width = widths[i], height = heights[i];
    for (let j = 0; j < r; ++j) {
      b.vertex(
        add(c, add(scale(u, height * COS[j]), scale(v, width * SIN[j]))),
        add(scale(u, width * COS[j]), scale(v, height * SIN[j])),
      );
    }
  }
  const half = Math.round(r / 2);
  for (let i = 0; i < segments; ++i) {
    const row = base + i * r, next = base + (i + 1) * r;
    for (let j = 0; j < half; ++j) {
      const j1 = (j + 1) % r;
      b.triangle(row + j1, next + j1, row + j);
      b.triangle(next + j1, next + j, row + j);
    }
    for (let j = half; j < r; ++j) {
      const j1 = (j + 1) % r;
      b.triangle(row + j1, next + j, row + j);
      b.triangle(next + j1, next + j, row + j1);
    }
  }
  const cap = (at: number, start: boolean) => {
    const u = v3(normals, at), v = v3(binormals, at), c = v3(points, at);
    const normal = start ? cross(v, u) : cross(u, v);
    const center = b.vertexCount();
    b.vertex(c, normal);
    const ring = b.vertexCount();
    for (let i = 0; i < r; ++i) {
      b.vertex(
        add(
          c,
          add(
            scale(u, heights[at] * COS[i]),
            scale(v, widths[at] * SIN[i]),
          ),
        ),
        normal,
      );
      const i1 = (i + 1) % r;
      if (start) b.triangle(ring + i1, ring + i, center);
      else b.triangle(ring + i, ring + i1, center);
    }
  };
  if (startCap) cap(0, true);
  if (endCap) cap(segments, false);
}

/** A latitude/longitude sphere: Mol*'s marker for a single-residue run. */
export function addSphere(b: MeshBuilder, center: Vec3, radius: number): void {
  const rings = 8, sides = 12;
  const base = b.vertexCount();
  for (let i = 0; i <= rings; i++) {
    const theta = i / rings * Math.PI;
    for (let j = 0; j <= sides; j++) {
      const phi = j / sides * Math.PI * 2;
      const n: Vec3 = [
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      ];
      b.vertex(add(center, scale(n, radius)), n);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j, c = a + sides + 1;
      if (i > 0) b.triangle(a, a + 1, c);
      if (i < rings - 1) b.triangle(a + 1, c + 1, c);
    }
  }
}

/**
 * Mol*'s per-residue neighbourhood within one run: clamped neighbour
 * indices, terminal extension of the guide points, sheet-smoothed control
 * points and neighbour-matched directions.
 */
function residueControls(
  trace: TraceRuns,
  ss: TraceFrames,
  start: number,
  count: number,
  i: number,
) {
  const idx = (o: number) => Math.min(count - 1, Math.max(0, i + o));
  const kind = (o: number): Kind => ss.kind[start + idx(o)];
  // p[o + 3] is the guide point of residue i + o, offsets -3..3.
  const p = [-3, -2, -1, 0, 1, 2, 3].map((o) =>
    v3(trace.guide, start + idx(o))
  );
  const extend = (from: number, toward: number, ...targets: number[]) => {
    const d = setMagnitude(sub(p[from], p[toward]), TERMINUS_EXTENSION);
    let prev = from;
    for (const target of targets) {
      p[target] = add(p[prev], d);
      prev = target;
    }
  };
  if (idx(-1) === i) extend(3, 4, 2, 1, 0);
  else if (idx(-2) === idx(-1)) extend(2, 3, 1, 0);
  else if (idx(-3) === idx(-2)) extend(1, 2, 0);
  if (idx(1) === i) extend(3, 2, 4, 5, 6);
  else if (idx(2) === idx(1)) extend(4, 3, 5, 6);
  else if (idx(3) === idx(2)) extend(5, 4, 6);
  const control = (o: number): Vec3 => {
    const c = p[o + 3];
    if (kind(o) !== "sheet") return c;
    const sum = add(add(p[o + 2], p[o + 4]), scale(c, 2));
    return scale(sum, 1 / 4);
  };
  const dir = (o: number) => v3(ss.direction, start + idx(o));
  const direction = (a: Vec3, b: Vec3, c: Vec3): Vec3 =>
    scale(
      add(add(matchDirection(a, b), matchDirection(c, b)), scale(b, 2)),
      1 / 4,
    );
  return {
    p0: control(-2),
    p1: control(-1),
    p2: control(0),
    p3: control(1),
    p4: control(2),
    d12: direction(dir(-1), dir(0), dir(1)),
    d23: direction(dir(0), dir(1), dir(2)),
    secStrucFirst: kind(-1) !== kind(0),
    secStrucLast: i === count - 1 || kind(0) !== kind(1),
  };
}

/** One residue's trace segment, following Mol*'s createPolymerTraceMesh. */
function addResidue(
  b: MeshBuilder,
  state: CurveSegmentState,
  trace: TraceRuns,
  ss: TraceFrames,
  start: number,
  count: number,
  i: number,
  nucleic: boolean,
): void {
  const { curvePoints, normalVectors, binormalVectors } = state;
  const linearSegments = state.linearSegments;
  const controls = residueControls(trace, ss, start, count, i);
  const kind = ss.kind[start + i];
  const isSheet = kind === "sheet", isHelix = kind === "helix";
  const initial = i === 0, final = i === count - 1;
  const shift = nucleic ? NUCLEIC_SHIFT : STANDARD_SHIFT;
  const w = CARTOON_SIZE;
  if (initial && final) {
    addSphere(b, controls.p2, w * 2);
    return;
  }
  interpolateCurveSegment(
    state,
    controls,
    isHelix ? HELIX_TENSION : STANDARD_TENSION,
    shift,
  );
  const startCap = controls.secStrucFirst || initial;
  const endCap = controls.secStrucLast || final;
  let segments = linearSegments;
  if (initial) {
    // Keep only the half of the segment past the first guide point, and
    // let it overhang that point slightly.
    segments = Math.max(Math.round(linearSegments * shift), 1);
    const offset = linearSegments - segments;
    curvePoints.copyWithin(0, offset * 3);
    binormalVectors.copyWithin(0, offset * 3);
    normalVectors.copyWithin(0, offset * 3);
    const d = setMagnitude(sub(controls.p2, v3(curvePoints, 1)), 1);
    curvePoints.set(add(controls.p2, scale(d, w * OVERHANG_FACTOR)), 0);
  } else if (final) {
    segments = Math.max(Math.round(linearSegments * (1 - shift)), 1);
    const d = setMagnitude(
      sub(controls.p2, v3(curvePoints, segments - 1)),
      1,
    );
    curvePoints.set(
      add(controls.p2, scale(d, w * OVERHANG_FACTOR)),
      segments * 3,
    );
  }
  const { widthValues, heightValues } = state;
  if (isSheet) {
    const h = w * ASPECT_RATIO;
    interpolateSizes(state, w, w, w, h, h, h, shift);
    const arrowHeight = controls.secStrucLast ? h * ARROW_FACTOR : 0;
    addSheet(
      b,
      curvePoints,
      normalVectors,
      binormalVectors,
      segments,
      widthValues,
      heightValues,
      arrowHeight,
      startCap,
      endCap,
    );
    return;
  }
  const h = isHelix || nucleic ? w * ASPECT_RATIO : w;
  interpolateSizes(state, w, w, w, h, h, h, shift);
  if (nucleic && !isHelix) {
    // Mol* swaps the axes for nucleic strands and draws them square.
    for (let k = 0; k < binormalVectors.length; k++) binormalVectors[k] *= -1;
    addSheet(
      b,
      curvePoints,
      binormalVectors,
      normalVectors,
      segments,
      widthValues,
      heightValues,
      0,
      startCap,
      endCap,
    );
    return;
  }
  addTube(
    b,
    curvePoints,
    normalVectors,
    binormalVectors,
    segments,
    widthValues,
    heightValues,
    startCap,
    endCap,
  );
}

/**
 * Build cartoon trace geometry from a @molgpu/table trace plus its
 * secondaryStructureTrace: per-residue segments within each run, never
 * bridged across a run boundary. `linearSegments` is samples per residue
 * segment (Mol*'s linearSegments, default 8). `count === 0` when the trace
 * is empty.
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
  const b = meshBuilder();
  const state = createCurveSegmentState(linearSegments);
  for (let r = 0; r < trace.runs.length - 1; r++) {
    const start = trace.runs[r], count = trace.runs[r + 1] - start;
    const nucleic = (trace.runKind?.[r] ?? "protein") !== "protein";
    for (let i = 0; i < count; i++) {
      b.group = trace.residue[start + i];
      addResidue(b, state, trace, ss, start, count, i, nucleic);
    }
  }
  return withCounts(b.finish());
}

export function withCounts(mesh: MeshParts): RibbonGeometry {
  const vertexCount = mesh.positions.length / 3;
  return {
    ...mesh,
    count: vertexCount,
    vertexCount,
    triangleCount: mesh.indices.length / 3,
  };
}
