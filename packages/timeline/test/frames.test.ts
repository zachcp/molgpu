import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { createTimeline, frameCurve, frameTime, sample } from "../src/index.ts";

/** The frame a trajectory of `n` frames shows for a sampled curve value
 * (`<Trajectory>` snaps values within 1e-6 of an integer). */
const shown = (value: number, n: number) =>
  Math.min(Math.floor(value + 1e-6), n - 1);

Deno.test("frameCurve maps seconds to frames; every frame shows for 1/fps", () => {
  const curve = frameCurve({ frames: 10, fps: 5, start: 2 });
  assertEquals(sample(curve, 0), 0, "holds frame 0 before start");
  assertEquals(sample(curve, 2), 0);
  assertAlmostEquals(sample(curve, 2.3), 1.5);
  // Arbitrary, reversed and repeated samples agree with the formula.
  for (const t of [3.7, 2.01, 3.7, 3.99, 2.5]) {
    assertAlmostEquals(sample(curve, t), (t - 2) * 5, 1e-9);
  }
  // Frame i is on screen during [start + i/fps, start + (i+1)/fps).
  for (let i = 0; i < 10; i++) {
    assertEquals(
      shown(sample(curve, frameTime({ fps: 5, start: 2 }, i)), 10),
      i,
    );
    assertEquals(shown(sample(curve, 2 + (i + 0.99) / 5), 10), i);
  }
  assertEquals(shown(sample(curve, 100), 10), 9, "clamps to the last frame");
});

Deno.test("a looped frameCurve shows the last frame before wrapping", () => {
  const curve = frameCurve({ frames: 4, fps: 2, loop: true });
  assertEquals(shown(sample(curve, 1.6), 4), 3, "last frame for its full slot");
  assertEquals(sample(curve, 2), 0, "wraps to frame 0 at frames/fps");
  assertAlmostEquals(sample(curve, 2.75), 1.5);
  assertAlmostEquals(sample(curve, -0.25), 3.5, 1e-9);
});

Deno.test("frameTime places beats at frames", () => {
  const playback = { fps: 30, start: 1 };
  const timeline = createTimeline([
    { name: "open", time: frameTime(playback, 0) },
    { name: "bound", time: frameTime(playback, 45) },
  ]);
  assertEquals(timeline.time("bound"), 2.5);
  const curve = frameCurve({ frames: 90, ...playback });
  assertAlmostEquals(sample(curve, timeline.time("bound")), 45, 1e-9);
});

Deno.test("frameCurve and frameTime validate", () => {
  assertThrows(() => frameCurve({ frames: 0, fps: 1 }), TypeError);
  assertThrows(() => frameCurve({ frames: 2.5, fps: 1 }), TypeError);
  assertThrows(() => frameCurve({ frames: 2, fps: 0 }), RangeError);
  assertThrows(() => frameCurve({ frames: 2, fps: NaN }), TypeError);
  assertThrows(() => frameTime({ fps: 1 }, Infinity), TypeError);
});
