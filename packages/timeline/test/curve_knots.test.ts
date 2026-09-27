import { assertEquals, assertThrows } from "@std/assert";
import { createCurve, type Keyframe, sample } from "../src/index.ts";

const scalarCurve = (knots: unknown) =>
  createCurve([
    { time: 0, value: 0, knots } as unknown as Keyframe<number>,
    { time: 1, value: 1 },
  ]);

const vectorCurve = (knots: unknown) =>
  createCurve([
    {
      time: 0,
      value: [0, 0],
      knots,
    } as unknown as Keyframe<number[]>,
    { time: 1, value: [1, 2] },
  ]);

Deno.test("explicit scalar knots require two finite scalar controls", () => {
  assertThrows(() => scalarCurve([0]));
  assertThrows(() => scalarCurve([[0], [1]]));
  assertThrows(() => scalarCurve([0, Infinity]));
  assertEquals(sample(scalarCurve([0, 1]), 0.5), 0.5);
});

Deno.test("explicit vector knots match vector width and contain finite values", () => {
  assertThrows(() => vectorCurve([[0, 0]]));
  assertThrows(() => vectorCurve([[0, 0], [1]]));
  assertThrows(() => vectorCurve([[0, 0], [1, NaN]]));
  assertEquals(
    Array.from(sample(vectorCurve([new Float32Array([0, 0]), [1, 2]]), 0.5)),
    [0.5, 1],
  );
});
