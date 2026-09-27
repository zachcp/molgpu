// Pure plane math for <VolumeSlice>: a world-space frame that covers the
// volume, from a grid-axis or world plane. No Live or GPU dependency.
import {
  type VolumeGrid,
  volumeIndexToWorld,
  volumeInverseTransform,
} from "@molgpu/table";

type Vec3 = [number, number, number];

/**
 * A slicing plane: a grid plane (`axis` 0/1/2 = i/j/k at fractional `index`,
 * which follows the grid's shear), or a world plane through `point` (default:
 * the volume's centre) with `normal`.
 */
export type SlicePlane =
  | { readonly axis: 0 | 1 | 2; readonly index: number }
  | {
    readonly normal: readonly [number, number, number];
    readonly point?: readonly [number, number, number];
  };

/** A square in the plane: centre ± u ± v covers the whole volume. */
export interface SliceFrame {
  readonly center: Vec3;
  readonly u: Vec3;
  readonly v: Vec3;
  readonly normal: Vec3;
}

const dot = (a: readonly number[], b: readonly number[]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: readonly number[], what: string): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  if (!(n > 0) || !Number.isFinite(n)) {
    throw new TypeError(`VolumeSlice: ${what} must be a nonzero finite vector`);
  }
  return [a[0] / n, a[1] / n, a[2] / n];
};
const finite3 = (a: unknown, what: string): readonly number[] => {
  if (
    !Array.isArray(a) || a.length !== 3 || !a.every(Number.isFinite)
  ) throw new TypeError(`VolumeSlice: ${what} must be three finite numbers`);
  return a;
};

/** World-space frame for `plane` over `volume`. */
export function slicePlaneFrame(
  volume: VolumeGrid,
  plane: SlicePlane,
): SliceFrame {
  const [nx, ny, nz] = volume.dims;
  const mid = [(nx - 1) / 2, (ny - 1) / 2, (nz - 1) / 2];
  const middle = volumeIndexToWorld(volume, mid[0], mid[1], mid[2]);
  let point: readonly number[], normal: Vec3;
  if ("axis" in plane) {
    if (![0, 1, 2].includes(plane.axis)) {
      throw new TypeError("VolumeSlice: axis must be 0, 1 or 2");
    }
    if (!Number.isFinite(plane.index)) {
      throw new TypeError("VolumeSlice: index must be finite");
    }
    const at = [...mid];
    at[plane.axis] = plane.index;
    point = volumeIndexToWorld(volume, at[0], at[1], at[2]);
    // A grid plane's world normal is the matching row of the inverse affine.
    const m = volumeInverseTransform(volume);
    normal = unit(
      [m[plane.axis], m[4 + plane.axis], m[8 + plane.axis]],
      "grid axis",
    );
  } else {
    normal = unit(finite3(plane.normal, "normal"), "normal");
    point = plane.point ? finite3(plane.point, "point") : middle;
  }
  // Half-extent: the farthest grid corner from the middle.
  let radius = 0;
  for (const i of [0, nx - 1]) {
    for (const j of [0, ny - 1]) {
      for (const k of [0, nz - 1]) {
        const w = volumeIndexToWorld(volume, i, j, k);
        radius = Math.max(
          radius,
          Math.hypot(w[0] - middle[0], w[1] - middle[1], w[2] - middle[2]),
        );
      }
    }
  }
  radius = Math.max(radius, 1e-3) * 1.01;
  const offset = dot([
    middle[0] - point[0],
    middle[1] - point[1],
    middle[2] - point[2],
  ], normal);
  const center: Vec3 = [
    middle[0] - offset * normal[0],
    middle[1] - offset * normal[1],
    middle[2] - offset * normal[2],
  ];
  const helper = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(cross(normal, helper), "normal");
  const v = cross(normal, u);
  return {
    center,
    u: [u[0] * radius, u[1] * radius, u[2] * radius],
    v: [v[0] * radius, v[1] * radius, v[2] * radius],
    normal,
  };
}

/** Corner `i` (0..3) of a frame: centre + (±1)u + (±1)v, as the shader does. */
export function sliceCorner(frame: SliceFrame, i: number): Vec3 {
  const s = i & 1 ? 1 : -1, t = i & 2 ? 1 : -1;
  return [0, 1, 2].map((a) =>
    frame.center[a] + s * frame.u[a] + t * frame.v[a]
  ) as Vec3;
}
