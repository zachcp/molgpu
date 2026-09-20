import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BcifParseError, structureFromBcif } from '../src/index.mjs';
test('lowers public 1TQN BinaryCIF into owned table domains', async () => {
  const data = await structureFromBcif(new Uint8Array(await readFile(new URL('./fixtures/1tqn.bcif', import.meta.url))));
  assert.equal(data.topology.atoms.count, 3999);
  assert.equal(data.positions.length, 11997);
  assert.ok(data.topology.residues.count > 500);
  assert.ok(data.topology.chains.count >= 1);
  assert.equal(data.topology.bonds.count, 0);
});

test('reports malformed BCIF through a structured boundary error', async () => {
  await assert.rejects(
    structureFromBcif(new Uint8Array([0, 1, 2])),
    error => error instanceof BcifParseError && error.code === 'INVALID_BCIF',
  );
});
