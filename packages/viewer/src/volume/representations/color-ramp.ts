import type { ColorStops } from "../../types.ts";

const finite = (value: number) =>
  typeof value === "number" && Number.isFinite(Math.fround(value));

/** Shared immutable defaults for field-strength ramps. */
export const FIELD_STOPS: ColorStops = [
  [0, [0.25, 0.35, 1, 1]],
  [1, [1, 0.85, 0.2, 1]],
];

/** Finite shader inputs; descending intervals are valid only for slices. */
export function checkColorRange(
  range: readonly [number, number],
  who: string,
  ascending = true,
): void {
  const [lo, hi] = range;
  const low = Math.fround(lo), high = Math.fround(hi);
  const width = Math.fround(high - low);
  if (
    !finite(lo) || !finite(hi) ||
    !Number.isFinite(width) ||
    (ascending ? !(width > 0) : width === 0)
  ) {
    throw new TypeError(
      `${who}: range must contain two distinct finite f32 values with finite nonzero f32 width${
        ascending ? " with lo < hi" : ""
      }`,
    );
  }
}

/** Single stops and duplicate positions remain supported; callers sort a copy. */
export function checkColorStops(
  stops: ColorStops,
  who: string,
  minimum = 1,
): void {
  if (
    !Array.isArray(stops) || stops.length < minimum ||
    Array.from(stops).some((stop) =>
      !Array.isArray(stop) || stop.length !== 2 ||
      !finite(stop[0]) ||
      !Array.isArray(stop[1]) || stop[1].length !== 4 ||
      [0, 1, 2, 3].some((i) => !finite(stop[1][i]))
    )
  ) {
    throw new TypeError(
      `${who}: stops needs at least ${minimum} [finite position, finite RGBA] entries`,
    );
  }
}

/** Format a JavaScript number as a WGSL f32 literal. */
export const wgslF32 = (value: number): string => {
  if (!finite(value)) {
    throw new TypeError("WGSL literal must be a finite f32 value");
  }
  const result = `${Math.fround(value)}`;
  return /[.e]/.test(result) ? result : `${result}.0`;
};

/** Format an RGBA value as a WGSL vec4 literal. */
export const wgslVec4 = (color: readonly number[]): string =>
  `vec4<f32>(${color.map(wgslF32).join(", ")})`;

/** Generate the shared piecewise-linear ramp body; null means flat white. */
export function colorRampWgsl(stops: ColorStops | null): string {
  if (!stops) return "  return vec4<f32>(1.0);";
  checkColorStops(stops, "Color ramp");

  let ramp = `  if (x <= ${wgslF32(stops[0][0])}) { return ${
    wgslVec4(stops[0][1])
  }; }\n`;
  for (let i = 1; i < stops.length; i++) {
    const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
    ramp += `  if (x <= ${wgslF32(t1)}) { return mix(${wgslVec4(c0)}, ${
      wgslVec4(c1)
    }, (x - ${wgslF32(t0)}) / ${wgslF32(Math.max(t1 - t0, 1e-12))}); }\n`;
  }
  return ramp + `  return ${wgslVec4(stops[stops.length - 1][1])};`;
}
