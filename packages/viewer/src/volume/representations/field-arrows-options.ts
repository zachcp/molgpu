import type { ColorStops, Translucency, VectorLike } from "../../types.ts";
import { checkOpacity } from "../../rendering/opacity.ts";
import type { SlicePlane } from "./slice-plane.ts";
import { checkColorRange, checkColorStops, FIELD_STOPS } from "./color-ramp.ts";

/** Caller options for the live field glyphs; storage and bindings stay private. */
export type FieldArrowsProps = {
  /** Lattice plane; default the grid's middle k plane. */
  plane?: SlicePlane;
  /** Lattice spacing in Å; default 2. */
  spacing?: number;
  /** Arrow length in Å per unit field strength; default 1. */
  scale?: number;
  /** Length cap in Å; default 0.9 × spacing. */
  maxLength?: number;
  /** Hide weaker field magnitudes (volume units per Å); default 1e-3. */
  minField?: number;
  /** RGB(A) tint; default white. */
  color?: VectorLike;
  /** Field magnitude range (volume units per Å); omitted uses only the tint. */
  colorRange?: readonly [number, number];
  /** Strength colour ramp; default blue to yellow. Used with colorRange. */
  stops?: ColorStops;
  /** Line width in pixels; default 3. */
  width?: number;
} & Translucency;

/** Resolve defaults without copying borrowed arrays or changing their identity. */
export function normalizeFieldArrowsOptions({
  plane,
  spacing = 2,
  scale = 1,
  maxLength,
  minField = 1e-3,
  color = [1, 1, 1, 1],
  colorRange,
  stops = FIELD_STOPS,
  width = 3,
  opacity = 1,
  mode,
}: FieldArrowsProps) {
  checkOpacity(opacity, "FieldArrows");
  const cap = maxLength ?? 0.9 * spacing;
  for (
    const [name, value] of [
      ["spacing", spacing],
      ["scale", scale],
      ["maxLength", cap],
      ["minField", minField],
      ["width", width],
    ] as const
  ) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`FieldArrows ${name} must be positive and finite`);
    }
  }
  if (colorRange) {
    checkColorRange(colorRange, "FieldArrows");
    checkColorStops(stops, "FieldArrows");
  }
  return {
    plane,
    spacing,
    scale,
    maxLength: cap,
    minField,
    color,
    colorRange,
    stops,
    width,
    opacity,
    mode,
  };
}
