import { assert, assertEquals, assertNotStrictEquals, assertStrictEquals, assertThrows } from '@std/assert';
import { createStructure, withPositions, type StructureData } from '@molgpu/table';
import {
  all, where, element, comp, within,
  resolve, union, intersect, difference,
  toAtoms, toResidues, toBonds, isStale, isEmpty, count,
} from '../src/index.ts';
import type { Selection, SelectionQuery } from '../src/index.ts';
import { fixture } from './fixture.ts';

const rows = (sel: Selection) => [...sel.indices];

Deno.test('resolves a query to sorted unique in-range indices on its domain', () => {
  const data = createStructure(fixture());
  assertEquals(rows(resolve(element(16), data)), [2, 4]);
  assertEquals(rows(resolve(comp(['CYS']), data)), [0, 2]);      // residue domain
  assertEquals(rows(resolve(all('atom'), data)), [0, 1, 2, 3, 4, 5]);
  assertStrictEquals(resolve(element(16), data).domain, 'atom');
  assertStrictEquals(resolve(comp(['CYS']), data).domain, 'residue');
});

Deno.test('a reused query resolves against each dataset independently', () => {
  const q = element(16);
  const a = createStructure(fixture());
  const b = createStructure(fixture({ firstElement: 16 }));      // atom 0 is now sulfur too
  assertEquals(rows(resolve(q, a)), [2, 4]);
  assertEquals(rows(resolve(q, b)), [0, 2, 4]);
});

Deno.test('identical query labels on two datasets get distinct library ids', () => {
  const a = createStructure(fixture());
  const b = createStructure(fixture());          // same shape, different identity
  const sa = resolve(element(16), a), sb = resolve(element(16), b);
  assertStrictEquals(sa.label, sb.label);              // caller-facing label is shared
  assertNotStrictEquals(sa.id, sb.id);                 // library identity is per dataset
  assertNotStrictEquals(sa.dataset, sb.dataset);
});

Deno.test('same label with changed membership yields a different id', () => {
  const a = createStructure(fixture());
  const b = createStructure(fixture({ firstElement: 16 }));
  const sa = resolve(element(16), a), sb = resolve(element(16), b);
  assertStrictEquals(sa.label, sb.label);
  assertNotStrictEquals(sa.id, sb.id);
});

Deno.test('position-dependent selections go stale when coordinates advance', () => {
  const data = createStructure(fixture());
  const sel = resolve(within(1.5, element(16)), data);
  assertEquals(rows(sel), [1, 2, 3, 4, 5]);
  assertStrictEquals(isStale(sel, data), false);

  const moved = withPositions(data, Float32Array.from(data.positions, (x) => x + 100));
  assertStrictEquals(sel.dataset, moved.identity);     // identity preserved by withPositions
  assertStrictEquals(isStale(sel, moved), true);       // positions revision advanced
  const fresh = resolve(within(1.5, element(16)), moved);
  assertStrictEquals(isStale(fresh, moved), false);
  assertNotStrictEquals(sel.id, fresh.id);             // revision is part of identity
});

Deno.test('structural selections are not stale after a coordinate-only update', () => {
  const data = createStructure(fixture());
  const sel = resolve(element(16), data);        // reads topology/attributes, not positions
  const moved = withPositions(data, Float32Array.from(data.positions, (x) => x + 1));
  assertStrictEquals(isStale(sel, moved), false);
});

Deno.test('set operations dedupe and stay sorted', () => {
  const data = createStructure(fixture());
  const s = resolve(element(16), data);          // {2,4}
  const near = resolve(within(1.5, element(16)), data); // {1,2,3,4,5}
  assertEquals(rows(union(s, near)), [1, 2, 3, 4, 5]);
  assertEquals(rows(intersect(s, near)), [2, 4]);
  assertEquals(rows(difference(near, s)), [1, 3, 5]);
});

Deno.test('set operations reject mismatched datasets, domains, and revisions', () => {
  const a = createStructure(fixture());
  const b = createStructure(fixture());
  assertThrows(() => union(resolve(element(16), a), resolve(element(16), b)), Error, 'dataset');
  assertThrows(() => union(resolve(element(16), a), resolve(comp(['CYS']), a)), Error, 'domain');

  const moved = withPositions(a, Float32Array.from(a.positions, (x) => x + 100));
  const before = resolve(within(1.5, element(16)), a);
  const after = resolve(within(1.5, element(16)), moved);   // same identity, positions r+1
  assertThrows(() => union(before, after), Error, 'revision');
});

Deno.test('empty selections are valid and explicit', () => {
  const data = createStructure(fixture());
  const empty = resolve(comp(['XXX']), data);
  assertStrictEquals(isEmpty(empty), true);
  assertStrictEquals(count(empty), 0);
  assertEquals(rows(empty), []);
  assertStrictEquals(isEmpty(toAtoms(empty, data)), true);   // conversions preserve emptiness
});

Deno.test('residue -> atom conversion expands and retains a source map', () => {
  const data = createStructure(fixture());
  const cys = resolve(comp(['CYS']), data);            // residues {0,2}
  const atoms = toAtoms(cys, data);
  assertStrictEquals(atoms.domain, 'atom');
  assertEquals(rows(atoms), [0, 1, 4, 5]);
  const source = atoms.source;
  assert(source?.domain === 'residue');
  assertEquals([...source.rows], [0, 0, 2, 2]); // each atom -> its residue
});

Deno.test('atom -> bond conversion honours both/either and maps endpoints', () => {
  const data = createStructure(fixture());
  const sulfur = resolve(element(16), data);           // atoms {2,4}
  const both = toBonds(sulfur, data, { endpoints: 'both' });
  assertEquals(rows(both), []);                    // no bond has two sulfur endpoints
  const either = toBonds(sulfur, data, { endpoints: 'either' });
  assertEquals(rows(either), [1, 2]);              // bonds 2-3 and 4-5 touch a sulfur
  const source = either.source;
  assert(source?.domain === 'atom');
  assertEquals([...source.a], [2, 4]);
  assertEquals([...source.b], [3, 5]);
});

Deno.test('atom -> residue conversion collapses to touched residues', () => {
  const data = createStructure(fixture());
  const sulfur = resolve(element(16), data);           // atoms {2,4} in residues 1,2
  assertEquals(rows(toResidues(sulfur, data)), [1, 2]);
});

Deno.test('bond -> atom conversion dedupes shared endpoints', () => {
  const data = createStructure(fixture());
  const bonds = toBonds(resolve(all('atom'), data), data, { endpoints: 'either' });
  assertEquals(rows(bonds), [0, 1, 2]);            // all three bonds
  assertEquals(rows(toAtoms(bonds, data)), [0, 1, 2, 3, 4, 5]); // sorted unique
});

Deno.test('rejects malformed queries, foreign selections, and bad domains', () => {
  const data = createStructure(fixture());
  // @ts-expect-error: not a domain
  assertThrows(() => all('molecule'), Error, 'domain');
  assertThrows(() => where('atom', '', () => true), Error, 'label');
  assertThrows(() => resolve({} as SelectionQuery, data), Error, 'query');
  assertThrows(() => resolve(element(16), {} as StructureData), Error, 'StructureData');
  const foreign = createStructure(fixture());
  assertThrows(() => toAtoms(resolve(comp(['CYS']), data), foreign), Error, 'dataset');
});
