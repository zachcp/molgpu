import test from 'node:test';
import assert from 'node:assert/strict';
import { createStructure } from '@molgpu/table';
import { createStructureResource } from '../src/internal/structure-resource.ts';
import { geometryDeps, assertGridBudget, copyOwned, runGeometryJob } from '../src/internal/geometry-job.ts';

const structure = () => createStructure({ positions: new Float32Array([0, 0, 0, 2, 4, 6]), topology: {
  atoms: { count: 2, id: ['1', '2'], name: ['C', 'O'], altloc: ['', ''], residue: new Uint32Array([0, 0]), element: new Uint8Array([6, 8]), occupancy: new Float32Array([1, 1]), bfactor: new Float32Array(2) },
  residues: { count: 1, chain: new Uint32Array([0]), labelSeq: new Int32Array([1]), authSeq: ['1'], insertionCode: [''], comp: ['GLY'], polymer: ['protein'] },
  chains: { count: 1, model: new Int32Array([1]), labelId: ['A'], authId: ['A'] },
  bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
  instances: { count: 1, chain: new Uint32Array([0]), operatorId: ['identity'], transform: new Float64Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]) },
} });

test('geometryDeps keys on structure identity/revisions plus sorted geometry params', () => {
  const resource = createStructureResource(structure());
  const a = geometryDeps(resource, { isoLevel: 0.5, resolution: 1 });
  const b = geometryDeps(resource, { resolution: 1, isoLevel: 0.5 }); // key order must not matter
  assert.deepEqual(a, b);
  const c = geometryDeps(resource, { isoLevel: 0.6, resolution: 1 });
  assert.notDeepEqual(a, c);
});

test('geometryDeps refuses a style parameter so a color/opacity edit cannot gate scheduling', () => {
  const resource = createStructureResource(structure());
  assert.throws(() => geometryDeps(resource, { color: [1, 0, 0, 1] }), /style parameter/);
  assert.throws(() => geometryDeps(resource, { opacity: 0.5 }), /style parameter/);
  assert.doesNotThrow(() => geometryDeps(resource, { isoLevel: 0.5 }));
});

test('geometryDeps requires an actual structure resource', () => {
  assert.throws(() => geometryDeps(null, {}), /structure resource/);
  assert.throws(() => geometryDeps({}, {}), /structure resource/);
});

test('assertGridBudget rejects an oversize grid before any allocation happens', () => {
  assert.equal(assertGridBudget([10, 10, 10], { maxBytes: 1_000_000 }), 4000);
  assert.throws(() => assertGridBudget([1000, 1000, 1000]), /exceeds the .* byte limit/);
  try {
    assertGridBudget([1000, 1000, 1000]);
    assert.fail('expected assertGridBudget to throw');
  } catch (error) {
    assert.equal(error.code, 'GEOMETRY_BUDGET_EXCEEDED');
  }
  assert.throws(() => assertGridBudget([1, 1]), /three positive integers/);
  assert.throws(() => assertGridBudget([1, 1, 1.5]), /three positive integers/);
});

test('copyOwned leaves the source Structure buffer usable and unmutated', () => {
  const data = structure();
  const copy = copyOwned(data.positions);
  assert.notEqual(copy.buffer, data.positions.buffer, 'must not alias the shared buffer');
  copy.fill(999);
  assert.equal(data.positions[0], 0, 'source Structure positions remain usable after the job touches its copy');
  assert.equal(data.positions.length, 6);
});

test('runGeometryJob discards a result that was cancelled before it settled', async () => {
  let cancelled = false;
  const slow = () => new Promise(resolve => setTimeout(() => resolve('mesh-A'), 5));
  const pending = runGeometryJob(slow, () => cancelled);
  cancelled = true; // superseded by a later request before slow() resolves
  assert.equal(await pending, null);
});

test('runGeometryJob returns the kernel result when not cancelled', async () => {
  const result = await runGeometryJob(() => 'mesh-B', () => false);
  assert.equal(result, 'mesh-B');
});

test('runGeometryJob propagates a kernel error (e.g. a budget rejection) as a rejection', async () => {
  await assert.rejects(
    runGeometryJob(() => assertGridBudget([1000, 1000, 1000]), () => false),
    /GEOMETRY_BUDGET_EXCEEDED|exceeds the/,
  );
});
