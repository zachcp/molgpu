import { assert, assertStrictEquals, assertThrows } from '@std/assert';
import { buildRibbonGeometry } from '../src/internal/ribbon-geometry.ts';

/** Two runs: a 4-residue helix run and a far-away 3-residue coil run, plus a 1-residue run. */
function fixture() {
  const guide = Float32Array.from([
    0,0,0, 1,0,0, 2,1,0, 3,1,0,       // run0 (helix): residues 0..3
    50,0,0,                            // run1 (isolated): residue 4
    100,0,0, 101,0,0, 102,1,0,         // run2 (coil): residues 5..7
  ]);
  const residue = Uint32Array.from([0,1,2,3, 4, 5,6,7]);
  const runs = Uint32Array.from([0, 4, 5, 8]);
  const direction = Float32Array.from(Array.from({ length: 8 }, () => [0, 0, 1]).flat());
  const kind: ('helix' | 'sheet' | 'coil')[] = ['helix','helix','helix','helix', 'coil', 'coil','coil','coil'];
  const first = Uint8Array.from([1,0,0,1, 1, 1,0,1]);
  const last = Uint8Array.from([0,0,0,1, 1, 0,0,1]);
  return { trace: { guide, residue, runs }, ss: { count: 8, direction, kind, first, last } };
}

function assertFinite(arr: Iterable<number>) { for (const v of arr) assert(Number.isFinite(v)); }

Deno.test('drops the single-residue run and keeps the two multi-residue runs', () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 4);
  assert(mesh.vertexCount > 0);
  // 4 verts/sample, samples = segs*linearSegments + 1 per run (dedup boundary): run0 has 3 segs, run2 has 2 segs.
  const samplesRun0 = 3 * 4 + 1, samplesRun2 = 2 * 4 + 1;
  assertStrictEquals(mesh.vertexCount, (samplesRun0 + samplesRun2) * 4);
  assertStrictEquals(mesh.triangleCount, (samplesRun0 - 1 + samplesRun2 - 1) * 4 * 2);
});

Deno.test('every vertex, normal, and residue mapping is finite and in range', () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 6);
  assertFinite(mesh.positions); assertFinite(mesh.normals);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const len = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
    assert(Math.abs(len - 1) < 1e-4, `normal ${i / 3} is not unit length`);
  }
  for (const row of mesh.residue) assert([0,1,2,3,5,6,7].includes(row));
  for (const i of mesh.indices) assert(i >= 0 && i < mesh.vertexCount);
});

Deno.test('never bridges two runs: the two runs occupy disjoint position clusters', () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 4);
  const runOfResidue = (row: number) => row <= 3 ? 0 : 2;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const runs = [0, 1, 2].map(k => runOfResidue(mesh.residue[mesh.indices[i + k]]));
    assertStrictEquals(runs[0], runs[1]); assertStrictEquals(runs[1], runs[2]);
  }
});

Deno.test('helix cross-section is wider than coil (RIBBON_WIDTH by secondary structure)', () => {
  const { trace, ss } = fixture();
  const mesh = buildRibbonGeometry(trace, ss, 4);
  const extentAt = (residueRow: number) => {
    let min = Infinity, max = -Infinity;
    for (let v = 0; v < mesh.vertexCount; v++) {
      if (mesh.residue[v] !== residueRow) continue;
      min = Math.min(min, mesh.positions[v * 3 + 1]); max = Math.max(max, mesh.positions[v * 3 + 1]);
    }
    return max - min;
  };
  assert(extentAt(1) > extentAt(6), 'a helix residue should be wider than a coil residue');
});

Deno.test('empty trace (no runs) produces zero geometry', () => {
  const mesh = buildRibbonGeometry({ guide: new Float32Array(), residue: new Uint32Array(), runs: Uint32Array.from([0]) },
    { direction: new Float32Array(), kind: [], first: new Uint8Array(), last: new Uint8Array() }, 4);
  assertStrictEquals(mesh.count, 0);
  assertStrictEquals(mesh.vertexCount, 0);
  assertStrictEquals(mesh.triangleCount, 0);
});

Deno.test('rejects a non-positive-integer linearSegments', () => {
  const { trace, ss } = fixture();
  assertThrows(() => buildRibbonGeometry(trace, ss, 0), Error, 'positive integer');
  assertThrows(() => buildRibbonGeometry(trace, ss, 2.5), Error, 'positive integer');
});
