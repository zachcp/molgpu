import test from 'node:test';
import assert from 'node:assert/strict';
import { checkOpacity, applyOpacity, flatAlpha, modeProps } from '../src/internal/opacity.mjs';

test('opacity multiplies a flat colour alpha, and is the identity at 1', () => {
  const color = [0.2, 0.4, 0.6, 0.5];
  assert.equal(applyOpacity(color, 1), color); // same object: no new binding value
  assert.deepEqual(applyOpacity(color, 0.5), [0.2, 0.4, 0.6, 0.25]);
  assert.deepEqual(applyOpacity([1, 0, 0], 0.3), [1, 0, 0, 0.3]); // rgb is alpha 1
  assert.deepEqual(applyOpacity(Float32Array.of(1, 1, 1, 1), 0), [1, 1, 1, 0]);
});

test('effective alpha below 1 selects transparent mode; an explicit mode wins', () => {
  assert.deepEqual(modeProps(undefined, 1), {});
  assert.deepEqual(modeProps(undefined, 0.99), { mode: 'transparent' });
  assert.deepEqual(modeProps('opaque', 0.3), { mode: 'opaque' });
  assert.deepEqual(modeProps('transparent', 1), { mode: 'transparent' });
});

test('a field colour contributes alpha 1 (only opacity decides its mode)', () => {
  assert.equal(flatAlpha([1, 1, 1, 0.2], true), 1);
  assert.equal(flatAlpha([1, 1, 1, 0.2], false), 0.2);
  assert.equal(flatAlpha([1, 1, 1], false), 1);
});

test('opacity must be a number in [0, 1]', () => {
  for (const ok of [0, 0.5, 1]) assert.equal(checkOpacity(ok, 'X'), ok);
  for (const bad of [-0.1, 1.5, NaN, '0.5', undefined, null]) {
    assert.throws(() => checkOpacity(bad, 'Surface'), /Surface opacity must be a number in \[0, 1\]/);
  }
});
