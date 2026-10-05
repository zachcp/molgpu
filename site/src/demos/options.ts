import type { ComposeLayer, MotionMode, VolumeMode } from "./registry.ts";

export type SurfaceMode = "opaque" | "glass" | "pumice";
export type SurfaceColorMode = "neutral" | "element";
export type MaterialMode = "matte" | "metal" | "basic" | "normal";
export type SelectionMode = "near-cysteine" | "cysteine" | "sulfur" | "all";
export type FieldMode = "element" | "charge";
export type TrajectoryMode = "tube" | "ball-and-stick";
export interface SceneOptions {
  readonly layers: readonly ComposeLayer[];
  readonly surfaceMode: SurfaceMode;
  readonly surfaceColorMode: SurfaceColorMode;
  readonly materialMode: MaterialMode;
  readonly selectionMode: SelectionMode;
  readonly fieldMode: FieldMode;
  readonly motionMode: MotionMode;
  readonly trajectoryMode: TrajectoryMode;
  readonly volumeMode: VolumeMode;
  readonly efieldSpacing: number;
  readonly seedSpacing: number;
  readonly lineDistance: number;
  /** Fractional k (third-axis) grid index of the volume slice. */
  readonly sliceIndex: number;
  /** Isosurface level in sigma above the map mean. */
  readonly isoSigma: number;
  /** Surface clip depth from the viewer's side: 0 off, 0.5 halfway, 1 all. */
  readonly clipDepth: number;
  /** Compose measure layer: picked atom rows and the page's pick handler. */
  readonly measure?: {
    readonly picks: readonly number[];
    readonly onPick: (row: number) => void;
  };
}
