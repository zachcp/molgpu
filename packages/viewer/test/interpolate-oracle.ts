import { minimumImage, type PeriodicBox } from "@molgpu/dynamics";
import {
  trajectoryImageBox,
  TrajectoryImageBoxLimitError,
} from "../src/trajectory/frame-window.ts";

/**
 * CPU reference for the interpolation kernel: `p0 + t (p1 - p0)` per atom, or
 * with `box` the nearest Cartesian image in that box. The WGSL kernel
 * implements the same bounded search.
 */
export function interpolatePositions(
  p0: Float32Array,
  p1: Float32Array,
  t: number,
  box?: ArrayLike<number>,
): Float32Array {
  const out = new Float32Array(p0.length);
  let prepared: PeriodicBox | null = null;
  if (box) {
    try {
      prepared = trajectoryImageBox(box);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      if (error instanceof TrajectoryImageBoxLimitError) throw error;
    }
  }
  for (let i = 0; i < p0.length; i += 3) {
    let d = [p1[i] - p0[i], p1[i + 1] - p0[i + 1], p1[i + 2] - p0[i + 2]];
    if (prepared) d = [...minimumImage(d, prepared.matrix, 1_000_000)];
    out[i] = p0[i] + t * d[0];
    out[i + 1] = p0[i + 1] + t * d[1];
    out[i + 2] = p0[i + 2] + t * d[2];
  }
  return out;
}
