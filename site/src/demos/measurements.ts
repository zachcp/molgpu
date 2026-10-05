import { dihedralAngle } from "@molgpu/table";

/** What picked atoms measure: 2 a distance (Å), 3 an angle and 4 a dihedral (°). */
export type Measurement =
  | { readonly kind: "none" }
  | {
    readonly kind: "distance" | "angle" | "dihedral";
    readonly value: number;
  };

const sub = (p: ArrayLike<number>, a: number, b: number) => [
  p[3 * a] - p[3 * b],
  p[3 * a + 1] - p[3 * b + 1],
  p[3 * a + 2] - p[3 * b + 2],
];

/** Measure atom rows of a packed position array in pick order. */
export const measure = (
  positions: ArrayLike<number>,
  rows: readonly number[],
): Measurement => {
  if (rows.length === 2) {
    return {
      kind: "distance",
      value: Math.hypot(...sub(positions, rows[0], rows[1])),
    };
  }
  if (rows.length === 3) {
    const u = sub(positions, rows[0], rows[1]);
    const v = sub(positions, rows[2], rows[1]);
    const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) /
      (Math.hypot(...u) * Math.hypot(...v));
    return {
      kind: "angle",
      value: Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI,
    };
  }
  if (rows.length === 4) {
    const [a, b, c, d] = rows;
    return { kind: "dihedral", value: dihedralAngle(positions, a, b, c, d) };
  }
  return { kind: "none" };
};

/** Readout text: Å for distances, degrees for angles. */
export const formatMeasurement = (m: Measurement): string =>
  m.kind === "none"
    ? ""
    : m.kind === "distance"
    ? `${m.value.toFixed(2)} Å`
    : `${m.value.toFixed(1)}°`;

/** Pick order keeps up to four atoms; a fifth starts a new measurement. */
export const addPick = (picks: readonly number[], row: number): number[] =>
  picks.length >= 4
    ? [row]
    : picks.includes(row)
    ? [...picks]
    : [...picks, row];
