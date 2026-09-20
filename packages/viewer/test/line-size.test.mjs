import test from 'node:test';
import assert from 'node:assert/strict';
import { lineRadiusForWidth } from '../src/internal/line-size.mjs';

test('shaded LineLayer depth:-1 makes width an absolute world-space diameter', () => {
  assert.equal(lineRadiusForWidth(0.5, -1, { pixelRatio: 2, viewScale: .01, worldScale: .2, clipW: 30 }), .25);
});
test('depth:0 is screen-space and depth:1 remains camera-normalized', () => {
  const view = { pixelRatio: 2, viewScale: .01, worldScale: .2 };
  assert.equal(lineRadiusForWidth(10, 0, { ...view, clipW: 20 }), 2);
  assert.equal(lineRadiusForWidth(10, 0, { ...view, clipW: 40 }), 4);
  assert.equal(lineRadiusForWidth(10, 1, { ...view, clipW: 20 }), lineRadiusForWidth(10, 1, { ...view, clipW: 40 }));
});
