import test from 'node:test';
import assert from 'node:assert/strict';
import { createStructure } from '@molgpu/table';
import { attribute, constant } from '@molgpu/fields';
import { tooltipFields } from '../src/internal/tooltip.mjs';

const data = createStructure({
  positions: Float32Array.from([0,0,0, 1,0,0, 2,0,0]),
  topology: {
    atoms: {
      count: 3, id: ['1', '2', '3'], name: ['CA', 'CB', 'CG'], altloc: ['', '', ''],
      residue: Uint32Array.of(0, 0, 0), element: new Uint8Array([6, 7, 8]),
      occupancy: new Float32Array([1, 1, 1]), bfactor: new Float32Array([10, 20, 30]),
      radius: new Float32Array([1.7, 1.55, 1.52]),
    },
    residues: { count: 1, chain: new Uint32Array(1), labelSeq: Int32Array.of(1), authSeq: ['1'], insertionCode: [''], comp: ['ALA'], polymer: ['protein'] },
    chains: { count: 1, model: Int32Array.of(1), labelId: ['A'], authId: ['A'] },
    bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
    instances: { count: 1, chain: new Uint32Array(1), operatorId: ['1'], transform: Float64Array.of(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1) },
  },
});

test('evaluates numeric and string fields for the picked atom row', () => {
  const fields = { B: attribute('bfactor'), Z: attribute('element'), Tag: constant('site') };
  assert.deepEqual(tooltipFields(fields, data, 0), { B: 10, Z: 6, Tag: 'site' });
  assert.deepEqual(tooltipFields(fields, data, 2), { B: 30, Z: 8, Tag: 'site' });
});

test('a cached field returns the same value on repeat reads', () => {
  const fields = { B: attribute('bfactor') };
  assert.equal(tooltipFields(fields, data, 1).B, 20);
  assert.equal(tooltipFields(fields, data, 1).B, 20);
});

test('rejects a bad fields record or atom row', () => {
  assert.throws(() => tooltipFields(null, data, 0), /label: Field/);
  assert.throws(() => tooltipFields({ B: attribute('bfactor') }, data, -1), /nonnegative integer/);
  assert.throws(() => tooltipFields({ B: attribute('bfactor') }, data, 1.5), /nonnegative integer/);
});
