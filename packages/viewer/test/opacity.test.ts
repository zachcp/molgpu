import {
  assertEquals,
  assertMatch,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  applyOpacity,
  checkOpacity,
  flatAlpha,
  modeProps,
} from "../src/rendering/opacity.ts";

Deno.test("opacity multiplies a flat colour alpha, and is the identity at 1", () => {
  const color = [0.2, 0.4, 0.6, 0.5];
  assertStrictEquals(applyOpacity(color, 1), color); // same object: no new binding value
  assertEquals(applyOpacity(color, 0.5), [0.2, 0.4, 0.6, 0.25]);
  assertEquals(applyOpacity([1, 0, 0], 0.3), [1, 0, 0, 0.3]); // rgb is alpha 1
  assertEquals(applyOpacity(Float32Array.of(1, 1, 1, 1), 0), [1, 1, 1, 0]);
});

Deno.test("effective alpha below 1 selects transparent mode; an explicit mode wins", () => {
  assertEquals(modeProps(undefined, 1), {});
  assertEquals(modeProps(undefined, 0.99), { mode: "transparent" });
  assertEquals(modeProps("opaque", 0.3), { mode: "opaque" });
  assertEquals(modeProps("transparent", 1), { mode: "transparent" });
});

Deno.test("a field colour contributes alpha 1 (only opacity decides its mode)", () => {
  assertStrictEquals(flatAlpha([1, 1, 1, 0.2], true), 1);
  assertStrictEquals(flatAlpha([1, 1, 1, 0.2], false), 0.2);
  assertStrictEquals(flatAlpha([1, 1, 1], false), 1);
});

Deno.test("opacity must be a number in [0, 1]", () => {
  for (const ok of [0, 0.5, 1]) assertStrictEquals(checkOpacity(ok, "X"), ok);
  for (const bad of [-0.1, 1.5, NaN, "0.5", undefined, null]) {
    assertMatch(
      (assertThrows(() => checkOpacity(bad, "Surface"), Error)).message,
      /Surface opacity must be a number in \[0, 1\]/,
    );
  }
});
