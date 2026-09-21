import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { activeAtoms, traceTable, secondaryStructureTrace, coordinateBounds } from '@molgpu/table';
import { structureFromBcif } from '@molgpu/io';
import { buildRibbonGeometry } from '../src/internal/ribbon-geometry.mjs';

async function loadFixture(id) {
  const bytes = new Uint8Array(await readFile(new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url)));
  const data = await structureFromBcif(bytes);
  const selection = activeAtoms(data);
  const trace = traceTable(data, selection);
  const ss = secondaryStructureTrace(data, selection, trace);
  return { data, selection, trace, ss, mesh: buildRibbonGeometry(trace, ss, 6) };
}

/**
 * Golden-file style checks against the real corpus (gap, altloc, nucleic
 * entries), per this project's own architecture guidance: compare molecular
 * identity, run boundaries, bounds, and finite geometry within a stated
 * tolerance rather than an assumed matching mesh/vertex order against Mol*'s
 * own (structurally different) cartoon tessellation.
 */
for (const id of ['1tqn', '1ejg', '1bna']) test(`${id}: ribbon geometry is finite, in-bounds, and never bridges a run`, async () => {
  const { data, trace, ss, mesh } = await loadFixture(id);
  assert.ok(mesh.vertexCount > 0, 'expected a non-empty ribbon');
  assert.equal(mesh.positions.length, mesh.vertexCount * 3);
  assert.equal(mesh.normals.length, mesh.vertexCount * 3);
  assert.equal(mesh.indices.length, mesh.triangleCount * 3);
  for (const v of mesh.positions) assert.ok(Number.isFinite(v));
  for (const v of mesh.normals) assert.ok(Number.isFinite(v));
  for (const i of mesh.indices) assert.ok(i >= 0 && i < mesh.vertexCount);

  // Every vertex maps back to a real, retained residue (sample-to-residue mapping).
  for (const row of mesh.residue) assert.ok(row >= 0 && row < data.topology.residues.count);

  // The mesh must stay within the atom cloud's bounds, expanded by the
  // widest possible ribbon half-extent (helix/sheet width 2.2, height 0.35).
  const bounds = coordinateBounds(data);
  const margin = 1.2;
  for (let v = 0; v < mesh.vertexCount; v++) {
    for (let c = 0; c < 3; c++) {
      const p = mesh.positions[v * 3 + c];
      assert.ok(p >= bounds.min[c] - margin && p <= bounds.max[c] + margin, `vertex ${v} axis ${c} (${p}) outside the structure's bounds`);
    }
  }

  // No triangle mixes vertices from two different runs (never bridges a gap/chain break).
  const runOf = new Array(trace.runs.length - 1);
  for (let r = 0; r < trace.runs.length - 1; r++) for (let k = trace.runs[r]; k < trace.runs[r + 1]; k++) runOf[k] = r;
  const runOfResidue = new Map();
  for (let r = 0; r < trace.runs.length - 1; r++) for (let k = trace.runs[r]; k < trace.runs[r + 1]; k++) runOfResidue.set(trace.residue[k], r);
  for (let t = 0; t < mesh.triangleCount; t++) {
    const runs = [0, 1, 2].map(c => runOfResidue.get(mesh.residue[mesh.indices[t * 3 + c]]));
    assert.equal(runs[0], runs[1]); assert.equal(runs[1], runs[2]);
  }

  // Every sample's secondary-structure kind is one of the three known labels.
  for (const kind of ss.kind) assert.ok(['helix', 'sheet', 'coil'].includes(kind));
});

test('1bna (nucleic, all-coil) still produces a valid, uniformly narrow ribbon', async () => {
  const { ss, mesh, trace } = await loadFixture('1bna');
  assert.ok(ss.kind.every(k => k === 'coil'));
  assert.ok(mesh.vertexCount > 0);
  assert.ok(trace.runKind.every(k => k === 'dna'));
});
