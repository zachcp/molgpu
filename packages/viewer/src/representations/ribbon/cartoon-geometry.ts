// The non-trace visuals of <Cartoon>, ported from Mol* 5.12.0's
// MIT-licensed nucleotide-ring-mesh.js and polymer-gap-cylinder.js (with the
// purine/pyrimidine atom roles of visual/util/nucleotide.js and the gap
// segmentation of model/properties/utils/atomic-ranges.js). Both read the
// already-built trace, so they share its selection, model/altloc policy and
// coordinate generation; every vertex maps to a trace residue for colouring.
import type { StructureData, Trace } from "@molgpu/table";
import { count as countWork } from "../../internal/instrumentation.ts";
import { addSphere, CARTOON_SIZE } from "./ribbon-geometry.ts";
import {
  type MeshBuilder,
  meshBuilder,
  type MeshParts,
} from "../mesh-builder.ts";

type Vec3 = [number, number, number];

const RADIAL_SEGMENTS = 16;
const GAP_DASHES = 10;
const PURINES = new Set(["A", "G", "I", "DA", "DG", "DI", "APN", "GPN"]);
const PYRIMIDINES = new Set(["C", "T", "U", "DC", "DT", "DU", "CPN", "TPN"]);
// Ring atoms in Mol*'s strip/fan order, with its fallbacks for modified rings.
const PURINE_RING = [
  ["N1"],
  ["C2"],
  ["N3"],
  ["C4"],
  ["C5", "N5"],
  ["C6"],
  ["N7", "C7"],
  ["C8"],
  ["N9"],
];
const PYRIMIDINE_RING = [["N1", "C1"], ["C2"], ["N3"], ["C4"], ["C5"], [
  "C6",
]];
// Mol*'s triangle strip and fans over the ring atoms, each offset to both
// faces of the slab (2i above, 2i + 1 below).
const PURINE_STRIP = [
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  16,
  17,
  14,
  15,
  12,
  13,
  8,
  9,
  10,
  11,
  0,
  1,
];
const PURINE_TOP = [8, 12, 14, 16, 6, 4, 2, 0, 10];
const PURINE_BOTTOM = [9, 11, 1, 3, 5, 7, 17, 15, 13];
const PYRIMIDINE_STRIP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1];
const PYRIMIDINE_TOP = [0, 10, 8, 6, 4, 2];
const PYRIMIDINE_BOTTOM = [1, 3, 5, 7, 9, 11];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 1];
};
const atomPosition = (data: StructureData, atom: number): Vec3 => [
  data.positions[atom * 3],
  data.positions[atom * 3 + 1],
  data.positions[atom * 3 + 2],
];

/** A flat-shaded triangle: its own three vertices with the face normal. */
function flatTriangle(b: MeshBuilder, p: Vec3, q: Vec3, r: Vec3): void {
  const normal = unit(cross(sub(q, p), sub(r, p)));
  const base = b.vertexCount();
  b.vertex(p, normal);
  b.vertex(q, normal);
  b.vertex(r, normal);
  b.triangle(base, base + 1, base + 2);
}

/** Mol*'s MeshBuilder.addTriangleStrip and addTriangleFan. */
function strip(b: MeshBuilder, points: Vec3[], indices: number[]): void {
  for (let i = 2; i < indices.length; i += 2) {
    const a = points[indices[i - 2]], c = points[indices[i - 1]];
    const d = points[indices[i]], e = points[indices[i + 1]];
    flatTriangle(b, a, c, d);
    flatTriangle(b, c, e, d);
  }
}
function fan(b: MeshBuilder, points: Vec3[], indices: number[]): void {
  const a = points[indices[0]];
  for (let i = 2; i < indices.length; i++) {
    flatTriangle(b, a, points[indices[i]], points[indices[i - 1]]);
  }
}

/** An open or capped cylinder between two points. */
function addCylinder(
  b: MeshBuilder,
  start: Vec3,
  end: Vec3,
  radius: number,
  caps: boolean,
): void {
  const axis = unit(sub(end, start));
  const helper: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(axis, helper)), v = cross(axis, u);
  const r = RADIAL_SEGMENTS;
  const base = b.vertexCount();
  for (const center of [start, end]) {
    for (let j = 0; j < r; j++) {
      const angle = j / r * Math.PI * 2;
      const n = add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle)));
      b.vertex(add(center, scale(n, radius)), n);
    }
  }
  for (let j = 0; j < r; j++) {
    const j1 = (j + 1) % r;
    b.triangle(base + j, base + j1, base + r + j1);
    b.triangle(base + j, base + r + j1, base + r + j);
  }
  if (!caps) return;
  for (const [center, normal] of [[start, scale(axis, -1)], [end, axis]]) {
    const c = b.vertexCount();
    b.vertex(center, normal);
    for (let j = 0; j < r; j++) {
      const angle = j / r * Math.PI * 2;
      const n = add(scale(u, Math.cos(angle)), scale(v, Math.sin(angle)));
      b.vertex(add(center, scale(n, radius)), normal);
    }
    for (let j = 0; j < r; j++) {
      const j1 = (j + 1) % r;
      if (normal === axis) b.triangle(c, c + 1 + j, c + 1 + j1);
      else b.triangle(c, c + 1 + j1, c + 1 + j);
    }
  }
}

/** Atom rows by name for each residue in `rows`, restricted to `atomIndices`. */
function atomsByName(
  data: StructureData,
  atomIndices: Uint32Array,
  rows: Set<number>,
): Map<number, Map<string, number>> {
  const out = new Map<number, Map<string, number>>();
  const { atoms } = data.topology;
  for (const i of atomIndices) {
    const r = atoms.residue[i];
    if (!rows.has(r)) continue;
    let names = out.get(r);
    if (!names) out.set(r, names = new Map());
    if (!names.has(atoms.name[i])) names.set(atoms.name[i], i);
  }
  return out;
}

/**
 * Mol*'s nucleotide-ring visual for every nucleic residue in `trace`: a
 * stick from the trace atom to N9 (purine) or N1 (pyrimidine), a ball at
 * that nitrogen, and the base ring(s) as a slab 2 × 0.2 Å thick. Atoms come
 * from `atomIndices`, the trace's own selection.
 */
export function buildNucleotideRingGeometry(
  data: StructureData,
  atomIndices: Uint32Array,
  trace: Trace,
): MeshParts {
  const b = meshBuilder();
  const { residues } = data.topology;
  const nucleic = new Map<number, number>();
  for (let k = 0; k < trace.count; k++) {
    const r = trace.residue[k], kind = residues.polymer[r];
    if (kind === "dna" || kind === "rna") nucleic.set(r, trace.atom[k]);
  }
  if (nucleic.size === 0) return b.finish();
  countWork("geometryBuilds", "cartoon:rings");
  const byName = atomsByName(data, atomIndices, new Set(nucleic.keys()));
  const radius = CARTOON_SIZE, thickness = CARTOON_SIZE;
  for (const [r, traceAtom] of nucleic) {
    const names = byName.get(r);
    if (!names) continue;
    const find = (choices: string[]) => {
      for (const name of choices) {
        const atom = names.get(name);
        if (atom !== undefined) return atom;
      }
      return -1;
    };
    const comp = residues.comp[r].toUpperCase();
    let purine = PURINES.has(comp);
    if (!purine && !PYRIMIDINES.has(comp)) {
      // Unknown base: Mol* calls it a purine when C4–N9 is bonded.
      const c4 = find(["C4"]), n9 = find(["N9"]);
      purine = c4 >= 0 && n9 >= 0 &&
        Math.hypot(...sub(atomPosition(data, c4), atomPosition(data, n9))) <
          1.6;
    }
    const ring = (purine ? PURINE_RING : PYRIMIDINE_RING).map(find);
    b.group = r;
    const anchor = ring[purine ? 8 : 0];
    if (anchor >= 0) {
      const n = atomPosition(data, anchor);
      addCylinder(b, n, atomPosition(data, traceAtom), radius, false);
      addSphere(b, n, radius);
    }
    if (ring.some((atom) => atom < 0)) continue;
    const p = ring.map((atom) => atomPosition(data, atom));
    // Mol*'s ring normal: the triangle N1, C4, C5.
    const normal = scale(
      unit(cross(sub(p[3], p[0]), sub(p[4], p[0]))),
      thickness,
    );
    const slab = p.flatMap((point) => [add(point, normal), sub(point, normal)]);
    strip(b, slab, purine ? PURINE_STRIP : PYRIMIDINE_STRIP);
    fan(b, slab, purine ? PURINE_TOP : PYRIMIDINE_TOP);
    fan(b, slab, purine ? PURINE_BOTTOM : PYRIMIDINE_BOTTOM);
  }
  return b.finish();
}

/**
 * Pairs of trace samples that flank a polymer gap: consecutive runs of one
 * chain where residues are missing from the model itself. A run break made
 * only by the selection, a chain/model change or a polymer-kind change
 * with contiguous numbering is not a gap.
 */
export function polymerGaps(
  data: StructureData,
  trace: Trace,
): [number, number][] {
  const { residues } = data.topology;
  const present = new Map<number, Set<number>>();
  const modelled = (chain: number) => {
    let seqs = present.get(chain);
    if (!seqs) {
      seqs = new Set();
      for (let r = 0; r < residues.count; r++) {
        if (residues.chain[r] === chain) seqs.add(residues.labelSeq[r]);
      }
      present.set(chain, seqs);
    }
    return seqs;
  };
  const gaps: [number, number][] = [];
  for (let run = 1; run < trace.runs.length - 1; run++) {
    const a = trace.runs[run] - 1, b = trace.runs[run];
    const ra = trace.residue[a], rb = trace.residue[b];
    if (residues.chain[ra] !== residues.chain[rb]) continue;
    const from = residues.labelSeq[ra], to = residues.labelSeq[rb];
    if (to <= from + 1) continue;
    const seqs = modelled(residues.chain[ra]);
    let missing = true;
    for (let s = from + 1; s < to && missing; s++) missing = !seqs.has(s);
    if (missing) gaps.push([a, b]);
  }
  return gaps;
}

/**
 * Mol*'s polymer-gap visual: from each stem's trace atom, five dashes
 * 0.2 Å in radius run halfway toward the other stem.
 */
export function buildPolymerGapGeometry(
  data: StructureData,
  trace: Trace,
): MeshParts {
  const b = meshBuilder();
  const gaps = polymerGaps(data, trace);
  if (gaps.length) countWork("geometryBuilds", "cartoon:gaps");
  const guide = (k: number): Vec3 => [
    trace.guide[k * 3],
    trace.guide[k * 3 + 1],
    trace.guide[k * 3 + 2],
  ];
  for (const [a, c] of gaps) {
    for (const [from, to] of [[a, c], [c, a]]) {
      b.group = trace.residue[from];
      const start = guide(from), end = guide(to);
      const d = Math.hypot(...sub(end, start)) * 0.5;
      const step = scale(unit(sub(end, start)), d / (GAP_DASHES + 0.5));
      for (let j = 0; j < GAP_DASHES / 2; j++) {
        addCylinder(
          b,
          add(start, scale(step, 2 * j + 1)),
          add(start, scale(step, 2 * j + 2)),
          CARTOON_SIZE,
          true,
        );
      }
    }
  }
  return b.finish();
}
