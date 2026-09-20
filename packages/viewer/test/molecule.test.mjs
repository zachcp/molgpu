import test from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../src/molecule.mjs';

// <Structure> and <Spacefill> reach @use-gpu/workbench, which Node cannot
// import; their contracts are asserted in the browser runner instead.
test('Molecule is a compositional boundary that owns nothing', () => {
  const children = { f: () => null, args: [{}] };
  assert.equal(Molecule({ children }), children);
  assert.equal(Molecule({}), undefined);
});
