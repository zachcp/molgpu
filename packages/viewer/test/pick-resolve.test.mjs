import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePick } from '../src/internal/pick-resolve.ts';

// The live picking hook and the GPU readback are exercised in the browser
// runner; this covers the pure sample -> atom resolution.

const registry = new Map([
  [7, { resource: 'R-all', indices: null }],
  [9, { resource: 'R-sel', indices: Uint32Array.of(4, 11, 20) }],
]);
const get = (id) => registry.get(id) ?? null;

test('no sample, or a too-short sample, resolves to null', () => {
  assert.equal(resolvePick(null, get), null);
  assert.equal(resolvePick([5], get), null);
});

test('object id 0 is the background clear value', () => {
  assert.equal(resolvePick([0, 3], get), null);
});

test('an id not in the registry resolves to null', () => {
  assert.equal(resolvePick([42, 3], get), null);
});

test('a whole-structure pickable maps instance index straight to the atom row', () => {
  assert.deepEqual(resolvePick([7, 3], get), { id: 7, resource: 'R-all', atom: 3, instance: 3 });
});

test('a selection pickable maps the instance index through its indices', () => {
  assert.deepEqual(resolvePick([9, 2], get), { id: 9, resource: 'R-sel', atom: 20, instance: 2 });
});

test('an instance index outside the selection resolves to null', () => {
  assert.equal(resolvePick([9, 3], get), null);
  assert.equal(resolvePick([9, -1], get), null);
});
