import test from 'node:test';
import assert from 'node:assert/strict';
import { centroidOf, distanceBetween, midpoint } from '../src/internal/centroid.ts';

// The <Label>/<Distance> components reach @use-gpu/workbench (labels need a
// font atlas), asserted in the browser runner; the anchor math lives here.

const data = {
  positions: Float32Array.of(0,0,0, 2,0,0, 0,6,0, 0,0,9),
  topology: { atoms: { count: 4 } },
};

test('centroid of the whole structure is the mean of every atom', () => {
  assert.deepEqual(centroidOf(data, null), [0.5, 1.5, 2.25]);
});

test('centroid of a selection uses only its rows', () => {
  assert.deepEqual(centroidOf(data, Uint32Array.of(0, 1)), [1, 0, 0]);
  assert.deepEqual(centroidOf(data, Uint32Array.of(2)), [0, 6, 0]);
});

test('an empty set or out-of-range row throws rather than anchoring at NaN', () => {
  assert.throws(() => centroidOf(data, Uint32Array.of()), /empty atom set/);
  assert.throws(() => centroidOf(data, Uint32Array.of(9)), /out of range/);
});

test('distanceBetween is Euclidean', () => {
  assert.equal(distanceBetween([0, 0, 0], [3, 4, 0]), 5);
  assert.equal(distanceBetween([1, 2, 3], [1, 2, 3]), 0);
});

test('midpoint is the average of two points', () => {
  assert.deepEqual(midpoint([0, 0, 0], [2, 4, 6]), [1, 2, 3]);
});
