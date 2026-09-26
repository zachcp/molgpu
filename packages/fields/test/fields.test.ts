import { assert, assertEquals, assertMatch, assertNotMatch, assertStrictEquals, assertThrows } from '@std/assert';
import {
  SCALAR, COLOR, STRING,
  constant, attribute, categorical, linear, colormap, annotation, curve,
  evaluate, compile,
} from '../src/index.ts';
import type { Color } from '../src/index.ts';
import { structure } from './fixture.ts';

const RED: Color = [1, 0, 0, 1], BLUE: Color = [0, 0, 1, 1], GREY: Color = [0.5, 0.5, 0.5, 1];
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const numeric = (v: Float32Array | string[]): Float32Array => {
  assert(v instanceof Float32Array, 'expected a numeric field');
  return v;
};

Deno.test('constant broadcasts one value to every row of the target domain', () => {
  const data = structure();
  assertEquals([...evaluate(constant(0.5), data, { domain: 'atom' })], [0.5, 0.5, 0.5, 0.5]);
  assertEquals([...evaluate(constant(RED), data, { domain: 'residue' })], [1, 0, 0, 1, 1, 0, 0, 1]);
  assertEquals(evaluate(constant('site'), data, { domain: 'residue' }), ['site', 'site']);
  assertThrows(() => evaluate(constant(0.5), data), Error, 'needs an explicit'); // no domain
});

Deno.test('attribute reads a numeric column on its own domain', () => {
  const data = structure();
  assertEquals([...evaluate(attribute('element'), data)], [6, 7, 8, 16]);
  assertEquals([...evaluate(attribute('bfactor'), data)], [10, 20, 30, 40]);
  assertStrictEquals(attribute('labelSeq').domain, 'residue');
  assertEquals([...evaluate(attribute('labelSeq'), data)], [1, 2]);
});

Deno.test('categorical maps integer categories with an explicit fallback', () => {
  const data = structure();
  const byElement = categorical(attribute('element'), { 6: RED, 7: BLUE }, GREY);
  assertStrictEquals(byElement.type, COLOR);
  assertEquals([...evaluate(byElement, data)], [
    ...RED,   // C
    ...BLUE,  // N
    ...GREY,  // O -> fallback
    ...GREY,  // S -> fallback
  ]);
});

Deno.test('linear normalizes over a domain with clamp and wrap overflow', () => {
  const data = structure();
  const norm = numeric(evaluate(linear(attribute('bfactor'), { domain: [10, 40] }), data));
  [0, 1 / 3, 2 / 3, 1].forEach((want, i) => assert(near(norm[i], want), `row ${i}: ${norm[i]} != ${want}`));
  // clamp holds ends; a tighter domain saturates
  assertEquals([...evaluate(linear(attribute('bfactor'), { domain: [20, 30] }), data)], [0, 0, 1, 1]);
  // fail policy throws on the CPU for out-of-range input
  assertThrows(() => evaluate(linear(attribute('bfactor'), { domain: [20, 30], overflow: 'fail' }), data), Error, 'outside domain');
});

Deno.test('colormap interpolates a gradient over a scalar input', () => {
  const data = structure();
  const g = colormap(linear(attribute('bfactor'), { domain: [10, 40] }), [[0, BLUE], [1, RED]]);
  assertStrictEquals(g.type, COLOR);
  const out = numeric(evaluate(g, data));
  assertEquals([...out.slice(0, 4)], [...BLUE]);          // bfactor 10 -> 0 -> blue
  assertEquals([...out.slice(12)], [...RED]);            // bfactor 40 -> 1 -> red
  assert(near(out[8], 2 / 3) && near(out[10], 1 / 3)); // bfactor 30 -> 2/3 up the ramp
});

Deno.test('annotation joins external per-row values with an explicit missing policy', () => {
  const data = structure();
  const values = Float32Array.from([100, 0, 200, 0]);
  const missing = Uint8Array.from([1, 0, 1, 0]);           // rows 1,3 absent
  const fallbackField = annotation('atom', SCALAR, values, { missing, policy: 'fallback', fallback: -1 });
  assertEquals([...evaluate(fallbackField, data)], [100, -1, 200, -1]);
  const failField = annotation('atom', SCALAR, values, { missing, policy: 'fail' });
  assertThrows(() => evaluate(failField, data), Error, 'missing value');
});

Deno.test('curve samples a scalar along the global t uniform', () => {
  const data = structure();
  const c = curve([[0, 0], [1, 10]]);
  assertEquals([...evaluate(c, data, { domain: 'atom', t: 0 })], [0, 0, 0, 0]);
  assertEquals([...evaluate(c, data, { domain: 'atom', t: 0.5 })], [5, 5, 5, 5]);
  assertEquals([...evaluate(c, data, { domain: 'atom', t: 2 })], [10, 10, 10, 10]); // clamp
});

Deno.test('rejects wrong types, unknown columns, mixed domains, and CPU-only lowering', () => {
  // @ts-expect-error: not a column
  assertThrows(() => attribute('nope'), Error, 'unknown column');
  assertThrows(() => categorical(attribute('element'), {}, GREY), Error, 'at least one case');
  assertThrows(() => categorical(constant(RED), { 1: RED }, GREY), Error, 'scalar field'); // color input
  assertThrows(() => colormap(constant(RED), [[0, BLUE], [1, RED]]), Error, 'scalar field');
  assertMatch((assertThrows(() => linear(attribute('element'), { domain: [1, 1] }), Error)).message, /lo != hi/);
  // string fields and 'fail' overflow do not lower to WGSL
  assertThrows(() => compile(constant('label')), Error, 'CPU-only');
  assertThrows(() => compile(linear(attribute('bfactor'), { domain: [0, 1], overflow: 'fail' })), Error, 'CPU-only');
});

Deno.test('compile emits self-contained WGSL and a plain binding schema (no ShaderSource)', () => {
  const data = structure();
  const byElement = categorical(attribute('element'), { 6: RED, 7: BLUE }, GREY);
  const c = compile(byElement);
  assertStrictEquals(c.valueType, COLOR);
  assertStrictEquals(c.domain, 'atom');
  assertMatch(c.wgsl, /fn evalField\(row: u32\) -> vec4<f32>/);
  assertMatch(c.wgsl, /var<storage, read> _buf0: array<f32>/);
  assertStrictEquals(c.bindings.length, 1);
  assertStrictEquals(c.bindings[0].kind, 'buffer');
  // the link target swaps @group bindings for @link accessors and an @export entry
  const linked = compile(byElement, { target: 'link' });
  assertMatch(linked.wgsl, /@link fn field_get0\(i: u32\) -> f32;/);
  assertMatch(linked.wgsl, /@export fn getField\(row: u32\) -> vec4<f32>/);
  assertNotMatch(linked.wgsl, /@group/);
  assertStrictEquals(linked.entry, 'getField');
  assertEquals(linked.bindings.map((b) => b.accessor), ['field_get0']);
  // the binding's fill is a pure function producing the element column as f32
  assertEquals([...c.bindings[0].fill(data)], [6, 7, 8, 16]);
  // a colormap over an attribute needs exactly one input; a curve adds a uniform
  assertStrictEquals(compile(colormap(linear(attribute('bfactor'), { domain: [10, 40] }), [[0, BLUE], [1, RED]])).bindings.length, 1);
  const cc = compile(curve([[0, 0], [1, 1]]));
  assertStrictEquals(cc.bindings[0].kind, 'uniform');
  assertEquals([...cc.bindings[0].fill({ t: 0.25 })], [0.25]);
});
