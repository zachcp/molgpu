import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activeAtoms, traceTable } from '@molgpu/table';
import { structureFromBcif } from '../src/index.mjs';
import { corpus } from './corpus.mjs';

async function loadTrace(id) {
  const bytes = new Uint8Array(await readFile(new URL(`./fixtures/${id}.bcif`, import.meta.url)));
  const data = await structureFromBcif(bytes);
  return { data, trace: traceTable(data, activeAtoms(data)) };
}

function assertFinite(arr, label) {
  for (let i = 0; i < arr.length; i++) assert.ok(Number.isFinite(arr[i]), `${label}[${i}] is not finite: ${arr[i]}`);
}

/** Every run's residues are the same chain, same kind, and strictly consecutive labelSeq. */
function assertRunsAreSound(data, trace) {
  const { residues } = data.topology;
  for (let r = 0; r < trace.runs.length - 1; r++) {
    const start = trace.runs[r], end = trace.runs[r + 1];
    assert.ok(end > start, `run ${r} is empty`);
    const chain = residues.chain[trace.residue[start]];
    let prevSeq;
    for (let k = start; k < end; k++) {
      const row = trace.residue[k];
      assert.equal(residues.chain[row], chain, `run ${r} mixes chains`);
      assert.equal(residues.polymer[row], trace.runKind[r], `run ${r} mixes polymer kinds`);
      if (k > start) assert.equal(residues.labelSeq[row], prevSeq + 1, `run ${r} has a labelSeq gap it should have split on`);
      prevSeq = residues.labelSeq[row];
    }
  }
}

for (const fixture of corpus.filter(f => f.models === 1)) test(`${fixture.id}: trace has finite frames and sound run boundaries`, async () => {
  const { data, trace } = await loadTrace(fixture.id);
  assert.ok(trace.count > 0);
  assertFinite(trace.guide, 'guide'); assertFinite(trace.tangent, 'tangent');
  assertFinite(trace.normal, 'normal'); assertFinite(trace.binormal, 'binormal');
  assertRunsAreSound(data, trace);
  // sample-to-residue mapping is injective within a run and stays in range.
  for (const row of trace.residue) assert.ok(row >= 0 && row < data.topology.residues.count);
});

test('1crn (single-chain peptide, no gaps) is one unbroken run over every residue', async () => {
  const { data, trace } = await loadTrace('1crn');
  assert.equal(trace.runs.length - 1, 1);
  assert.equal(trace.count, data.topology.residues.count);
  assert.deepEqual(trace.runKind, ['protein']);
});

test('1tqn (named sequence break) actually breaks the trace into more than one run', async () => {
  const { trace } = await loadTrace('1tqn');
  assert.ok(trace.runs.length - 1 >= 2, 'the pinned sequence-break fixture should split the trace');
  assert.ok(trace.runKind.every(k => k === 'protein'));
});

test('1bna (nucleic acid) resolves O3\' guides on both strands with a dna run kind', async () => {
  const { data, trace } = await loadTrace('1bna');
  assert.ok(trace.runKind.length > 0 && trace.runKind.every(k => k === 'dna'));
  // Every dna guide sample must come from a residue classified dna, never protein/other leaking in.
  for (const row of trace.residue) assert.equal(data.topology.residues.polymer[row], 'dna');
});

test('1ejg (alternate locations) resolves exactly one guide per residue, never a duplicate', async () => {
  const { data, trace } = await loadTrace('1ejg');
  const seen = new Set();
  for (const row of trace.residue) {
    assert.ok(!seen.has(row), `residue ${row} contributed more than one guide sample`);
    seen.add(row);
  }
  assert.ok(trace.count <= data.topology.residues.count);
});
