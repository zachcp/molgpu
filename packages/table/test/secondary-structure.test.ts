import { assert, assertEquals, assertNotStrictEquals, assertStrictEquals, assertThrows } from '@std/assert';
import { createStructure, traceTable, secondaryStructureTrace } from '../src/index.ts';
import type { StructureData, StructureInput, Residues } from '../src/index.ts';
import type { Mutable } from '../../../test/support/mutable.ts';

function identity16(): number[] { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }

/**
 * Chain0: 3 protein residues with full C/O backbone (helix, helix, coil).
 * Chain1: 1 protein residue with only CA (no C/O) — direction fallback.
 * Chain2: 2 DNA residues with full C4'/C3' backbone, no coil/helix distinction.
 */
function fixture({ withAnnotation = true } = {}): Mutable<StructureInput> {
  const atoms = {
    // chain0 res0..res2: CA, C, O per residue
    positions: [
      0,0,0, 0.5,0.5,0, 0.5,1,0.6,     // res0: CA, C, O
      1,0,0, 1.5,0.5,0, 1.5,1,0.6,     // res1: CA, C, O
      2,0,0, 2.5,0.5,0, 2.5,1,0.6,     // res2: CA, C, O
      10,0,0,                          // chain1 res3: CA only
      20,0,0, 20.5,0,0.5, 21,0,0.8,    // chain2 res4: O3', C4', C3'
      21,1,0, 21.5,1,0.5, 22,1,0.8,    // chain2 res5: O3', C4', C3'
    ],
    name: [
      'CA','C','O', 'CA','C','O', 'CA','C','O',
      'CA',
      "O3'","C4'","C3'", "O3'","C4'","C3'",
    ],
    residue: [0,0,0, 1,1,1, 2,2,2, 3, 4,4,4, 5,5,5],
    element: [6,6,8, 6,6,8, 6,6,8, 6, 8,6,6, 8,6,6],
  };
  const n = atoms.name.length;
  const residues: Mutable<Residues> = {
    count: 6,
    chain: Uint32Array.from([0,0,0, 1, 2,2]),
    labelSeq: Int32Array.from([1,2,3, 1, 1,2]),
    authSeq: ['1','2','3', '1', '1','2'],
    insertionCode: new Array(6).fill(''),
    comp: ['ALA','ALA','ALA', 'GLY', 'DA','DC'],
    polymer: ['protein','protein','protein', 'protein', 'dna','dna'],
  };
  if (withAnnotation) residues.secondaryStructure = ['helix','helix','coil', 'coil', 'coil','coil'];
  return {
    positions: Float32Array.from(atoms.positions),
    topology: {
      atoms: {
        count: n, id: atoms.name.map((_, i) => String(i + 1)), name: atoms.name, altloc: new Array(n).fill(''),
        residue: Uint32Array.from(atoms.residue), element: Uint8Array.from(atoms.element),
        occupancy: new Float32Array(n).fill(1), bfactor: new Float32Array(n),
      },
      residues,
      chains: { count: 3, model: Int32Array.from([1,1,1]), labelId: ['A','B','C'], authId: ['A','B','C'] },
      bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
      instances: { count: 3, chain: Uint32Array.from([0,1,2]), operatorId: ['identity','identity','identity'],
        transform: Float64Array.from([0,1,2].flatMap(identity16)) },
    },
  };
}

const all = (data: StructureData) => Uint32Array.from({ length: data.topology.atoms.count }, (_, i) => i);

function assertFinite(arr: Iterable<number>) { for (const v of arr) assert(Number.isFinite(v)); }
function assertUnit(direction: Float32Array, k: number) {
  const x = direction[k*3], y = direction[k*3+1], z = direction[k*3+2];
  assert(Math.abs(Math.hypot(x, y, z) - 1) < 1e-5, `sample ${k} direction is not unit length`);
}

Deno.test('rejects a non-Uint32Array selection', () => {
  const data = createStructure(fixture());
  const trace = traceTable(data, all(data));
  // @ts-expect-error: a plain array, not a Uint32Array
  assertThrows(() => secondaryStructureTrace(data, [0], trace), Error, 'Uint32Array');
});

Deno.test('imported annotation labels each sample, and direction follows the real C=O / C4\'-C3\' bond', () => {
  const data = createStructure(fixture());
  const selection = all(data);
  const trace = traceTable(data, selection);
  const ss = secondaryStructureTrace(data, selection, trace);
  assertStrictEquals(ss.count, trace.count);
  assertEquals(ss.kind.slice(0, 3), ['helix', 'helix', 'coil']);
  assertFinite(ss.direction);
  for (let k = 0; k < ss.count; k++) assertUnit(ss.direction, k);

  // res0: C=[0.5,0.5,0], O=[0.5,1,0.6] -> direction = normalize(O - C).
  const expected = [0, 0.5, 0.6];
  const len = Math.hypot(...expected);
  for (let c = 0; c < 3; c++) assert(Math.abs(ss.direction[c] - expected[c] / len) < 1e-5);
});

Deno.test('a residue missing its direction atoms (CA-only) falls back to a fixed, finite direction', () => {
  const data = createStructure(fixture());
  const selection = all(data);
  const trace = traceTable(data, selection);
  const ss = secondaryStructureTrace(data, selection, trace);
  const sampleForChain1 = trace.residue.indexOf(3); // chain1's isolated CA-only residue
  assertNotStrictEquals(sampleForChain1, -1);
  assertUnit(ss.direction, sampleForChain1);
  assertEquals([...ss.direction.slice(sampleForChain1 * 3, sampleForChain1 * 3 + 3)], [0, 0, 1]);
});

Deno.test('nucleic residues resolve a direction from C4\'-C3\' with no crash and default to coil', () => {
  const data = createStructure(fixture());
  const selection = all(data);
  const trace = traceTable(data, selection);
  const ss = secondaryStructureTrace(data, selection, trace);
  const start = trace.residue.indexOf(4);
  assertEquals(ss.kind.slice(start, start + 2), ['coil', 'coil']);
  assertUnit(ss.direction, start);
  assertUnit(ss.direction, start + 1);
});

Deno.test('first/last mark run boundaries and secondary-structure transitions, never mid-block', () => {
  const data = createStructure(fixture());
  const selection = all(data);
  const trace = traceTable(data, selection);
  const ss = secondaryStructureTrace(data, selection, trace);
  const start = trace.residue.indexOf(0); // chain0 run: helix, helix, coil
  assertStrictEquals(ss.first[start], 1, 'run start is always a block start');
  assertStrictEquals(ss.last[start], 0, 'helix continues into the next sample');
  assertStrictEquals(ss.first[start + 1], 0, 'still helix: not a new block');
  assertStrictEquals(ss.last[start + 1], 1, 'helix ends here: next sample is coil');
  assertStrictEquals(ss.first[start + 2], 1, 'coil begins here');
  assertStrictEquals(ss.last[start + 2], 1, 'run end is always a block end');
});

Deno.test('with no residues.secondaryStructure column at all, every sample is coil', () => {
  const data = createStructure(fixture({ withAnnotation: false }));
  const selection = all(data);
  const trace = traceTable(data, selection);
  const ss = secondaryStructureTrace(data, selection, trace);
  assert(ss.kind.every(k => k === 'coil'));
});
