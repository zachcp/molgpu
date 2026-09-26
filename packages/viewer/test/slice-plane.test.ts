import { assert, assertAlmostEquals, assertThrows } from "@std/assert";
import {
  createVolume,
  volumeIndexToWorld,
  volumeWorldToIndex,
} from "@molgpu/table";
import { sliceCorner, slicePlaneFrame } from "../src/internal/slice-plane.ts";

const volume = createVolume({
  values: new Float32Array(6 * 5 * 4),
  dims: [6, 5, 4],
  transform: [0.9, 0.2, 0, 0, 0.3, 1.1, 0.1, 0, 0, -0.2, 0.7, 0, -4, 2, 5, 1],
});
const dot = (a: number[], b: number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (
  a: number[],
  b: number[],
) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function covers(frame: ReturnType<typeof slicePlaneFrame>) {
  // Every grid corner, projected into the plane, falls inside the square.
  const r = Math.hypot(...frame.u);
  const u = frame.u.map((x) => x / r), v = frame.v.map((x) => x / r);
  for (const i of [0, 5]) {
    for (const j of [0, 4]) {
      for (const k of [0, 3]) {
        const d = sub(volumeIndexToWorld(volume, i, j, k), frame.center);
        assert(Math.abs(dot(d, u)) <= r && Math.abs(dot(d, v)) <= r);
      }
    }
  }
}

Deno.test("a grid-axis plane follows the shear: every corner keeps its index", () => {
  for (const axis of [0, 1, 2] as const) {
    const frame = slicePlaneFrame(volume, { axis, index: 1.25 });
    for (let c = 0; c < 4; c++) {
      const w = sliceCorner(frame, c);
      const index = volumeWorldToIndex(volume, w[0], w[1], w[2]);
      assertAlmostEquals(index[axis], 1.25, 1e-9);
    }
    covers(frame);
  }
});

Deno.test("a world plane passes through its point with its normal", () => {
  const normal: [number, number, number] = [1, 2, -0.5];
  const point: [number, number, number] = [-1, 3, 5.5];
  const frame = slicePlaneFrame(volume, { normal, point });
  const n = Math.hypot(...normal);
  for (let c = 0; c < 4; c++) {
    const d = sub(sliceCorner(frame, c), point);
    assertAlmostEquals(dot(d, normal) / n, 0, 1e-9);
  }
  covers(frame);
  // Without a point the plane passes through the grid's middle.
  const middle = volumeIndexToWorld(volume, 2.5, 2, 1.5);
  const centred = slicePlaneFrame(volume, { normal });
  assertAlmostEquals(dot(sub(centred.center, middle), normal), 0, 1e-9);
});

Deno.test("invalid planes throw", () => {
  assertThrows(() => slicePlaneFrame(volume, { normal: [0, 0, 0] }), TypeError);
  assertThrows(
    () => slicePlaneFrame(volume, { axis: 3 as 0, index: 0 }),
    TypeError,
  );
  assertThrows(
    () => slicePlaneFrame(volume, { axis: 0, index: NaN }),
    TypeError,
  );
});
