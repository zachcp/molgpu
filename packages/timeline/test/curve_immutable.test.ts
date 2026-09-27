import { assert, assertEquals, assertThrows } from "@std/assert";
import { createCurve, sample } from "../src/index.ts";

Deno.test("curves expose only frozen public metadata and copy their inputs", () => {
  const firstValue = [0, 2];
  const secondValue = [4, 6];
  const firstKnot = [1, 3];
  const secondKnot = [3, 5];
  const curve = createCurve([
    {
      time: 0,
      value: firstValue,
      knots: [firstKnot, secondKnot],
    },
    { time: 1, value: secondValue },
  ]);
  const expected = sample(curve, 0.5);

  firstValue[0] = 100;
  secondValue[1] = 100;
  firstKnot[0] = 100;
  secondKnot[1] = 100;

  assertEquals(sample(curve, 0.5), expected);
  assertEquals(Object.keys(curve), ["unit", "type", "extrapolate"]);
  assert(Object.isFrozen(curve));
  assertThrows(() => sample({ ...curve } as typeof curve, 0.5));
});
