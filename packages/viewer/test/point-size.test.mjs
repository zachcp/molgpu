import test from 'node:test';
import assert from 'node:assert/strict';
import { pointSizeForCameraRadius, pointSizeForRadius, pointSizesForRadii } from '../src/internal/point-size.ts';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} !== ${expected}`);

test('PointLayer diameter conversion agrees with the pinned depth:1 shader contract', () => {
  // OrbitCamera publishes viewScale = radius * 2*tan(fov/2)/height and
  // worldScale = focus/radius. Their radius cancels in depth:1 sizing.
  for (const camera of [
    { height: 600, pixelRatio: 1, fov: Math.PI / 3, focus: 5, radius: 34 },
    { height: 900, pixelRatio: 2, fov: Math.PI / 4, focus: 9, radius: 80 },
    // Orthographic OrbitCamera uses the same published scale product.
    { height: 720, pixelRatio: 1.5, fov: Math.PI / 2, focus: 3, radius: 25 },
  ]) {
    const viewScale = camera.radius * 2 * Math.tan(camera.fov / 2) / camera.height;
    const worldScale = camera.focus / camera.radius;
    close(
      pointSizeForRadius(1.7, { pixelRatio: camera.pixelRatio, viewScale, worldScale }),
      pointSizeForCameraRadius(1.7, camera),
    );
  }
});

test('conversion preserves physical radius ratios and produces a derived size column', () => {
  const view = { pixelRatio: 2, viewScale: 0.02, worldScale: 0.25 };
  const sizes = pointSizesForRadii(Float32Array.of(1, 1.7, 2), view);
  close(sizes[1] / sizes[0], 1.7);
  close(sizes[2] / sizes[0], 2);
  assert.throws(() => pointSizeForRadius(1, { ...view, viewScale: 0 }), /positive/);
});

test('OrbitCamera radius changes keep the PointLayer size-column input stable', () => {
  const sizeAt = radius => {
    const viewScale = radius * 2 * Math.tan(Math.PI / 6) / 600;
    const worldScale = 5 / radius;
    return pointSizeForRadius(1.7, { pixelRatio: 2, viewScale, worldScale });
  };
  close(sizeAt(20), sizeAt(80));
});
