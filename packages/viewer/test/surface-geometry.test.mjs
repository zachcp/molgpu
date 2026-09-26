import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStructure } from '@molgpu/table';
import { structureFromBcif } from '@molgpu/io';
import { buildSurfaceGeometry } from '../src/internal/surface-geometry.ts';

function identity16() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

/** A small tetrahedral cluster of carbons, close enough to form a real, if tiny, surface. */
function smallCluster() {
  return carbons([0,0,0, 1.5,0,0, -0.5,1.4,0, -0.5,-0.7,1.2, -0.5,-0.7,-1.2]);
}

/** Carbon atoms (radius 1.7) at the given packed xyz positions. */
function carbons(xyz) {
  const positions = Float32Array.from(xyz);
  const n = positions.length / 3;
  return createStructure({
    positions,
    topology: {
      atoms: {
        count: n, id: Array.from({ length: n }, (_, i) => String(i + 1)), name: Array.from({ length: n }, (_, i) => `C${i + 1}`),
        altloc: new Array(n).fill(''), residue: Uint32Array.from({ length: n }, () => 0),
        element: new Uint8Array(n).fill(6), occupancy: new Float32Array(n).fill(1), bfactor: new Float32Array(n),
        radius: new Float32Array(n).fill(1.7),
      },
      residues: { count: 1, chain: Uint32Array.of(0), labelSeq: Int32Array.of(-1), authSeq: ['1'], insertionCode: [''], comp: ['UNL'], polymer: ['other'] },
      chains: { count: 1, model: Int32Array.of(1), labelId: ['A'], authId: ['A'] },
      bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
      instances: { count: 1, chain: Uint32Array.of(0), operatorId: ['identity'], transform: Float64Array.from(identity16()) },
    },
  });
}

test('an empty selection produces no geometry without touching the field kernel', async () => {
  const data = smallCluster();
  const result = await buildSurfaceGeometry({ data }, { indices: new Uint32Array(), probeRadius: 1.4, resolution: 0.5 });
  assert.equal(result, null);
});

test('an oversize grid throws before the field is computed', async () => {
  const data = smallCluster();
  const indices = Uint32Array.from({ length: 5 }, (_, i) => i);
  await assert.rejects(
    buildSurfaceGeometry({ data }, { indices, probeRadius: 1.4, resolution: 0.5, maxBytes: 10 }),
    /GEOMETRY_BUDGET_EXCEEDED|exceeds the/,
  );
});

test('surface vertices lie on the atom spheres for an asymmetric grid (field axis order matches the mesher)', async () => {
  // Two atoms 12 Å apart along x, offset in y/z, give a grid whose three
  // dimensions all differ. Far apart, the solvent-excluded surface is just
  // each atom's van der Waals sphere, so every vertex must sit ~1.7 Å from its
  // nearest atom. A transposed grid (z-fastest values read x-fastest) puts
  // most vertices nowhere near either sphere.
  const xyz = [0, 0, 0, 12, 1, 3];
  const data = carbons(xyz);
  const mesh = await buildSurfaceGeometry({ data }, { indices: Uint32Array.of(0, 1), probeRadius: 1.4, resolution: 0.5 });
  assert.ok(mesh && mesh.vertexCount > 100);
  let off = 0;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const [px, py, pz] = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
    const d = Math.min(Math.hypot(px - xyz[0], py - xyz[1], pz - xyz[2]), Math.hypot(px - xyz[3], py - xyz[4], pz - xyz[5]));
    if (Math.abs(d - 1.7) > 0.5 * 0.75) off++; // within 3/4 of a grid cell
  }
  assert.equal(off, 0, `${off}/${mesh.vertexCount} vertices off the atom spheres`);
});

test('builds a real mesh with finite geometry and in-range source attribution', async () => {
  const data = smallCluster();
  const indices = Uint32Array.from({ length: 5 }, (_, i) => i);
  const mesh = await buildSurfaceGeometry({ data }, { indices, probeRadius: 1.4, resolution: 0.6 });
  assert.ok(mesh.vertexCount > 0, 'expected a non-empty surface for a compact atom cluster');
  assert.equal(mesh.positions.length, mesh.vertexCount * 3);
  assert.equal(mesh.normals.length, mesh.vertexCount * 3);
  assert.equal(mesh.indices.length, mesh.triangleCount * 3);
  for (const v of mesh.positions) assert.ok(Number.isFinite(v));
  for (const v of mesh.normals) assert.ok(Number.isFinite(v));
  assert.equal(mesh.sourceAtom.length, mesh.vertexCount);
  for (const row of mesh.sourceAtom) assert.ok(indices.includes(row), `sourceAtom ${row} not in the selection`);
});

test('sourceAtom is expressed in atom-row space, not local gather order, for a non-trivial selection', async () => {
  const data = smallCluster();
  // Skip atom 0: local gather order [1,2,3,4] must not be confused with atom rows.
  const indices = Uint32Array.from([1, 2, 3, 4]);
  const mesh = await buildSurfaceGeometry({ data }, { indices, probeRadius: 1.4, resolution: 0.6 });
  assert.ok(mesh.vertexCount > 0);
  for (const row of mesh.sourceAtom) {
    assert.notEqual(row, 0, 'atom 0 was excluded from the selection and cannot be a source');
    assert.ok(row >= 1 && row <= 4);
  }
});

test('probeRadius/resolution changes alter the mesh; a real corpus structure produces a finite surface', async () => {
  const bytes = new Uint8Array(await readFile(new URL('../../io/test/fixtures/1crn.bcif', import.meta.url)));
  const data = await structureFromBcif(bytes);
  const { activeAtoms } = await import('@molgpu/table');
  const indices = activeAtoms(data);
  const coarse = await buildSurfaceGeometry({ data }, { indices, probeRadius: 1.4, resolution: 1.0 });
  const fine = await buildSurfaceGeometry({ data }, { indices, probeRadius: 1.4, resolution: 0.6 });
  assert.ok(coarse.vertexCount > 0 && fine.vertexCount > 0);
  assert.notEqual(coarse.vertexCount, fine.vertexCount, 'a resolution change must change the mesh');
  for (const v of fine.normals) assert.ok(Number.isFinite(v));
  for (const row of fine.sourceAtom) assert.ok(indices.includes(row));
});
