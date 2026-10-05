// Backbone torsions per protein residue. Mol*'s DSSP computes phi/psi but its
// buffers alias after the first residue and it never checks chain breaks, so
// this module follows the IUPAC definitions directly; tests pin the kernel to
// Mol*'s Vec3.dihedralAngle and the geometry to DSSP-assigned helices.
import type { StructureData } from "./structure-types.ts";
import { activeAtoms } from "./structure-view.ts";

/** Per-residue backbone torsions in degrees, (-180, 180]; NaN where undefined. */
export interface BackboneDihedrals {
  /** C(i-1)–N(i)–CA(i)–C(i). */
  readonly phi: Float32Array;
  /** N(i)–CA(i)–C(i)–N(i+1). */
  readonly psi: Float32Array;
  /** CA(i)–C(i)–N(i+1)–CA(i+1): the peptide bond following residue i. */
  readonly omega: Float32Array;
}

/** Peptide C–N bonds longer than this (Å) are chain breaks, as in DSSP. */
export const PEPTIDE_BREAK_DISTANCE = 2.5;

/** Signed dihedral angle in degrees for points a–b–c–d read from `p` by atom row. */
export function dihedralAngle(
  p: ArrayLike<number>,
  a: number,
  b: number,
  c: number,
  d: number,
): number {
  const b1x = p[b * 3] - p[a * 3],
    b1y = p[b * 3 + 1] - p[a * 3 + 1],
    b1z = p[b * 3 + 2] - p[a * 3 + 2];
  const b2x = p[c * 3] - p[b * 3],
    b2y = p[c * 3 + 1] - p[b * 3 + 1],
    b2z = p[c * 3 + 2] - p[b * 3 + 2];
  const b3x = p[d * 3] - p[c * 3],
    b3y = p[d * 3 + 1] - p[c * 3 + 1],
    b3z = p[d * 3 + 2] - p[c * 3 + 2];
  // n1 = b1 × b2, n2 = b2 × b3, m = n1 × |b2|^-1 b2.
  const n1x = b1y * b2z - b1z * b2y,
    n1y = b1z * b2x - b1x * b2z,
    n1z = b1x * b2y - b1y * b2x;
  const n2x = b2y * b3z - b2z * b3y,
    n2y = b2z * b3x - b2x * b3z,
    n2z = b2x * b3y - b2y * b3x;
  const len = Math.hypot(b2x, b2y, b2z);
  const mx = (n1y * b2z - n1z * b2y) / len,
    my = (n1z * b2x - n1x * b2z) / len,
    mz = (n1x * b2y - n1y * b2x) / len;
  const x = n1x * n2x + n1y * n2y + n1z * n2z;
  const y = mx * n2x + my * n2y + mz * n2z;
  const deg = -Math.atan2(y, x) * 180 / Math.PI;
  return deg === -180 ? 180 : deg;
}

/**
 * Backbone phi/psi/omega per residue (`residues.count` entries). Protein
 * residues are ordered by label_seq within each chain (one chain belongs to
 * one model); neighbours count only when consecutive in that order and
 * joined by a C–N distance of at most {@link PEPTIDE_BREAK_DISTANCE}.
 * Missing backbone atoms, termini, breaks and non-protein residues are NaN.
 *
 * `positions` substitutes live coordinates (same row order and length as
 * `data.positions`); the result is a snapshot of whichever positions are read.
 */
export function backboneDihedrals(
  data: StructureData,
  options: {
    /** Atom rows to read, ascending. Defaults to every model with primary
     * altlocs. With all altlocs, the first conformer in file order wins. */
    readonly rows?: ArrayLike<number>;
    readonly positions?: Float32Array;
  } = {},
): BackboneDihedrals {
  const { atoms, residues } = data.topology;
  const P = options.positions ?? data.positions;
  if (P.length !== data.positions.length) {
    throw new RangeError(
      "backboneDihedrals: positions must match data.positions length",
    );
  }
  const rows = options.rows ?? activeAtoms(data, { model: "all" });
  const n = new Int32Array(residues.count).fill(-1);
  const ca = new Int32Array(residues.count).fill(-1);
  const c = new Int32Array(residues.count).fill(-1);
  const seen = new Uint8Array(residues.count);
  for (let k = 0; k < rows.length; k++) {
    const i = rows[k], r = atoms.residue[i];
    if (residues.polymer[r] !== "protein") continue;
    seen[r] = 1;
    const name = atoms.name[i];
    if (name === "N" && n[r] < 0) n[r] = i;
    else if (name === "CA" && ca[r] < 0) ca[r] = i;
    else if (name === "C" && c[r] < 0) c[r] = i;
  }
  const phi = new Float32Array(residues.count).fill(NaN);
  const psi = new Float32Array(residues.count).fill(NaN);
  const omega = new Float32Array(residues.count).fill(NaN);
  const byChain = new Map<number, number[]>();
  for (let r = 0; r < residues.count; r++) {
    if (!seen[r]) continue;
    const chain = residues.chain[r];
    let list = byChain.get(chain);
    if (!list) byChain.set(chain, list = []);
    list.push(r);
  }
  const linked = (a: number, b: number) => {
    if (c[a] < 0 || n[b] < 0) return false;
    const i = c[a] * 3, j = n[b] * 3;
    return Math.hypot(P[i] - P[j], P[i + 1] - P[j + 1], P[i + 2] - P[j + 2]) <=
      PEPTIDE_BREAK_DISTANCE;
  };
  for (const list of byChain.values()) {
    list.sort((a, b) => residues.labelSeq[a] - residues.labelSeq[b] || a - b);
    for (let k = 0; k < list.length; k++) {
      const r = list[k];
      if (n[r] < 0 || ca[r] < 0 || c[r] < 0) continue;
      const prev = k > 0 ? list[k - 1] : -1;
      const next = k + 1 < list.length ? list[k + 1] : -1;
      if (prev >= 0 && linked(prev, r)) {
        phi[r] = dihedralAngle(P, c[prev], n[r], ca[r], c[r]);
      }
      if (next >= 0 && linked(r, next)) {
        psi[r] = dihedralAngle(P, n[r], ca[r], c[r], n[next]);
        if (ca[next] >= 0) {
          omega[r] = dihedralAngle(P, ca[r], c[r], n[next], ca[next]);
        }
      }
    }
  }
  return { phi, psi, omega };
}
