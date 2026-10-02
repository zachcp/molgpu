// Per-sample direction vectors and secondary-structure labels over an existing trace.
// Direction atom roles come from Mol* 5.11.0's MIT-licensed PolymerTypeAtomRoleId:
// protein C=O, RNA C4'-C3', DNA C3'-C1'. No helix-axis fitting or termini extension
// is performed. Labels use the residue ssCode attribute; absent labels mean coil.
import type { StructureData } from "./structure-types.ts";
import type { SecondaryStructureTrace, Trace } from "./trace-types.ts";
import { attributeColumn } from "./attributes.ts";
import { ssKind } from "./ss-codes.ts";

type SSKind = SecondaryStructureTrace["kind"][number];

const DIRECTION_ATOMS: Partial<
  Record<string, { from: Set<string>; to: Set<string> }>
> = {
  protein: {
    from: new Set(["C"]),
    to: new Set(["O", "OC1", "O1", "OX1", "OXT", "OT1"]),
  },
  rna: { from: new Set(["C4'", "C4*"]), to: new Set(["C3'", "C3*"]) },
  dna: { from: new Set(["C3'", "C3*"]), to: new Set(["C1'", "C1*"]) },
};
// Deterministic fallback; downstream orthogonalization handles parallel directions.
const DEFAULT_DIRECTION: [number, number, number] = [0, 0, 1];

/**
 * Direction vectors + secondary-structure labels for every sample in
 * `trace` (see traceTable). `atomIndices` is the same selection passed to
 * traceTable, so the direction atom (e.g. the carbonyl O) is looked up
 * within the caller's chosen model/altloc policy, not just anywhere.
 */
export function secondaryStructureTrace(
  data: StructureData,
  atomIndices: Uint32Array,
  trace: Trace,
): SecondaryStructureTrace {
  if (!(atomIndices instanceof Uint32Array)) {
    throw new TypeError("atomIndices: expected Uint32Array");
  }
  const { atoms, residues } = data.topology;

  const fromAtom = new Int32Array(residues.count).fill(-1);
  const toAtom = new Int32Array(residues.count).fill(-1);
  for (let s = 0; s < atomIndices.length; s++) {
    const i = atomIndices[s];
    const r = atoms.residue[i], roles = DIRECTION_ATOMS[residues.polymer[r]];
    if (!roles) continue;
    const name = atoms.name[i];
    if (fromAtom[r] < 0 && roles.from.has(name)) fromAtom[r] = i;
    if (toAtom[r] < 0 && roles.to.has(name)) toAtom[r] = i;
  }

  const { count } = trace;
  // The ssCode column (imported, computed or user-supplied), projected
  // to the cartoon's three kinds; all coil without one.
  const codes = attributeColumn(data, "ssCode")?.values;
  const direction = new Float32Array(count * 3);
  const kind = new Array<SSKind>(count);
  for (let k = 0; k < count; k++) {
    const r = trace.residue[k];
    kind[k] = codes ? ssKind(codes[r]) : "coil";
    const from = fromAtom[r], to = toAtom[r];
    let dx: number, dy: number, dz: number;
    if (from >= 0 && to >= 0) {
      dx = data.positions[to * 3] - data.positions[from * 3];
      dy = data.positions[to * 3 + 1] - data.positions[from * 3 + 1];
      dz = data.positions[to * 3 + 2] - data.positions[from * 3 + 2];
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-6) {
        dx /= len;
        dy /= len;
        dz /= len;
      } else [dx, dy, dz] = DEFAULT_DIRECTION;
    } else {
      [dx, dy, dz] = DEFAULT_DIRECTION;
    }
    direction[k * 3] = dx;
    direction[k * 3 + 1] = dy;
    direction[k * 3 + 2] = dz;
  }

  // A sample starts/ends a stable-frame block at a run boundary or wherever
  // the secondary-structure kind changes, mirroring Mol*'s secStrucFirst/
  // secStrucLast controls (curve-segment.mjs pins tension there).
  const first = new Uint8Array(count);
  const last = new Uint8Array(count);
  for (let r = 0; r < trace.runs.length - 1; r++) {
    const start = trace.runs[r], end = trace.runs[r + 1];
    for (let k = start; k < end; k++) {
      first[k] = (k === start || kind[k] !== kind[k - 1]) ? 1 : 0;
      last[k] = (k === end - 1 || kind[k] !== kind[k + 1]) ? 1 : 0;
    }
  }

  return { count, direction, kind, first, last };
}
