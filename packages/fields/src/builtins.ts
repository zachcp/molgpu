// Built-in colour fields: a small, closed set composed from the field
// primitives. There is deliberately no user-facing expression language — these
// are the common presets, and callers reach for the
// primitives (categorical/linear/colormap) directly for anything else.
import type { VolumeData } from "@molgpu/table";
import {
  attribute,
  categorical,
  colormap,
  linear,
  volumeSample,
} from "./primitives.ts";
import type { Color, Field } from "./types.ts";

type Stops = ReadonlyArray<readonly [number, Color]>;

// CPK-style element colours for the common biomolecular elements. Unlisted
// elements take the field's fallback.
const CPK: Record<number, Color> = {
  1: [0.92, 0.92, 0.94, 1], // H
  6: [0.55, 0.57, 0.60, 1], // C
  7: [0.35, 0.50, 0.92, 1], // N
  8: [0.90, 0.36, 0.33, 1], // O
  15: [0.95, 0.55, 0.25, 1], // P
  16: [0.95, 0.80, 0.30, 1], // S
};

const COOL_WARM: Stops = [[0, [0.23, 0.30, 0.75, 1]], [0.5, [
  0.95,
  0.95,
  0.95,
  1,
]], [1, [0.75, 0.20, 0.20, 1]]];
// Mol*'s 'red-white-blue' list (0xBF2222, 0xFFFFFF, 0x3361E1), as its
// partial-charge theme uses it.
const RED_WHITE_BLUE: Stops = [
  [0, [191 / 255, 34 / 255, 34 / 255, 1]],
  [0.5, [1, 1, 1, 1]],
  [1, [51 / 255, 97 / 255, 225 / 255, 1]],
];
const RAINBOW: Stops = [
  [0, [0.80, 0.15, 0.15, 1]],
  [0.25, [0.90, 0.70, 0.15, 1]],
  [0.5, [0.15, 0.70, 0.25, 1]],
  [0.75, [0.15, 0.50, 0.90, 1]],
  [1, [0.55, 0.15, 0.70, 1]],
];
const CHAIN_CYCLE: readonly Color[] = [
  [0.30, 0.60, 0.90, 1],
  [0.90, 0.55, 0.30, 1],
  [0.40, 0.80, 0.45, 1],
  [0.85, 0.45, 0.80, 1],
  [0.90, 0.80, 0.35, 1],
  [0.40, 0.80, 0.80, 1],
  [0.85, 0.50, 0.50, 1],
  [0.60, 0.60, 0.90, 1],
];

/** Colour atoms by element (CPK), with `fallback` for uncommon elements. */
export function byElement(fallback: Color = [0.85, 0.45, 0.80, 1]): Field {
  return categorical(attribute("element"), CPK, fallback);
}

/** Colour atoms by B-factor over `domain` (default [0,100]) on a cool→warm ramp.
 *  Auto-range with `columnRange(data, 'bfactor')`. */
export function byBfactor(
  options: {
    domain?: readonly [number, number];
    stops?: ReadonlyArray<readonly [number, Color]>;
  } = {},
): Field {
  const { domain = [0, 100], stops = COOL_WARM } = options;
  return colormap(
    linear(attribute("bfactor"), { domain, overflow: "clamp" }),
    stops,
  );
}

/** Colour atoms by residue index over `domain` on a rainbow ramp. Pass
 *  `columnRange(data, 'residue')` (or [0, residueCount-1]) as `domain`. */
export function bySeq(
  options: {
    domain?: readonly [number, number];
    stops?: ReadonlyArray<readonly [number, Color]>;
  } = {},
): Field {
  const { domain = [0, 1], stops = RAINBOW } = options;
  return colormap(
    linear(attribute("residue"), { domain, overflow: "clamp" }),
    stops,
  );
}

/** Colour atoms by chain from a cyclic palette. Chains beyond the palette take
 *  `fallback`. Pass a longer `palette` for more distinct chains. */
export function byChain(
  options: { palette?: ReadonlyArray<Color>; fallback?: Color } = {},
): Field {
  const { palette = CHAIN_CYCLE, fallback = [0.6, 0.6, 0.6, 1] } = options;
  return categorical(
    attribute("atomChain"),
    Object.fromEntries(palette.map((c, i) => [i, c])),
    fallback,
  );
}

/**
 * Colour atoms by charge in elementary charges over `domain` (default
 * [-1, 1]) on Mol*'s partial-charge scale: red negative, white 0, blue
 * positive. `column` reads another charge column, such as `formalCharge` or a
 * custom residue net-charge column with `lift: true`.
 */
export function byCharge(
  options: {
    domain?: readonly [number, number];
    stops?: ReadonlyArray<readonly [number, Color]>;
    column?: string;
    lift?: boolean;
  } = {},
): Field {
  const {
    domain = [-1, 1],
    stops = RED_WHITE_BLUE,
    column = "partialCharge",
    lift,
  } = options;
  if (!(domain[0] < domain[1])) {
    throw new TypeError("@molgpu/fields byCharge: expected domain [lo, hi]");
  }
  return colormap(
    linear(attribute(column, { domain: "atom", lift }), {
      domain,
      overflow: "clamp",
    }),
    stops,
  );
}

/**
 * Colour by electrostatic potential: red negative, white 0, blue positive
 * (the APBS/PyMOL convention, `byCharge`'s stops) over ±`range` (default 15, in
 * the volume's unit: kT/e for `<EField>`'s default distance model; use about
 * 2 for `debye`). It samples `volume` at each
 * row's position, or the nearest viewer volume when omitted (GPU-only), so a
 * `<Surface>` or `<Spacefill>` under `<EField>` follows the live potential.
 */
export function byPotential(
  options: {
    range?: number;
    stops?: ReadonlyArray<readonly [number, Color]>;
    volume?: VolumeData;
  } = {},
): Field {
  const { range = 15, stops = RED_WHITE_BLUE, volume } = options;
  if (!Number.isFinite(range) || range <= 0) {
    throw new TypeError("@molgpu/fields byPotential: expected range > 0");
  }
  return colormap(
    linear(volumeSample(volume), {
      domain: [-range, range],
      overflow: "clamp",
    }),
    stops,
  );
}

const hex = (c: number): Color => [
  ((c >> 16) & 255) / 255,
  ((c >> 8) & 255) / 255,
  (c & 255) / 255,
  1,
];
// Mol*'s secondary-structure theme colours, by ssCode (table's SS_CODES).
const SECONDARY_STRUCTURE: Record<number, Color> = {
  0: hex(0xffffff), // coil
  1: hex(0xff0080), // H alpha helix
  2: hex(0xffc800), // B bridge
  3: hex(0xffc800), // E strand
  4: hex(0xa00080), // G 3-10 helix
  5: hex(0x600080), // I pi helix
  6: hex(0x00b266), // T turn
  7: hex(0x66d8c9), // S bend
};

/**
 * Colour atoms by their residue's `ssCode` with Mol*'s secondary-structure
 * theme colours: alpha, 3-10 and pi helices, strands, turns, bends and white
 * coil. Codes without a colour take `fallback` (Mol*'s default grey).
 */
export function bySecondaryStructure(
  fallback: Color = hex(0x808080),
): Field {
  return categorical(
    attribute("ssCode", { domain: "atom" }),
    SECONDARY_STRUCTURE,
    fallback,
  );
}
