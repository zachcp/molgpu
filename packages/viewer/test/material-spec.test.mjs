import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaterial, materialTypes } from '../src/internal/material-spec.ts';

// The material components themselves reach @use-gpu/workbench, which Node cannot
// import; the pure spec resolution lives here so withMaterial's decision logic
// is unit-tested, and the actual MaterialContext wiring is asserted in the
// browser runner (run-materials.mjs).

test('null/undefined resolve to no material', () => {
  assert.deepEqual(resolveMaterial(null), { kind: 'none' });
  assert.deepEqual(resolveMaterial(undefined), { kind: 'none' });
});

test('a function is a wrapper escape hatch, returned as-is', () => {
  const wrap = (children) => children;
  const resolved = resolveMaterial(wrap);
  assert.equal(resolved.kind, 'wrap');
  assert.equal(resolved.wrap, wrap);
});

test('a bare spec defaults to the pbr type and forwards the rest as props', () => {
  const resolved = resolveMaterial({ metalness: 0.8, roughness: 0.2 });
  assert.equal(resolved.kind, 'material');
  assert.equal(resolved.type, 'pbr');
  assert.deepEqual(resolved.props, { metalness: 0.8, roughness: 0.2 });
});

test('an explicit type is honoured and not left in props', () => {
  const resolved = resolveMaterial({ type: 'basic', color: [1, 0, 0, 1] });
  assert.equal(resolved.type, 'basic');
  assert.deepEqual(resolved.props, { color: [1, 0, 0, 1] });
});

test('every advertised material type resolves', () => {
  for (const type of materialTypes) {
    assert.equal(resolveMaterial({ type }).type, type);
  }
});

test('an unknown type throws, naming the valid set', () => {
  assert.throws(() => resolveMaterial({ type: 'glass' }), /Unknown material type 'glass'.*pbr/);
});

test('a non-spec, non-function value throws', () => {
  assert.throws(() => resolveMaterial([1, 2, 3]), /spec object, a wrapper function, or null/);
  assert.throws(() => resolveMaterial(42), /spec object, a wrapper function, or null/);
});
