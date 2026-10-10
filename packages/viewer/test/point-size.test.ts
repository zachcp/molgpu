import { assert, assertThrows } from "@std/assert";
import {
  pointSizeForCameraRadius,
  pointSizeForRadius,
} from "../src/rendering/point-size.ts";

const close = (actual: number, expected: number) =>
  assert(Math.abs(actual - expected) < 1e-5, `${actual} !== ${expected}`);

Deno.test("PointLayer diameter conversion agrees with the pinned depth:1 shader contract", () => {
  // OrbitCamera publishes viewScale = radius * 2*tan(fov/2)/height and
  // worldScale = focus/radius. Their radius cancels in depth:1 sizing.
  for (
    const camera of [
      { height: 600, pixelRatio: 1, fov: Math.PI / 3, focus: 5, radius: 34 },
      { height: 900, pixelRatio: 2, fov: Math.PI / 4, focus: 9, radius: 80 },
      // Orthographic OrbitCamera uses the same published scale product.
      { height: 720, pixelRatio: 1.5, fov: Math.PI / 2, focus: 3, radius: 25 },
    ]
  ) {
    const viewScale = camera.radius * 2 * Math.tan(camera.fov / 2) /
      camera.height;
    const worldScale = camera.focus / camera.radius;
    close(
      pointSizeForRadius(1.7, {
        pixelRatio: camera.pixelRatio,
        viewScale,
        worldScale,
      }),
      pointSizeForCameraRadius(1.7, camera),
    );
  }
});

Deno.test("conversion preserves physical radius ratios", () => {
  const view = { pixelRatio: 2, viewScale: 0.02, worldScale: 0.25 };
  const sizes = [1, 1.7, 2].map((radius) => pointSizeForRadius(radius, view));
  close(sizes[1] / sizes[0], 1.7);
  close(sizes[2] / sizes[0], 2);
  assertThrows(
    () => pointSizeForRadius(1, { ...view, viewScale: 0 }),
    Error,
    "positive",
  );
});

Deno.test("OrbitCamera radius changes keep the PointLayer size factor stable", () => {
  const sizeAt = (radius: number) => {
    const viewScale = radius * 2 * Math.tan(Math.PI / 6) / 600;
    const worldScale = 5 / radius;
    return pointSizeForRadius(1.7, { pixelRatio: 2, viewScale, worldScale });
  };
  close(sizeAt(20), sizeAt(80));
});
