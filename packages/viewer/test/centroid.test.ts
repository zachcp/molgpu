import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import type { StructureData } from "@molgpu/table";
import {
  centroidOf,
  distanceBetween,
  midpoint,
} from "../src/representations/centroid.ts";

// The <Label>/<Distance> components reach @use-gpu/workbench (labels need a
// font atlas), asserted in the browser runner; the anchor math lives here.

// The anchor math reads only positions and the atom count.
const data = {
  positions: Float32Array.of(0, 0, 0, 2, 0, 0, 0, 6, 0, 0, 0, 9),
  topology: { atoms: { count: 4 } },
} as unknown as StructureData;

Deno.test("centroid of the whole structure is the mean of every atom", () => {
  assertEquals(centroidOf(data, null), [0.5, 1.5, 2.25]);
});

Deno.test("centroid of a selection uses only its rows", () => {
  assertEquals(centroidOf(data, Uint32Array.of(0, 1)), [1, 0, 0]);
  assertEquals(centroidOf(data, Uint32Array.of(2)), [0, 6, 0]);
});

Deno.test("an empty set or out-of-range row throws rather than anchoring at NaN", () => {
  assertThrows(
    () => centroidOf(data, Uint32Array.of()),
    Error,
    "empty atom set",
  );
  assertThrows(
    () => centroidOf(data, Uint32Array.of(9)),
    Error,
    "out of range",
  );
});

Deno.test("distanceBetween is Euclidean", () => {
  assertStrictEquals(distanceBetween([0, 0, 0], [3, 4, 0]), 5);
  assertStrictEquals(distanceBetween([1, 2, 3], [1, 2, 3]), 0);
});

Deno.test("midpoint is the average of two points", () => {
  assertEquals(midpoint([0, 0, 0], [2, 4, 6]), [1, 2, 3]);
});
