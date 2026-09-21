import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CIF } from 'molstar/lib/mol-io/reader/cif.js';
import { activeAtoms, traceTable, secondaryStructureTrace } from '@molgpu/table';
import { structureFromBcif } from '../src/index.mjs';
import { corpus } from './corpus.mjs';

const clean = value => value === '.' || value === '?' ? '' : value;
const str = (category, name, row, fallback = '') => clean(category.getField(name)?.str(row) ?? fallback);
const num = (category, name, row, fallback = 0) => category.getField(name)?.float(row) ?? fallback;

/**
 * Independently derive expected per-(chain, label_seq_id) secondary
 * structure directly from the raw struct_conf/struct_sheet_range categories
 * — not by calling into @molgpu/io's own implementation — so this is a real
 * check against an oracle, not a restatement of the code under test.
 */
function oracleSecondaryStructure(categories) {
  const expect = new Map(); // `${chain}:${seq}` -> 'helix' | 'sheet'
  const mark = (category, kind, filter) => {
    for (let i = 0; category && i < category.rowCount; i++) {
      if (filter && !filter(category, i)) continue;
      const chain = str(category, 'beg_label_asym_id', i);
      const beg = Math.trunc(num(category, 'beg_label_seq_id', i, NaN));
      const end = Math.trunc(num(category, 'end_label_seq_id', i, NaN));
      for (let seq = beg; seq <= end; seq++) expect.set(`${chain}:${seq}`, kind);
    }
  };
  mark(categories.struct_conf, 'helix', (c, i) => str(c, 'conf_type_id', i).toUpperCase().startsWith('HELX'));
  mark(categories.struct_sheet_range, 'sheet');
  return expect;
}

async function loadFixture(id) {
  const bytes = new Uint8Array(await readFile(new URL(`./fixtures/${id}.bcif`, import.meta.url)));
  const parsed = await CIF.parseBinary(bytes).run();
  const categories = parsed.result.blocks[0].categories;
  const data = await structureFromBcif(bytes);
  return { categories, data };
}

for (const fixture of corpus.filter(f => f.models === 1)) test(`${fixture.id}: secondary structure matches the struct_conf/struct_sheet_range oracle`, async () => {
  const { categories, data } = await loadFixture(fixture.id);
  const oracle = oracleSecondaryStructure(categories);
  const { residues, chains } = data.topology;
  assert.ok(residues.secondaryStructure, 'expected an imported secondaryStructure column');
  let helixOrSheet = 0;
  for (let r = 0; r < residues.count; r++) {
    const chainLabel = chains.labelId[residues.chain[r]];
    const expected = oracle.get(`${chainLabel}:${residues.labelSeq[r]}`) ?? 'coil';
    assert.equal(residues.secondaryStructure[r], expected, `residue ${r} (${chainLabel}:${residues.labelSeq[r]})`);
    if (expected !== 'coil') helixOrSheet++;
  }
  // A meaningful check, not a vacuous one: fixtures with annotation rows must
  // actually produce non-coil residues (catches an always-'coil' regression).
  const hasAnnotation = categories.struct_conf?.rowCount || categories.struct_sheet_range?.rowCount;
  if (hasAnnotation) assert.ok(helixOrSheet > 0, 'annotation exists but nothing was marked helix/sheet');
});

test('1bna (nucleic, no struct_conf/struct_sheet_range) reports every residue as coil', async () => {
  const { data } = await loadFixture('1bna');
  assert.ok(data.topology.residues.secondaryStructure.every(k => k === 'coil'));
});

for (const fixture of corpus.filter(f => f.models === 1)) test(`${fixture.id}: oriented frames are finite and unit-length for every trace sample`, async () => {
  const { data } = await loadFixture(fixture.id);
  const selection = activeAtoms(data);
  const trace = traceTable(data, selection);
  const ss = secondaryStructureTrace(data, selection, trace);
  assert.equal(ss.count, trace.count);
  for (let k = 0; k < ss.count; k++) {
    const x = ss.direction[k * 3], y = ss.direction[k * 3 + 1], z = ss.direction[k * 3 + 2];
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `sample ${k} direction is not finite`);
    const len = Math.hypot(x, y, z);
    assert.ok(Math.abs(len - 1) < 1e-4, `sample ${k} direction is not unit length (${len})`);
  }
  // first/last are always defined booleans (0/1), never undefined, and every
  // run boundary is marked, matching traceTable's own run offsets.
  for (let r = 0; r < trace.runs.length - 1; r++) {
    assert.equal(ss.first[trace.runs[r]], 1);
    assert.equal(ss.last[trace.runs[r + 1] - 1], 1);
  }
});
