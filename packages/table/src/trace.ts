// Residue-level polymer trace: the segmented guide/frame values shared by
// tube and ribbon/arrow cartoons (0sj.5, 0sj.6). Pure derivation from an
// already-validated Structure plus an explicit atom selection — no geometry,
// no GPU types.
//
// Guide-atom role names are ported from Mol* 5.11.0's MIT-licensed
// mol-model/structure/model/types.js PolymerTypeAtomRoleId table (trace atom
// per polymer kind, with a coarse-model fallback). Frame propagation itself
// (central-difference tangent, Gram-Schmidt normal against a carried
// reference) is this project's own — the chemistry-informed frames from
// secondary structure are 0sj.2's job, not this one's.
import type { StructureData } from "./structure-types.ts";
import type { Trace } from "./trace-types.ts";

type Vec3 = [number, number, number];
type TraceKind = Trace["runKind"][number];

const TRACE_ATOM: Record<TraceKind, Set<string>> = {
  protein: new Set(["CA"]),
  rna: new Set(["O3'", "O3*"]),
  dna: new Set(["O3'", "O3*"]),
};
const COARSE_ATOM: Record<TraceKind, Set<string>> = {
  protein: new Set(["CA", "CA1", "BB", "BAS"]),
  rna: new Set(["P"]),
  dna: new Set(["P"]),
};

const sub3 = (
  a: Vec3,
  b: Vec3,
): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (
  a: Vec3,
  b: Vec3,
): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit3 = (v: Vec3): Vec3 | null => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-6 ? [v[0] / l, v[1] / l, v[2] / l] : null;
};

/** A unit vector orthogonal to `tangent`, closest to `preferred`; always finite. */
function orthogonalNormal(tangent: Vec3, preferred: Vec3): Vec3 {
  for (const ref of [preferred, [0, 0, 1], [1, 0, 0], [0, 1, 0]] as Vec3[]) {
    const d = dot3(tangent, ref);
    const v = unit3([
      ref[0] - tangent[0] * d,
      ref[1] - tangent[1] * d,
      ref[2] - tangent[2] * d,
    ]);
    if (v) return v;
  }
  return [1, 0, 0];
}

interface TraceBuilder {
  guide: number[];
  tangent: number[];
  normal: number[];
  binormal: number[];
  residue: number[];
  runKind: TraceKind[];
  runs: number[];
}

function emitRun(
  out: TraceBuilder,
  data: StructureData,
  residueRows: number[],
  guideAtom: Int32Array,
): void {
  const { residues } = data.topology;
  const n = residueRows.length;
  const positions = residueRows.map((r): Vec3 => {
    const i = guideAtom[r] * 3;
    return [data.positions[i], data.positions[i + 1], data.positions[i + 2]];
  });
  let ref: Vec3 = [0, 0, 1];
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    const tangent = unit3(sub3(positions[b], positions[a])) ?? [0, 0, 1];
    const normal = orthogonalNormal(tangent, ref);
    const binormal = unit3(cross3(tangent, normal)) ?? [0, 0, 1];
    out.guide.push(...positions[k]);
    out.tangent.push(...tangent);
    out.normal.push(...normal);
    out.binormal.push(...binormal);
    out.residue.push(residueRows[k]);
    ref = normal;
  }
  out.runKind.push(residues.polymer[residueRows[0]] as TraceKind);
  out.runs.push(out.runs[out.runs.length - 1] + n);
}

/**
 * Build the segmented polymer trace over `atomIndices` (typically
 * `activeAtoms(data, policy)`, so model/altloc policy is the caller's
 * explicit choice, not an implicit default here).
 *
 * A run is a maximal same-chain, same-polymer-kind stretch of residues whose
 * `labelSeq` increases by exactly 1 and which all have a resolvable guide
 * atom *within the given selection*. Missing residues, chain/model changes,
 * a polymer-kind change, and a selection that drops a residue's guide atom
 * all break the run the same way: as a `labelSeq` (or presence) gap in the
 * filtered per-chain sequence, never as something to bridge or interpolate
 * across.
 */
export function traceTable(
  data: StructureData,
  atomIndices: Uint32Array,
): Trace {
  if (!(atomIndices instanceof Uint32Array)) {
    throw new TypeError("atomIndices: expected Uint32Array");
  }
  const { atoms, residues, chains } = data.topology;

  const guideAtom = new Int32Array(residues.count).fill(-1);
  const guideRank = new Uint8Array(residues.count).fill(2); // 0 trace hit, 1 coarse hit, 2 none
  for (let s = 0; s < atomIndices.length; s++) {
    const i = atomIndices[s];
    if (!Number.isInteger(i) || i < 0 || i >= atoms.count) {
      throw new RangeError(`atomIndices[${s}]: out of range`);
    }
    const r = atoms.residue[i], kind = residues.polymer[r];
    if (kind === "other") continue;
    const trace = TRACE_ATOM[kind], coarse = COARSE_ATOM[kind];
    const name = atoms.name[i];
    if (guideRank[r] > 0 && trace.has(name)) {
      guideAtom[r] = i;
      guideRank[r] = 0;
    } else if (guideRank[r] > 1 && coarse.has(name)) {
      guideAtom[r] = i;
      guideRank[r] = 1;
    }
  }

  const byChain = Array.from({ length: chains.count }, (): number[] => []);
  for (let r = 0; r < residues.count; r++) {
    if (guideAtom[r] >= 0) byChain[residues.chain[r]].push(r);
  }

  const out: TraceBuilder = {
    guide: [],
    tangent: [],
    normal: [],
    binormal: [],
    residue: [],
    runKind: [],
    runs: [0],
  };
  for (let c = 0; c < chains.count; c++) {
    const list = byChain[c];
    list.sort((a, b) => residues.labelSeq[a] - residues.labelSeq[b]);
    let runStart = 0;
    for (let k = 1; k <= list.length; k++) {
      const contiguous = k < list.length &&
        residues.polymer[list[k]] === residues.polymer[list[k - 1]] &&
        residues.labelSeq[list[k]] === residues.labelSeq[list[k - 1]] + 1;
      if (!contiguous) {
        emitRun(out, data, list.slice(runStart, k), guideAtom);
        runStart = k;
      }
    }
  }

  return {
    count: out.residue.length,
    guide: Float32Array.from(out.guide),
    tangent: Float32Array.from(out.tangent),
    normal: Float32Array.from(out.normal),
    binormal: Float32Array.from(out.binormal),
    residue: Uint32Array.from(out.residue),
    runs: Uint32Array.from(out.runs),
    runKind: out.runKind,
  };
}
