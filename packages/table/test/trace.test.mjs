import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStructure, activeAtoms, traceTable } from '../src/index.mjs';

function identity16() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

/**
 * Five chains exercising: a protein run with a missing-residue gap, an
 * isolated single-residue chain, a DNA run, an altloc-duplicated guide atom,
 * and a chain used only by the selection-gap test below.
 */
function traceFixture() {
  const atoms = {
    // chain0: res0..res4, gap between labelSeq 3 and 5
    positions: [0,0,0, 1,0,0, 2,1,0, 10,1,0, 11,2,0,
      // chain1: res5, isolated
      0,5,0,
      // chain2: res6..res8 (DNA)
      0,0,10, 1,0,10, 2,1,10,
      // chain3: res9 (altloc CA x2), res10
      0,0,20, 0.1,0,20, 1,0,20,
      // chain4: res11..res13 (selection-gap fixture)
      0,0,30, 1,0,30, 2,1,30],
    name: ['CA','CA','CA','CA','CA', 'CA', "O3'","O3'","O3'", 'CA','CA','CA', 'CA','CA','CA'],
    altloc: ['','','','','', '', '','','', 'A','B','', '','',''],
    residue: [0,1,2,3,4, 5, 6,7,8, 9,9,10, 11,12,13],
    occupancy: [1,1,1,1,1, 1, 1,1,1, .6,.4,1, 1,1,1],
  };
  const n = atoms.name.length;
  return {
    positions: Float32Array.from(atoms.positions),
    topology: {
      atoms: {
        count: n, id: atoms.name.map((_, i) => String(i + 1)), name: atoms.name, altloc: atoms.altloc,
        residue: Uint32Array.from(atoms.residue), element: Uint8Array.from(atoms.name, nm => nm === "O3'" ? 8 : 6),
        occupancy: Float32Array.from(atoms.occupancy), bfactor: new Float32Array(n),
      },
      residues: {
        count: 14,
        chain: Uint32Array.from([0,0,0,0,0, 1, 2,2,2, 3,3, 4,4,4]),
        labelSeq: Int32Array.from([1,2,3,5,6, 1, 1,2,3, 1,2, 1,2,3]),
        authSeq: ['1','2','3','5','6', '1', '1','2','3', '1','2', '1','2','3'],
        insertionCode: new Array(14).fill(''),
        comp: ['ALA','ALA','ALA','ALA','ALA', 'GLY', 'DA','DC','DG', 'ALA','ALA', 'ALA','ALA','ALA'],
        polymer: ['protein','protein','protein','protein','protein', 'protein', 'dna','dna','dna', 'protein','protein', 'protein','protein','protein'],
      },
      chains: { count: 5, model: Int32Array.from([1,1,1,1,1]), labelId: ['A','B','C','D','E'], authId: ['A','B','C','D','E'] },
      bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
      instances: { count: 5, chain: Uint32Array.from([0,1,2,3,4]), operatorId: new Array(5).fill('identity'),
        transform: Float64Array.from([0,1,2,3,4].flatMap(identity16)) },
    },
  };
}

const all = data => Uint32Array.from({ length: data.topology.atoms.count }, (_, i) => i);

function assertFinite(arr) { for (const v of arr) assert.ok(Number.isFinite(v)); }

test('splits a missing-residue gap into separate runs and keeps a single residue as its own run', () => {
  const data = createStructure(traceFixture());
  const trace = traceTable(data, all(data));
  // runs, in chain order: [0..2] (labelSeq 1-3), [3..4] (labelSeq 5-6), [5] (isolated), DNA[6..8], altloc pair[9..10], gap-fixture[11..13]
  assert.deepEqual([...trace.runs], [0, 3, 5, 6, 9, 11, 14]);
  assert.equal(trace.count, 14);
  assert.deepEqual([...trace.residue], [0,1,2, 3,4, 5, 6,7,8, 9,10, 11,12,13]);
  assert.deepEqual(trace.runKind, ['protein','protein','protein','dna','protein','protein']);
  assertFinite(trace.guide); assertFinite(trace.tangent); assertFinite(trace.normal); assertFinite(trace.binormal);
});

test('a selection gap breaks the run exactly like a missing residue, never reconnecting it', () => {
  const data = createStructure(traceFixture());
  const full = all(data);
  const withoutMiddleCA = Uint32Array.from(full.filter(i => i !== 13)); // residue 12's CA atom
  const trace = traceTable(data, withoutMiddleCA);
  const chain4Runs = [];
  for (let r = 0; r < trace.runs.length - 1; r++) {
    const start = trace.runs[r], end = trace.runs[r + 1];
    if (trace.residue[start] >= 11) chain4Runs.push([...trace.residue.slice(start, end)]);
  }
  assert.deepEqual(chain4Runs, [[11], [13]], 'residue 12 is dropped, not bridged');
  assert.equal(trace.count, 13, 'residue 12 contributes no sample at all');
});

test('an untouched selection keeps the same three residues as one contiguous run', () => {
  const data = createStructure(traceFixture());
  const trace = traceTable(data, all(data));
  const start = trace.residue.indexOf(11);
  const run = trace.runs.findIndex((offset, i) => offset <= start && start < trace.runs[i + 1]);
  assert.deepEqual([...trace.residue.slice(trace.runs[run], trace.runs[run + 1])], [11, 12, 13]);
});

test('altloc policy resolves one guide atom per residue, not one per conformer', () => {
  const data = createStructure(traceFixture());
  const trace = traceTable(data, activeAtoms(data)); // default: primary altloc by occupancy
  const start = trace.residue.indexOf(9);
  assert.notEqual(start, -1);
  assert.deepEqual([...trace.residue.slice(start, start + 2)], [9, 10]);
  // altloc A (occupancy .6) wins over B (.4); guide position matches atom 9, not atom 10.
  assert.deepEqual([...trace.guide.slice(start * 3, start * 3 + 3)], [0, 0, 20]);
});

test('nucleic guide atoms use O3\' and are tagged with a dna run kind', () => {
  const data = createStructure(traceFixture());
  const trace = traceTable(data, all(data));
  const start = trace.residue.indexOf(6);
  const run = trace.runs.findIndex((offset, i) => offset <= start && start < trace.runs[i + 1]);
  assert.equal(trace.runKind[run], 'dna');
  assert.deepEqual([...trace.residue.slice(trace.runs[run], trace.runs[run + 1])], [6, 7, 8]);
});

test('empty selection produces an empty, well-formed trace', () => {
  const data = createStructure(traceFixture());
  const trace = traceTable(data, new Uint32Array());
  assert.equal(trace.count, 0);
  assert.deepEqual([...trace.runs], [0]);
  assert.deepEqual(trace.runKind, []);
});

test('rejects a non-Uint32Array selection', () => {
  const data = createStructure(traceFixture());
  assert.throws(() => traceTable(data, [0, 1, 2]), /Uint32Array/);
});
