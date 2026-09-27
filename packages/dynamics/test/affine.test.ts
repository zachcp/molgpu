import { assertEquals, assertThrows } from "@std/assert";
import {
  affineSelectedWgsl,
  affineWgsl,
  isIdentityAffine,
} from "../src/wgsl.ts";
import { applyAffine } from "../src/affine.ts";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

Deno.test("column-major affine moves selected rows and leaves others exact", () => {
  const positions = Float32Array.of(1, 2, 3, 4, 5, 6, -1, 0, 2);
  // A quarter turn about Z, then translate by (10, 20, 30).
  const matrix = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1];
  const result = applyAffine(positions, matrix, Uint32Array.of(0, 2));
  assertEquals([...result], [8, 21, 33, 4, 5, 6, 10, 19, 32]);
  assertEquals([...positions], [1, 2, 3, 4, 5, 6, -1, 0, 2]);
  assertEquals([...applyAffine(positions, matrix, [])], [...positions]);
  assertEquals([...applyAffine(positions, matrix)], [
    8,
    21,
    33,
    5,
    24,
    36,
    10,
    19,
    32,
  ]);
});

Deno.test("affine validation excludes perspective and stale row maps", () => {
  assertEquals(isIdentityAffine(identity), true);
  assertEquals(isIdentityAffine([...identity.slice(0, 12), 1, 0, 0, 1]), false);
  assertThrows(() => applyAffine(new Float32Array(4), identity), TypeError);
  assertThrows(
    () => applyAffine(Float32Array.of(NaN, 0, 0), identity),
    TypeError,
  );
  assertThrows(
    () => applyAffine(Float32Array.of(0, 0, 0), identity.slice(0, 15)),
    TypeError,
  );
  assertThrows(
    () =>
      applyAffine(Float32Array.of(0, 0, 0), [
        ...identity.slice(0, 3),
        0.5,
        ...identity.slice(4),
      ]),
    TypeError,
    "[0, 0, 0, 1]",
  );
  assertThrows(
    () => applyAffine(Float32Array.of(0, 0, 0), identity, [0, 0]),
    TypeError,
  );
  assertThrows(
    () => applyAffine(Float32Array.of(0, 0, 0), identity, [1]),
    TypeError,
  );
});

Deno.test("WGSL variants use the same transform and selected variant uses a bitset", () => {
  for (const source of [affineWgsl, affineSelectedWgsl]) {
    assertEquals(source.includes("getColumn0() * p.x"), true);
    assertEquals(source.includes("output[i * 3u] = q.x"), true);
  }
  assertEquals(affineSelectedWgsl.includes("getMask(i >> 5u)"), true);
});
