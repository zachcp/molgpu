import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStructure, validateStructure, withPositions, activeAtoms, residueKey, coordinateBounds, bondTopology, selectBonds } from '../src/index.ts';
import { fixture } from './fixture.mjs';

test('owns packed columns without discarding chemical or instance identity', () => {
  const input = fixture(), data = createStructure(input);
  input.positions[0] = 900; input.topology.atoms.name[0] = 'wrong'; input.topology.instances.transform[28] = 900;
  assert.equal(data.positions[0], 0); assert.equal(data.topology.atoms.name[0], 'N');
  assert.equal(data.topology.instances.transform[28], 10);
  assert.equal(data.positions.length, data.topology.atoms.count * 3);
  assert.equal(new Set([0,1,2,3].map(i => residueKey(data, i))).size, 4);
  assert.equal(data.topology.atoms.count, 6); // instances do not duplicate atoms
  assert.deepEqual(coordinateBounds(data), { min: [0,0,0], max: [5,6,7], center: [2.5,3,3.5] });
});

test('coordinate replacements preserve topology; branching versions are unique', () => {
  const data = createStructure(fixture());
  const positions = Float32Array.from(data.positions, x => x + 10);
  const a = withPositions(data, positions), b = withPositions(data, positions);
  assert.equal(a.identity, data.identity); assert.equal(a.topology, data.topology);
  assert.equal(a.revision.topology, data.revision.topology);
  assert.notEqual(a.revision.positions, b.revision.positions);
  positions.fill(0); assert.equal(a.positions[0], 10); assert.equal(data.positions[0], 0);
  assert.notEqual(createStructure(fixture()).identity, data.identity);
});

test('explicit model and residue-level altloc policies', () => {
  const data = createStructure(fixture());
  assert.deepEqual([...activeAtoms(data)], [0,2,3,4]);
  assert.deepEqual([...activeAtoms(data, { model: 2 })], [5]);
  assert.deepEqual([...activeAtoms(data, { model: 'all', altloc: 'all' })], [0,1,2,3,4,5]);
  assert.throws(() => activeAtoms(data, { model: 99 }), /model not present/);
  assert.throws(() => activeAtoms(data, { altloc: 'random' }), /policy.altloc/);
  const input = fixture(); input.topology.atoms.occupancy[1] = .6;
  assert.deepEqual([...activeAtoms(createStructure(input))], [0,1,3,4]); // lexical tie
});

test('empty domains and empty selections have defined results', () => {
  const input = fixture(); input.positions = new Float32Array();
  for (const domain of Object.values(input.topology)) {
    domain.count = 0;
    for (const k of Object.keys(domain)) if (k !== 'count') domain[k] = domain[k].slice(0,0);
  }
  const data = createStructure(input);
  assert.equal(coordinateBounds(data), null); assert.deepEqual([...activeAtoms(data)], []);
  assert.equal(coordinateBounds(createStructure(fixture()), new Uint32Array()), null);
});

for (const [name, mutate, error] of [
  ['stride', x => { x.positions = new Float32Array(6); }, /positions/],
  ['nonfinite coordinates', x => { x.positions[2] = NaN; }, /finite/],
  ['atom foreign key', x => { x.topology.atoms.residue[0] = 90; }, /foreign key/],
  ['residue foreign key', x => { x.topology.residues.chain[0] = 90; }, /foreign key/],
  ['bond foreign key', x => { x.topology.bonds.a[0] = 90; }, /foreign key/],
  ['instance foreign key', x => { x.topology.instances.chain[0] = 90; }, /foreign key/],
  ['occupancy', x => { x.topology.atoms.occupancy[0] = 1.1; }, /occupancy/],
  ['duplicate site', x => { x.topology.atoms.altloc[1] = 'B'; }, /duplicate/],
  ['cross-model bond', x => { x.topology.bonds.b[0] = 5; }, /cross-model/],
  ['incompatible conformers', x => { x.topology.bonds.a[0] = 1; }, /altloc/],
  ['nonaffine transform', x => { x.topology.instances.transform[3] = 2; }, /affine/],
]) test(`rejects ${name}`, () => {
  const input = fixture(); mutate(input); assert.throws(() => validateStructure(input), error);
});

test('validates coordinate update length and selected bounds indices', () => {
  const data = createStructure(fixture());
  assert.throws(() => withPositions(data, new Float32Array(1)), /positions/);
  assert.throws(() => withPositions(data, new Float32Array(18).fill(Infinity)), /finite/);
  assert.throws(() => coordinateBounds(data, Uint32Array.of(99)), /atom out of range/);
  assert.throws(() => residueKey(data, -1), /row out of range/);
});

test('shares explicit topology and makes bond-selection endpoint policy explicit', () => {
  const data = createStructure(fixture());
  assert.equal(bondTopology(data), data.topology.bonds);
  assert.deepEqual([...selectBonds(data, Uint32Array.of(0), { mode: 'both' })], []);
  assert.deepEqual([...selectBonds(data, Uint32Array.of(0), { mode: 'either' })], [0]);
  assert.deepEqual([...selectBonds(data, Uint32Array.of(0, 2), { mode: 'both' })], [0]);
});

test('infers cached element-aware topology without cross-model or incompatible-altloc bonds', () => {
  const input = fixture();
  input.topology.bonds = { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] };
  input.positions = Float32Array.from([0,0,0, 1.4,0,0, 10,0,0, 20,0,0, 40,0,0, 40,0,0]);
  const data = createStructure(input), first = bondTopology(data);
  assert.equal(first, bondTopology(data), 'one topology build per structure revision/policy');
  assert.deepEqual([...first.a], [0]); assert.deepEqual([...first.b], [1]);
  assert.deepEqual(first.source, ['inferred']);
});
