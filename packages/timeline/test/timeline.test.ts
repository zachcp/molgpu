import { assert, assertEquals, assertStrictEquals, assertThrows } from '@std/assert';
import { createTimeline, createCurve, sample } from '../src/index.ts';

Deno.test('named beats use explicit seconds and reject ambiguity', () => {
  const timeline = createTimeline([{ name: 'intro', time: 0 }, { name: 'site', time: 2.5 }]);
  assertStrictEquals(timeline.time('site'), 2.5);
  assertStrictEquals(timeline.unit, 'seconds');
  assertThrows(() => timeline.time('missing'));
  assertThrows(() => createTimeline([{ name: 'a', time: 1 }, { name: 'a', time: 2 }]));
  assertThrows(() => createTimeline([{ name: 'a', time: 1 }, { name: 'b', time: 1 }]));
});

Deno.test('sampling is reversible, deterministic and clamps outside endpoints', () => {
  const curve = createCurve([{ time: 0, value: 0 }, { time: 2, value: 8 }]);
  assertEquals([sample(curve, 0), sample(curve, 1), sample(curve, 2)], [0, 4, 8]);
  assertEquals([sample(curve, 1.5), sample(curve, 0.5), sample(curve, 1.5)], [6, 2, 6]);
  assertEquals([sample(curve, -10), sample(curve, 10)], [0, 8]);
});

Deno.test('hold switches at the beat and loop wraps in both directions', () => {
  const curve = createCurve([{ time: 0, value: 1, ease: 'hold' }, { time: 2, value: 3 }, { time: 4, value: 5 }], { extrapolate: 'loop' });
  assertStrictEquals(sample(curve, 1.999), 1);
  assertStrictEquals(sample(curve, 2), 3);
  assertStrictEquals(sample(curve, 4), 1);
  assertStrictEquals(sample(curve, -0.25), 4.75);
});

Deno.test('vector samples own their values and automatic interpolation is sampleable', () => {
  const curve = createCurve([{ time: 0, value: [0, 0] }, { time: 1, value: [2, 4] }]);
  const a = sample(curve, 0.5);
  assertEquals(Array.from(a), [1, 2]);
  a[0] = 100;
  assertEquals(Array.from(sample(curve, 0.5)), [1, 2]);
  const smooth = createCurve([{ time: 0, value: 0 }, { time: 1, value: 1 }, { time: 2, value: 0 }], { automatic: true });
  assertStrictEquals(sample(smooth, 0), 0);
  assertStrictEquals(sample(smooth, 2), 0);
  assert(Number.isFinite(sample(smooth, 0.5)));
});

Deno.test('automatic curves handle zero knots, flat beats, and vectors without translation', () => {
  const explicit = createCurve([{ time: 0, value: 0, knots: [0, 0] }, { time: 1, value: 1 }]);
  assert(Number.isFinite(sample(explicit, 0.5)));
  const scalar = createCurve([{ time: 0, value: 0 }, { time: 1, value: 0 }, { time: 2, value: 1 }], { automatic: true });
  assertEquals([sample(scalar, 0), sample(scalar, 0.5), sample(scalar, 1), sample(scalar, 2)], [0, 0, 0, 1]);
  const vector = createCurve([{ time: 0, value: [0, 0] }, { time: 1, value: [1, 2] }, { time: 2, value: [0, 0] }], { automatic: true });
  assertEquals(Array.from(sample(vector, 1)), [1, 2]);
  assert(Array.from(sample(vector, 0.5)).every(Number.isFinite));
});

Deno.test('angle sampling follows the short arc through the wrap boundary', () => {
  const curve = createCurve([{ time: 0, value: 0 }, { time: 1, value: 4 }], { type: 'angle' });
  assert(sample(curve, 0.5) < 0);
  const smooth = createCurve([{ time: 0, value: 0 }, { time: 1, value: 4 }, { time: 2, value: 0 }], { type: 'angle', automatic: true });
  assert(Number.isFinite(sample(smooth, 0.5)));
  assertStrictEquals(sample(smooth, 2), 0);
});
