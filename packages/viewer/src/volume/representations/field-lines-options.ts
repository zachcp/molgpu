import type { ColorStops, Translucency, VectorLike } from "../../types.ts";
import { checkOpacity } from "../../rendering/opacity.ts";
import { checkColorRange, checkColorStops, FIELD_STOPS } from "./color-ramp.ts";

/** Caller options for GPU-integrated field lines; distances are in angstroms. */
export type FieldLinesProps = {
  /** Packed xyz seeds or a lattice; default spacing 4 Å. */
  seeds?: Float32Array | { readonly spacing?: number };
  /** Seed ceiling; default 4096. Explicit excess seeds are rejected. */
  maxLines?: number;
  /** Arc-length step in Å; default 0.25. */
  step?: number;
  /** Steps in each direction; default 128. */
  steps?: number;
  /** Stop below this field magnitude (volume units per Å); default 0.05. */
  minField?: number;
  /** Stop above this absolute potential; default ten times the volume display extent. */
  maxPotential?: number;
  /** RGB(A) tint; default white. */
  color?: VectorLike;
  /** Increasing field-magnitude range; omitted uses only the tint. */
  colorRange?: readonly [number, number];
  /** Field-strength ramp; default blue to yellow. Used only with colorRange. */
  stops?: ColorStops;
  /** Line width in pixels; default 2. */
  width?: number;
} & Translucency;

/** Resolve strict options, preserving borrowed seed and style arrays. */
export function normalizeFieldLinesOptions({
  seeds = { spacing: 4 },
  maxLines = 4096,
  step = 0.25,
  steps = 128,
  minField = 0.05,
  maxPotential,
  color = [1, 1, 1, 1],
  colorRange,
  stops = FIELD_STOPS,
  width = 2,
  opacity = 1,
  mode,
}: FieldLinesProps) {
  checkOpacity(opacity, "FieldLines");
  for (
    const [name, value] of [
      ["step", step],
      ["minField", minField],
      ["maxPotential", maxPotential ?? 1],
      ["width", width],
    ] as const
  ) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`FieldLines ${name} must be positive and finite`);
    }
  }
  if (!Number.isSafeInteger(steps) || steps < 1) {
    throw new TypeError("FieldLines steps must be a positive integer");
  }
  if (!Number.isSafeInteger(maxLines) || maxLines < 1) {
    throw new TypeError("FieldLines maxLines must be a positive integer");
  }
  if (colorRange) {
    checkColorRange(colorRange, "FieldLines");
    checkColorStops(stops, "FieldLines");
  }
  return {
    seeds,
    maxLines,
    step,
    steps,
    minField,
    maxPotential,
    color,
    colorRange,
    stops,
    width,
    opacity,
    mode,
  };
}
