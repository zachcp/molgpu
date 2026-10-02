// DSSP secondary-structure codes for the `ssCode` residue column. Codes are
// small integers (exact in f32), not ASCII; SS_CODES[code] is the DSSP letter.

/** DSSP letters in code order: 0 coil, 1 H, 2 B, 3 E, 4 G, 5 I, 6 T, 7 S, 8 P (reserved). */
export const SS_CODES: readonly ["-", "H", "B", "E", "G", "I", "T", "S", "P"] =
  Object.freeze(["-", "H", "B", "E", "G", "I", "T", "S", "P"] as const);

/** Cartoon kind of a code: H/G/I helix, E/B sheet, everything else coil (Mol*'s mapToKind, turn and bend as coil). */
export function ssKind(code: number): "helix" | "sheet" | "coil" {
  return code === 1 || code === 4 || code === 5
    ? "helix"
    : code === 2 || code === 3
    ? "sheet"
    : "coil";
}
