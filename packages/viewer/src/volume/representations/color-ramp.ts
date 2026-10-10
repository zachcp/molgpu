import type { ColorStops } from "../../types.ts";

/** Format a JavaScript number as a WGSL f32 literal. */
export const wgslF32 = (value: number): string => {
  const result = `${Math.fround(value)}`;
  return /[.e]/.test(result) ? result : `${result}.0`;
};

/** Format an RGBA value as a WGSL vec4 literal. */
export const wgslVec4 = (color: readonly number[]): string =>
  `vec4<f32>(${color.map(wgslF32).join(", ")})`;

/** Generate the shared piecewise-linear ramp body; null means flat white. */
export function colorRampWgsl(stops: ColorStops | null): string {
  if (!stops) return "  return vec4<f32>(1.0);";

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
