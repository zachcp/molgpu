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

/** Private scientific rows, independent of display color and inset placement. */
export interface BackbonePoint {
  readonly residue: number;
  readonly row: number;
  readonly phi: number;
  readonly psi: number;
}

/** Default-view residues with finite torsions; anchors prefer each residue's CA. */
export function backbonePoints(data: StructureData): BackbonePoint[] {
  const rows = activeAtoms(data);
  const { phi, psi } = backboneDihedrals(data, { rows });
  const { atoms } = data.topology;
  const anchor = new Map<number, number>();
  for (const i of rows) {
    const r = atoms.residue[i];
    if (!anchor.has(r) || atoms.name[i] === "CA") anchor.set(r, i);
  }
  return [...anchor].filter(([r]) =>
    Number.isFinite(phi[r]) && Number.isFinite(psi[r])
  )
    .map(([residue, row]) => ({
      residue,
      row,
      phi: phi[residue],
      psi: psi[residue],
    }))
    .sort((a, b) => a.residue - b.residue);
}

/** Apply colors without re-evaluating scientific coordinates. */
export function colorBackbonePoints(
  data: StructureData,
  geometry: readonly BackbonePoint[],
  color: Field | VectorLike,
): RamachandranPoint[] {
  const rgba = Array.isArray(color) || ArrayBuffer.isView(color)
    ? null
    : evaluate(color as Field, data, { domain: "atom" }) as Float32Array;
  const fixed = [0, 1, 2, 3].map((k) => (color as VectorLike)[k] ?? 1);
  return geometry.map(({ residue, row, phi, psi }) => {
    const c = rgba ? [0, 1, 2, 3].map((k) => rgba[4 * row + k]) : fixed;
    return {
      residue,
      phi,
      psi,
      color: c as unknown as RamachandranPoint["color"],
    };
  });
}

/** Default-view residue torsions in degrees, with flat or per-atom Field color. */
export function ramachandranPoints(
  data: StructureData,
  color: Field | VectorLike = DEFAULT_RAMACHANDRAN_COLOR,
): RamachandranPoint[] {
  return colorBackbonePoints(data, backbonePoints(data), color);
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
