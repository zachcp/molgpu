import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStructure, withPositions } from '@molgpu/table';
import {
  all, where, element, comp, within,
  resolve, union, intersect, difference,
  toAtoms, toResidues, toBonds, isStale, isEmpty, count,
} from '../src/index.ts';
import { fixture } from './fixture.mjs';

const rows = (sel) => [...sel.indices];

test('resolves a query to sorted unique in-range indices on its domain', () => {
  const data = createStructure(fixture());
  assert.deepEqual(rows(resolve(element(16), data)), [2, 4]);
  assert.deepEqual(rows(resolve(comp(['CYS']), data)), [0, 2]);      // residue domain
  assert.deepEqual(rows(resolve(all('atom'), data)), [0, 1, 2, 3, 4, 5]);
  assert.equal(resolve(element(16), data).domain, 'atom');
  assert.equal(resolve(comp(['CYS']), data).domain, 'residue');
});

test('a reused query resolves against each dataset independently', () => {
  const q = element(16);
  const a = createStructure(fixture());
  const b = createStructure(fixture({ firstElement: 16 }));      // atom 0 is now sulfur too
  assert.deepEqual(rows(resolve(q, a)), [2, 4]);
  assert.deepEqual(rows(resolve(q, b)), [0, 2, 4]);
});

test('identical query labels on two datasets get distinct library ids', () => {
  const a = createStructure(fixture());
  const b = createStructure(fixture());          // same shape, different identity
  const sa = resolve(element(16), a), sb = resolve(element(16), b);
  assert.equal(sa.label, sb.label);              // caller-facing label is shared
  assert.notEqual(sa.id, sb.id);                 // library identity is per dataset
  assert.notEqual(sa.dataset, sb.dataset);
});

test('same label with changed membership yields a different id', () => {
  const a = createStructure(fixture());
  const b = createStructure(fixture({ firstElement: 16 }));
  const sa = resolve(element(16), a), sb = resolve(element(16), b);
  assert.equal(sa.label, sb.label);
  assert.notEqual(sa.id, sb.id);
});

test('position-dependent selections go stale when coordinates advance', () => {
  const data = createStructure(fixture());
  const sel = resolve(within(1.5, element(16)), data);
  assert.deepEqual(rows(sel), [1, 2, 3, 4, 5]);
  assert.equal(isStale(sel, data), false);

  const moved = withPositions(data, Float32Array.from(data.positions, (x) => x + 100));
  assert.equal(sel.dataset, moved.identity);     // identity preserved by withPositions
  assert.equal(isStale(sel, moved), true);       // positions revision advanced
  const fresh = resolve(within(1.5, element(16)), moved);
  assert.equal(isStale(fresh, moved), false);
  assert.notEqual(sel.id, fresh.id);             // revision is part of identity
});

test('structural selections are not stale after a coordinate-only update', () => {
  const data = createStructure(fixture());
  const sel = resolve(element(16), data);        // reads topology/attributes, not positions
  const moved = withPositions(data, Float32Array.from(data.positions, (x) => x + 1));
  assert.equal(isStale(sel, moved), false);
});

test('set operations dedupe and stay sorted', () => {
  const data = createStructure(fixture());
  const s = resolve(element(16), data);          // {2,4}
  const near = resolve(within(1.5, element(16)), data); // {1,2,3,4,5}
  assert.deepEqual(rows(union(s, near)), [1, 2, 3, 4, 5]);
  assert.deepEqual(rows(intersect(s, near)), [2, 4]);
  assert.deepEqual(rows(difference(near, s)), [1, 3, 5]);
});

test('set operations reject mismatched datasets, domains, and revisions', () => {
  const a = createStructure(fixture());
  const b = createStructure(fixture());
  assert.throws(() => union(resolve(element(16), a), resolve(element(16), b)), /dataset/);
  assert.throws(() => union(resolve(element(16), a), resolve(comp(['CYS']), a)), /domain/);

  const moved = withPositions(a, Float32Array.from(a.positions, (x) => x + 100));
  const before = resolve(within(1.5, element(16)), a);
  const after = resolve(within(1.5, element(16)), moved);   // same identity, positions r+1
  assert.throws(() => union(before, after), /revision/);
});

test('empty selections are valid and explicit', () => {
  const data = createStructure(fixture());
  const empty = resolve(comp(['XXX']), data);
  assert.equal(isEmpty(empty), true);
  assert.equal(count(empty), 0);
  assert.deepEqual(rows(empty), []);
  assert.equal(isEmpty(toAtoms(empty, data)), true);   // conversions preserve emptiness
});

test('residue -> atom conversion expands and retains a source map', () => {
  const data = createStructure(fixture());
  const cys = resolve(comp(['CYS']), data);            // residues {0,2}
  const atoms = toAtoms(cys, data);
  assert.equal(atoms.domain, 'atom');
  assert.deepEqual(rows(atoms), [0, 1, 4, 5]);
  assert.equal(atoms.source.domain, 'residue');
  assert.deepEqual([...atoms.source.rows], [0, 0, 2, 2]); // each atom -> its residue
});

test('atom -> bond conversion honours both/either and maps endpoints', () => {
  const data = createStructure(fixture());
  const sulfur = resolve(element(16), data);           // atoms {2,4}
  const both = toBonds(sulfur, data, { endpoints: 'both' });
  assert.deepEqual(rows(both), []);                    // no bond has two sulfur endpoints
  const either = toBonds(sulfur, data, { endpoints: 'either' });
  assert.deepEqual(rows(either), [1, 2]);              // bonds 2-3 and 4-5 touch a sulfur
  assert.equal(either.source.domain, 'atom');
  assert.deepEqual([...either.source.a], [2, 4]);
  assert.deepEqual([...either.source.b], [3, 5]);
});

test('atom -> residue conversion collapses to touched residues', () => {
  const data = createStructure(fixture());
  const sulfur = resolve(element(16), data);           // atoms {2,4} in residues 1,2
  assert.deepEqual(rows(toResidues(sulfur, data)), [1, 2]);
});

test('bond -> atom conversion dedupes shared endpoints', () => {
  const data = createStructure(fixture());
  const bonds = toBonds(resolve(all('atom'), data), data, { endpoints: 'either' });
  assert.deepEqual(rows(bonds), [0, 1, 2]);            // all three bonds
  assert.deepEqual(rows(toAtoms(bonds, data)), [0, 1, 2, 3, 4, 5]); // sorted unique
});

test('rejects malformed queries, foreign selections, and bad domains', () => {
  const data = createStructure(fixture());
  assert.throws(() => all('molecule'), /domain/);
  assert.throws(() => where('atom', '', () => true), /label/);
  assert.throws(() => resolve({}, data), /query/);
  assert.throws(() => resolve(element(16), {}), /StructureData/);
  const foreign = createStructure(fixture());
  assert.throws(() => toAtoms(resolve(comp(['CYS']), data), foreign), /dataset/);
});
