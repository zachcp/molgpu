import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStructure } from '@molgpu/table';
import { COLOR, byElement, byBfactor, bySeq, byChain, columnRange, evaluate, compile } from '../src/index.mjs';
import { fixture } from './fixture.mjs';

// The base fixture: 4 atoms C/N/O/S, residues 0,0,1,1, bfactor 10..40, one chain.
const data = createStructure(fixture());
const near = (out, i, expected, eps = 1e-6) => {
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(out[i * 4 + k] - expected[k]) <= eps, `row ${i}[${k}]: ${out[i * 4 + k]} != ${expected[k]}`);
};

test('byElement colours known elements by CPK and others by fallback', () => {
  const f = byElement([0.1, 0.1, 0.1, 1]);
  assert.equal(f.type, COLOR);
  const out = evaluate(f, data);                  // C, N, O, S
  near(out, 1, [0.35, 0.5, 0.92, 1]); // N blue
  near(out, 2, [0.9, 0.36, 0.33, 1]); // O red
  near(out, 3, [0.95, 0.8, 0.3, 1]);  // S yellow
  // an element outside the CPK set falls back
  const argon = createStructure({ ...fixture(), topology: { ...fixture().topology, atoms: { ...fixture().topology.atoms, element: Uint8Array.from([18, 6, 8, 16]) } } });
  near(evaluate(f, argon), 0, [0.1, 0.1, 0.1, 1]);
});

test('byBfactor ramps over its domain and clamps outside it', () => {
  const f = byBfactor({ domain: [10, 40], stops: [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]] });
  const out = evaluate(f, data);
  near(out, 0, [0, 0, 0, 1]);   // bfactor 10 -> 0
  near(out, 3, [1, 1, 1, 1]);   // bfactor 40 -> 1
  // a tighter domain saturates the ends (clamp)
  const tight = evaluate(byBfactor({ domain: [20, 30], stops: [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]] }), data);
  near(tight, 0, [0, 0, 0, 1]);
  near(tight, 3, [1, 1, 1, 1]);
});

test('bySeq colours atoms along the residue index', () => {
  const domain = columnRange(data, 'residue');     // [0, 1] for two residues
  assert.deepEqual(domain, [0, 1]);
  const f = bySeq({ domain, stops: [[0, [1, 0, 0, 1]], [1, [0, 0, 1, 1]]] });
  const out = evaluate(f, data);
  near(out, 0, [1, 0, 0, 1]); // residue 0
  near(out, 3, [0, 0, 1, 1]); // residue 1
});

test('byChain colours atoms by their chain via the derived atom->chain column', () => {
  // Two chains: residues 0->chain 0, residue 1->chain 1.
  const input = fixture();
  input.topology.residues.chain = Uint32Array.from([0, 1]);
  input.topology.chains = { count: 2, model: Int32Array.from([1, 1]), labelId: ['A', 'B'], authId: ['A', 'B'] };
  const two = createStructure(input);
  const f = byChain({ palette: [[1, 0, 0, 1], [0, 1, 0, 1]] });
  const out = evaluate(f, two);
  near(out, 0, [1, 0, 0, 1]); // atom 0, residue 0, chain 0
  near(out, 3, [0, 1, 0, 1]); // atom 3, residue 1, chain 1
});

test('columnRange handles empty and constant columns', () => {
  assert.deepEqual(columnRange(data, 'bfactor'), [10, 40]);
  assert.deepEqual(columnRange(data, 'occupancy'), [1, 2]); // all 1 -> [lo, lo+1]
  assert.throws(() => columnRange(data, 'nope'), /unknown column/);
});

test('every built-in lowers to WGSL for both targets', () => {
  for (const f of [byElement(), byBfactor(), bySeq({ domain: [0, 1] }), byChain()]) {
    assert.equal(compile(f, { domain: 'atom' }).valueType, COLOR);
    const linked = compile(f, { domain: 'atom', target: 'link' });
    assert.match(linked.wgsl, /@export fn getField\(row: u32\) -> vec4<f32>/);
    assert.doesNotMatch(linked.wgsl, /@group/);
  }
});
