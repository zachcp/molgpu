import type { ColorStops, Translucency, VectorLike } from "../../types.ts";
import type { SlicePlane } from "./slice-plane.ts";
import { checkOpacity } from "../../rendering/opacity.ts";
import { checkColorRange, checkColorStops } from "./color-ramp.ts";

/** Caller options for a live scalar-volume slice. */
export type VolumeSliceProps = {
  /** Defaults to the middle k (third-axis) grid plane. */
  plane?: SlicePlane;
  /** Value interval mapped to 0–1. Defaults to the volume's min and max. */
  range?: readonly [number, number];
  /** Colour stops over 0–1. Defaults to black → white. */
  stops?: ColorStops;
  /** Multiplied into every fragment's colour. Defaults to white. */
  color?: VectorLike;
} & Translucency;

const GREYS: ColorStops = [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]];

/** Slices retain distinct descending ranges and require at least two stops. */
export function normalizeVolumeSliceOptions(
  { plane, range, stops = GREYS, color = [1, 1, 1, 1], opacity = 1, mode }:
    VolumeSliceProps,
  fallback: readonly [number, number],
) {
  checkOpacity(opacity, "VolumeSlice");
  const interval = range ?? fallback;
  checkColorRange(interval, "VolumeSlice", false);
  checkColorStops(stops, "VolumeSlice", 2);
  return { plane, range: interval, stops, color, opacity, mode };
}
