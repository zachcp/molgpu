import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline, createCurve, sample } from '../src/index.mjs';

test('named beats use explicit seconds and reject ambiguity', () => {
  const timeline = createTimeline([{ name: 'intro', time: 0 }, { name: 'site', time: 2.5 }]);
  assert.equal(timeline.time('site'), 2.5);
  assert.equal(timeline.unit, 'seconds');
  assert.throws(() => timeline.time('missing'));
  assert.throws(() => createTimeline([{ name: 'a', time: 1 }, { name: 'a', time: 2 }]));
  assert.throws(() => createTimeline([{ name: 'a', time: 1 }, { name: 'b', time: 1 }]));
});

test('sampling is reversible, deterministic and clamps outside endpoints', () => {
  const curve = createCurve([{ time: 0, value: 0 }, { time: 2, value: 8 }]);
  assert.deepEqual([sample(curve, 0), sample(curve, 1), sample(curve, 2)], [0, 4, 8]);
  assert.deepEqual([sample(curve, 1.5), sample(curve, 0.5), sample(curve, 1.5)], [6, 2, 6]);
  assert.deepEqual([sample(curve, -10), sample(curve, 10)], [0, 8]);
});

test('hold switches at the beat and loop wraps in both directions', () => {
  const curve = createCurve([{ time: 0, value: 1, ease: 'hold' }, { time: 2, value: 3 }, { time: 4, value: 5 }], { extrapolate: 'loop' });
  assert.equal(sample(curve, 1.999), 1);
  assert.equal(sample(curve, 2), 3);
  assert.equal(sample(curve, 4), 1);
  assert.equal(sample(curve, -0.25), 4.75);
});

test('vector samples own their values and automatic interpolation is sampleable', () => {
  const curve = createCurve([{ time: 0, value: [0, 0] }, { time: 1, value: [2, 4] }]);
  const a = sample(curve, 0.5);
  assert.deepEqual(Array.from(a), [1, 2]);
  a[0] = 100;
  assert.deepEqual(Array.from(sample(curve, 0.5)), [1, 2]);
  const smooth = createCurve([{ time: 0, value: 0 }, { time: 1, value: 1 }, { time: 2, value: 0 }], { automatic: true });
  assert.equal(sample(smooth, 0), 0);
  assert.equal(sample(smooth, 2), 0);
  assert.ok(Number.isFinite(sample(smooth, 0.5)));
});

test('automatic curves handle zero knots, flat beats, and vectors without translation', () => {
  const explicit = createCurve([{ time: 0, value: 0, knots: [0, 0] }, { time: 1, value: 1 }]);
  assert.ok(Number.isFinite(sample(explicit, 0.5)));
  const scalar = createCurve([{ time: 0, value: 0 }, { time: 1, value: 0 }, { time: 2, value: 1 }], { automatic: true });
  assert.deepEqual([sample(scalar, 0), sample(scalar, 0.5), sample(scalar, 1), sample(scalar, 2)], [0, 0, 0, 1]);
  const vector = createCurve([{ time: 0, value: [0, 0] }, { time: 1, value: [1, 2] }, { time: 2, value: [0, 0] }], { automatic: true });
  assert.deepEqual(Array.from(sample(vector, 1)), [1, 2]);
  assert.ok(Array.from(sample(vector, 0.5)).every(Number.isFinite));
});

test('angle sampling follows the short arc through the wrap boundary', () => {
  const curve = createCurve([{ time: 0, value: 0 }, { time: 1, value: 4 }], { type: 'angle' });
  assert.ok(sample(curve, 0.5) < 0);
  const smooth = createCurve([{ time: 0, value: 0 }, { time: 1, value: 4 }, { time: 2, value: 0 }], { type: 'angle', automatic: true });
  assert.ok(Number.isFinite(sample(smooth, 0.5)));
  assert.equal(sample(smooth, 2), 0);
});
