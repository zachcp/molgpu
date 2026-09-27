import { assertEquals, assertThrows } from "@std/assert";
import {
  applyNormalMode,
  normalModeWgsl,
  validateNormalMode,
} from "../src/index.ts";

Deno.test("normal mode follows residue mapping and reverses under scrubbing", () => {
  const positions = Float32Array.of(1, 0, 0, 2, 0, 0, 3, 0, 0);
  const mode = {
    vectors: Float32Array.of(1, 2, 3),
    atomToNode: Uint32Array.of(0, 0, 0xffffffff),
    version: 1,
  };
  assertEquals([...applyNormalMode(positions, mode, 2, 1, 0.25)], [
    3,
    4,
    6,
    4,
    4,
    6,
    3,
    0,
    0,
  ]);
  assertEquals([...applyNormalMode(positions, mode, 2, 1, 0.75)], [
    -1,
    -4,
    -6,
    0,
    -4,
    -6,
    3,
    0,
    0,
  ]);
  assertEquals([...applyNormalMode(positions, mode, 2, 1, 0)], [...positions]);
  assertEquals([...positions], [1, 0, 0, 2, 0, 0, 3, 0, 0]);
  const swapped = { ...mode, vectors: Float32Array.of(0, 0, 5), version: 2 };
  assertEquals([...applyNormalMode(positions, swapped, 2, 1, 0.25)], [
    1,
    0,
    10,
    2,
    0,
    10,
    3,
    0,
    0,
  ]);
});

Deno.test("normal mode validates mapping and WGSL source", () => {
  const mode = {
    vectors: Float32Array.of(1, 0, 0),
    atomToNode: Uint32Array.of(1),
    version: 1,
  };
  assertThrows(() => validateNormalMode(mode, 1), TypeError, "mapping");
  assertThrows(
    () =>
      applyNormalMode(
        Float32Array.of(0, 0, 0),
        { ...mode, atomToNode: Uint32Array.of(0) },
        NaN,
        1,
        0,
      ),
    TypeError,
  );
  assertThrows(
    () =>
      applyNormalMode(
        Float32Array.of(NaN, 0, 0),
        { ...mode, atomToNode: Uint32Array.of(0) },
        1,
        1,
        0,
      ),
    TypeError,
    "positions must be finite",
  );
  if (
    !normalModeWgsl.includes("getScale()") ||
    !normalModeWgsl.includes("0xffffffffu")
  ) {
    throw new Error(
      "normal mode WGSL is missing its uniform or absent mapping",
    );
  }
});
