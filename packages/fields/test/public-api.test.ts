import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  annotation,
  COLOR,
  columnRange,
  evaluate,
  SCALAR,
} from "../src/index.ts";
import { structure } from "./fixture.ts";

Deno.test("root API constructs scalar and color annotations", () => {
  const data = structure();
  const scalar = annotation("atom", SCALAR, Float32Array.of(1, 2, 3, 4));
  const color = annotation(
    "atom",
    COLOR,
    Float32Array.of(1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1),
  );

  assertStrictEquals(scalar.domain, "atom");
  assertEquals([...evaluate(scalar, data)], [1, 2, 3, 4]);
  assertStrictEquals(color.domain, "atom");
  assertEquals([...evaluate(color, data)], [
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    1,
    0,
    0,
    1,
    1,
    1,
    1,
    1,
    1,
  ]);
});

Deno.test("root API exposes range calculation for documented built-ins", () => {
  assertEquals(columnRange(structure(), "bfactor"), [10, 40]);
});
