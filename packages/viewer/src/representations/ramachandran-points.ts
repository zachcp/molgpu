import {
  activeAtoms,
  backboneDihedrals,
  type StructureData,
} from "@molgpu/table";
import { evaluate, type Field } from "@molgpu/fields";
import type { VectorLike } from "../types.ts";

/** Inset corner of the canvas. */
export type RamachandranCorner =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/** One plotted residue: row, torsions in degrees and the colour drawn. */
export interface RamachandranPoint {
  readonly residue: number;
  readonly phi: number;
  readonly psi: number;
  readonly color: readonly [number, number, number, number];
}

export const DEFAULT_RAMACHANDRAN_COLOR = [0.85, 0.9, 0.96, 1] as const;

/**
 * Residues of the default view (first model, primary conformers) with both
 * torsions defined. A Field colour is evaluated per atom and read at each
 * residue's CA (else its first row).
 */
export function ramachandranPoints(
  data: StructureData,
  color: Field | VectorLike = DEFAULT_RAMACHANDRAN_COLOR,
): RamachandranPoint[] {
  const rows = activeAtoms(data);
  const { phi, psi } = backboneDihedrals(data, { rows });
  const { atoms } = data.topology;
  const anchor = new Map<number, number>();
  for (const i of rows) {
    const r = atoms.residue[i];
    if (!anchor.has(r) || atoms.name[i] === "CA") anchor.set(r, i);
  }
  const rgba = Array.isArray(color) || ArrayBuffer.isView(color)
    ? null
    : evaluate(color as Field, data, { domain: "atom" }) as Float32Array;
  const fixed = [0, 1, 2, 3].map((k) => (color as VectorLike)[k] ?? 1);
  const points: RamachandranPoint[] = [];
  for (const [r, row] of anchor) {
    if (!Number.isFinite(phi[r]) || !Number.isFinite(psi[r])) continue;
    const c = rgba ? [0, 1, 2, 3].map((k) => rgba[4 * row + k]) : fixed;
    points.push({
      residue: r,
      phi: phi[r],
      psi: psi[r],
      color: c as unknown as RamachandranPoint["color"],
    });
  }
  return points.sort((a, b) => a.residue - b.residue);
}

/** Inset square's top-left corner in CSS pixels for a canvas of w × h. */
export function insetRect(
  corner: RamachandranCorner,
  size: number,
  margin: number,
  w: number,
  h: number,
): { left: number; top: number } {
  return {
    left: corner.endsWith("left") ? margin : w - margin - size,
    top: corner.startsWith("top") ? margin : h - margin - size,
  };
}

/** φ → x and ψ → y in CSS pixels: φ −180 at the left, ψ +180 at the top. */
export function plotAxes(
  left: number,
  top: number,
  size: number,
): [(phi: number) => number, (psi: number) => number] {
  return [
    (phi) => left + (phi + 180) / 360 * size,
    (psi) => top + (180 - psi) / 360 * size,
  ];
}
