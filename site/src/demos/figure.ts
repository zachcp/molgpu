import { use, useMemo } from "@use-gpu/live";
import { FaceLayer, PBRMaterial, useRawSource } from "@use-gpu/workbench";
import { coordinateBounds, type StructureData } from "@molgpu/table";

type Vec3 = readonly [number, number, number];

/** Molecule bounds the figure is staged around: centre and bounding radius (Å). */
export interface FigureStage {
  readonly center: Vec3;
  readonly radius: number;
  /** Draw the key light's shadow map; off keeps the plane and SSAO. */
  readonly shadows: boolean;
}

/** Stage a figure around the structure's coordinate bounds. */
export const figureStage = (
  data: StructureData,
  shadows: boolean,
): FigureStage => {
  const { min, max, center } = coordinateBounds(data)!;
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) /
    2;
  return { center: [center[0], center[1], center[2]], radius, shadows };
};

// The demos' key light (world space). Figure mode steepens it so the shadow
// falls under the molecule, onto the visible part of the ground.
export const KEY_DIRECTION = [-1, -2, -1.5, 0] as const;
const FIGURE_KEY = [-0.4, -2, -0.6] as const;
const FIGURE_LENGTH = Math.hypot(...FIGURE_KEY);
const FIGURE_DIRECTION: Vec3 = [
  FIGURE_KEY[0] / FIGURE_LENGTH,
  FIGURE_KEY[1] / FIGURE_LENGTH,
  FIGURE_KEY[2] / FIGURE_LENGTH,
];

/**
 * The figure key light. With shadows, an orthographic shadow map covers the
 * molecule and the ground under it: the light sits `3r` back along its
 * direction, and the map spans the plane's extent.
 */
export const figureLight = ({ center, radius, shadows }: FigureStage) => {
  const direction = [...FIGURE_DIRECTION, 0];
  if (!shadows) return { direction };
  const back = radius * 3;
  return {
    direction,
    position: [
      center[0] - FIGURE_DIRECTION[0] * back,
      center[1] - FIGURE_DIRECTION[1] * back,
      center[2] - FIGURE_DIRECTION[2] * back,
      1,
    ],
    shadowMap: {
      size: [2048, 2048],
      span: [radius * 5, radius * 5],
      depth: [0, back * 2.5],
      bias: [0, 1 / 1024, 1 / 64],
      blur: 2,
    },
  };
};

const UP = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
const QUAD = new Uint32Array([0, 1, 2, 0, 2, 3]);

/** A matte ground plane just below the molecule, `4r` across each way. */
export const GroundPlane = ({ center, radius }: FigureStage) => {
  const y = center[1] - radius * 1.02;
  const half = radius * 4;
  const corners = useMemo(
    () =>
      new Float32Array([
        center[0] - half,
        y,
        center[2] - half,
        center[0] + half,
        y,
        center[2] - half,
        center[0] + half,
        y,
        center[2] + half,
        center[0] - half,
        y,
        center[2] + half,
      ]),
    [center[0], y, center[2], half],
  );
  const positions = useRawSource(corners, "vec3<f32>");
  const normals = useRawSource(UP, "vec3<f32>");
  const indices = useRawSource(QUAD, "u32");
  return use(PBRMaterial, {
    roughness: 0.95,
    metalness: 0,
    children: use(FaceLayer, {
      positions,
      normals,
      indices,
      color: [0.36, 0.38, 0.42, 1],
      shaded: true,
      side: "both",
    }),
  });
};
