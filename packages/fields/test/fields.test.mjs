import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SCALAR, COLOR, STRING,
  constant, attribute, categorical, linear, colormap, annotation, curve,
  evaluate, compile,
} from '../src/index.mjs';
import { structure } from './fixture.mjs';

const RED = [1, 0, 0, 1], BLUE = [0, 0, 1, 1], GREY = [0.5, 0.5, 0.5, 1];
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('constant broadcasts one value to every row of the target domain', () => {
  const data = structure();
  assert.deepEqual([...evaluate(constant(0.5), data, { domain: 'atom' })], [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual([...evaluate(constant(RED), data, { domain: 'residue' })], [1, 0, 0, 1, 1, 0, 0, 1]);
  assert.deepEqual(evaluate(constant('site'), data, { domain: 'residue' }), ['site', 'site']);
  assert.throws(() => evaluate(constant(0.5), data), /needs an explicit/); // no domain
});

test('attribute reads a numeric column on its own domain', () => {
  const data = structure();
  assert.deepEqual([...evaluate(attribute('element'), data)], [6, 7, 8, 16]);
  assert.deepEqual([...evaluate(attribute('bfactor'), data)], [10, 20, 30, 40]);
  assert.equal(attribute('labelSeq').domain, 'residue');
  assert.deepEqual([...evaluate(attribute('labelSeq'), data)], [1, 2]);
});

test('categorical maps integer categories with an explicit fallback', () => {
  const data = structure();
  const byElement = categorical(attribute('element'), { 6: RED, 7: BLUE }, GREY);
  assert.equal(byElement.type, COLOR);
  assert.deepEqual([...evaluate(byElement, data)], [
    ...RED,   // C
    ...BLUE,  // N
    ...GREY,  // O -> fallback
    ...GREY,  // S -> fallback
  ]);
});

test('linear normalizes over a domain with clamp and wrap overflow', () => {
  const data = structure();
  const norm = evaluate(linear(attribute('bfactor'), { domain: [10, 40] }), data);
  [0, 1 / 3, 2 / 3, 1].forEach((want, i) => assert.ok(near(norm[i], want), `row ${i}: ${norm[i]} != ${want}`));
  // clamp holds ends; a tighter domain saturates
  assert.deepEqual([...evaluate(linear(attribute('bfactor'), { domain: [20, 30] }), data)], [0, 0, 1, 1]);
  // fail policy throws on the CPU for out-of-range input
  assert.throws(() => evaluate(linear(attribute('bfactor'), { domain: [20, 30], overflow: 'fail' }), data), /outside domain/);
});

test('colormap interpolates a gradient over a scalar input', () => {
  const data = structure();
  const g = colormap(linear(attribute('bfactor'), { domain: [10, 40] }), [[0, BLUE], [1, RED]]);
  assert.equal(g.type, COLOR);
  const out = evaluate(g, data);
  assert.deepEqual([...out.slice(0, 4)], BLUE);          // bfactor 10 -> 0 -> blue
  assert.deepEqual([...out.slice(12)], RED);             // bfactor 40 -> 1 -> red
  assert.ok(near(out[8], 2 / 3) && near(out[10], 1 / 3)); // bfactor 30 -> 2/3 up the ramp
});

test('annotation joins external per-row values with an explicit missing policy', () => {
  const data = structure();
  const values = Float32Array.from([100, 0, 200, 0]);
  const missing = Uint8Array.from([1, 0, 1, 0]);           // rows 1,3 absent
  const fallbackField = annotation('atom', SCALAR, values, { missing, policy: 'fallback', fallback: -1 });
  assert.deepEqual([...evaluate(fallbackField, data)], [100, -1, 200, -1]);
  const failField = annotation('atom', SCALAR, values, { missing, policy: 'fail' });
  assert.throws(() => evaluate(failField, data), /missing value/);
});

test('curve samples a scalar along the global t uniform', () => {
  const data = structure();
  const c = curve([[0, 0], [1, 10]]);
  assert.deepEqual([...evaluate(c, data, { domain: 'atom', t: 0 })], [0, 0, 0, 0]);
  assert.deepEqual([...evaluate(c, data, { domain: 'atom', t: 0.5 })], [5, 5, 5, 5]);
  assert.deepEqual([...evaluate(c, data, { domain: 'atom', t: 2 })], [10, 10, 10, 10]); // clamp
});

test('rejects wrong types, unknown columns, mixed domains, and CPU-only lowering', () => {
  assert.throws(() => attribute('nope'), /unknown column/);
  assert.throws(() => categorical(attribute('element'), {}, GREY), /at least one case/);
  assert.throws(() => categorical(constant(RED), { 1: RED }, GREY), /scalar field/); // color input
  assert.throws(() => colormap(constant(RED), [[0, BLUE], [1, RED]]), /scalar field/);
  assert.throws(() => linear(attribute('element'), { domain: [1, 1] }), /lo != hi/);
  // string fields and 'fail' overflow do not lower to WGSL
  assert.throws(() => compile(constant('label')), /CPU-only/);
  assert.throws(() => compile(linear(attribute('bfactor'), { domain: [0, 1], overflow: 'fail' })), /CPU-only/);
});

test('compile emits self-contained WGSL and a plain binding schema (no ShaderSource)', () => {
  const data = structure();
  const byElement = categorical(attribute('element'), { 6: RED, 7: BLUE }, GREY);
  const c = compile(byElement);
  assert.equal(c.valueType, COLOR);
  assert.equal(c.domain, 'atom');
  assert.match(c.wgsl, /fn evalField\(row: u32\) -> vec4<f32>/);
  assert.match(c.wgsl, /var<storage, read> in0: array<f32>/);
  assert.equal(c.bindings.length, 1);
  assert.equal(c.bindings[0].kind, 'buffer');
  // the binding's fill is a pure function producing the element column as f32
  assert.deepEqual([...c.bindings[0].fill(data)], [6, 7, 8, 16]);
  // a colormap over an attribute needs exactly one input; a curve adds a uniform
  assert.equal(compile(colormap(linear(attribute('bfactor'), { domain: [10, 40] }), [[0, BLUE], [1, RED]])).bindings.length, 1);
  const cc = compile(curve([[0, 0], [1, 1]]));
  assert.equal(cc.bindings[0].kind, 'uniform');
  assert.deepEqual([...cc.bindings[0].fill({ t: 0.25 })], [0.25]);
});
