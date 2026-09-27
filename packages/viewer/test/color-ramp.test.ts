import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  colorRampWgsl,
  wgslF32,
  wgslVec4,
} from "../src/internal/color-ramp.ts";

Deno.test("WGSL color ramp uses shared scalar and vector formatting", () => {
  assertEquals(wgslF32(1), "1.0");
  assertEquals(wgslF32(0.25), "0.25");
  assertEquals(wgslVec4([1, 0.5, 0, 1]), "vec4<f32>(1.0, 0.5, 0.0, 1.0)");
});

Deno.test("WGSL color ramp preserves stop endpoints and interpolation", () => {
  const ramp = colorRampWgsl([
    [0, [1, 0, 0, 1]],
    [0.5, [1, 1, 1, 1]],
    [1, [0, 0, 1, 1]],
  ]);
  assertStringIncludes(ramp, "if (x <= 0.0)");
  assertStringIncludes(ramp, "if (x <= 0.5)");
  assertStringIncludes(ramp, "(x - 0.0) / 0.5");
  assertStringIncludes(ramp, "if (x <= 1.0)");
  assertStringIncludes(ramp, "return vec4<f32>(0.0, 0.0, 1.0, 1.0);");
});

Deno.test("WGSL color ramp with no stops remains flat white", () => {
  assertEquals(colorRampWgsl(null), "  return vec4<f32>(1.0);");
});
