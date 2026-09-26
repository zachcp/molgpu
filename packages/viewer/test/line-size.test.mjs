import test from 'node:test';
import assert from 'node:assert/strict';
import { lineRadiusForWidth, lineWidthForRadius } from '../src/internal/line-size.ts';

test('shaded LineLayer depth:-1 makes width an absolute world-space diameter', () => {
  assert.equal(lineRadiusForWidth(0.5, -1, { pixelRatio: 2, viewScale: .01, worldScale: .2, clipW: 30 }), .25);
});
test('depth:0 is screen-space and depth:1 remains camera-normalized', () => {
  const view = { pixelRatio: 2, viewScale: .01, worldScale: .2 };
  assert.equal(lineRadiusForWidth(10, 0, { ...view, clipW: 20 }), 2);
  assert.equal(lineRadiusForWidth(10, 0, { ...view, clipW: 40 }), 4);
  assert.equal(lineRadiusForWidth(10, 1, { ...view, clipW: 20 }), lineRadiusForWidth(10, 1, { ...view, clipW: 40 }));
});

test('lineWidthForRadius is the exact inverse of lineRadiusForWidth at every depth mode', () => {
  const view = { pixelRatio: 2, viewScale: .01, worldScale: .2, clipW: 30 };
  for (const depth of [-1, 0, 1]) {
    const width = lineWidthForRadius(0.35, depth, view);
    assert.ok(Math.abs(lineRadiusForWidth(width, depth, view) - 0.35) < 1e-12);
  }
});

test('lineWidthForRadius at depth:-1 needs no view scale at all', () => {
  assert.equal(lineWidthForRadius(0.3, -1), 0.6);
  assert.equal(lineWidthForRadius(0.3, -1, { pixelRatio: 99, viewScale: 99, worldScale: 99, clipW: 99 }), 0.6);
});

test('lineWidthForRadius rejects non-positive inputs', () => {
  assert.throws(() => lineWidthForRadius(0, -1), /positive finite/);
  assert.throws(() => lineWidthForRadius(-1, -1), /positive finite/);
  assert.throws(() => lineWidthForRadius(NaN, -1), /positive finite/);
});
