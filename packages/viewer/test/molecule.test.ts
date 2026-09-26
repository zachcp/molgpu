import { assertStrictEquals } from '@std/assert';
import { Molecule } from '../src/molecule.ts';

// <Structure> and <Spacefill> reach @use-gpu/workbench, which Node cannot
// import; their contracts are asserted in the browser runner instead.
Deno.test('Molecule is a compositional boundary that owns nothing', () => {
  const children = { f: () => null, args: [{}] };
  assertStrictEquals(Molecule({ children }), children);
  assertStrictEquals(Molecule({}), undefined);
});
