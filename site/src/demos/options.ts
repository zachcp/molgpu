import type {
  ComposeLayer,
  DemoPreset,
  MotionMode,
  StructureId,
  VolumeMode,
} from "./registry.ts";

export type SurfaceMode = "opaque" | "glass" | "pumice";
export type SurfaceColorMode = "neutral" | "element";
/** Solvent-accessible (atoms grown by the probe) or solvent-excluded. */
export type SurfaceKind = "accessible" | "excluded";
export type MaterialMode = "matte" | "metal" | "basic" | "normal";
/** use.gpu's built-in spherical-harmonic environment presets. */
export type EnvironmentPreset = "none" | "park" | "pisa" | "road" | "field";
export type Tonemap = "linear" | "aces" | "hable" | "reinhard";
export type SelectionMode =
  | "site"
  | "cysteine"
  | "sulfur"
  | "all";
export type FieldMode = "element" | "charge";
export type TrajectoryMode = "tube" | "ball-and-stick";
export interface SceneOptions {
  readonly structure: StructureId;
  readonly layers: readonly ComposeLayer[];
  readonly surfaceMode: SurfaceMode;
  readonly surfaceColorMode: SurfaceColorMode;
  readonly surfaceKind: SurfaceKind;
  readonly materialMode: MaterialMode;
  readonly selectionMode: SelectionMode;
  readonly fieldMode: FieldMode;
  readonly motionMode: MotionMode;
  readonly trajectoryMode: TrajectoryMode;
  /** Motion trajectory: draw the live Ramachandran inset. */
  readonly ramachandran: boolean;
  readonly volumeMode: VolumeMode;
  readonly efieldSpacing: number;
  readonly seedSpacing: number;
  readonly lineDistance: number;
  /** Fractional k (third-axis) grid index of the volume slice. */
  readonly sliceIndex: number;
  /** Isosurface level in sigma above the map mean. */
  readonly isoSigma: number;
  /** Kept slab as view-depth fractions [front, back]: [0, 1] keeps all. */
  readonly clip: readonly [number, number];
  /** PBR roughness for matte, metal, glass and pumice (0–1). */
  readonly roughness: number;
  /** Glass uses use.gpu's FresnelMaterialEffect (PBR materials only). */
  readonly fresnel: boolean;
  /** Pumice normal-perturbation amplitude (0 off) and noise frequency per Å. */
  readonly bump: number;
  readonly bumpScale: number;
  /** Select: called with the atom row under a click when click-to-focus is on. */
  readonly onFocusPick?: (row: number) => void;
  /** Compose measure layer: picked atom rows and the page's pick handler. */
  readonly measure?: {
    readonly picks: readonly number[];
    readonly onPick: (row: number) => void;
  };
}

/** Editable example values. Rendering derives data-dependent values separately. */
export type DemoSettings =
  & Omit<SceneOptions, "structure" | "sliceIndex" | "measure" | "onFocusPick">
  & {
    readonly figure: boolean;
    readonly shadows: boolean;
    readonly focusMode: boolean;
    readonly environment: EnvironmentPreset;
    readonly tonemap: Tonemap;
    readonly sliceFraction: number;
  };

export const defaultRoughness = (mode: MaterialMode) =>
  mode === "metal" ? 0.2 : 0.85;

export const defaultSettings = (preset?: DemoPreset): DemoSettings => ({
  layers: ["tube"],
  surfaceMode: "opaque",
  surfaceColorMode: "neutral",
  surfaceKind: "accessible",
  materialMode: "matte",
  roughness: defaultRoughness(preset?.materialMode ?? "matte"),
  clip: [0, 1],
  fresnel: true,
  bump: 0.6,
  bumpScale: 1.2,
  figure: false,
  shadows: true,
  focusMode: false,
  environment: "none",
  tonemap: "linear",
  selectionMode: "sulfur",
  fieldMode: "element",
  motionMode: "trajectory",
  trajectoryMode: "ball-and-stick",
  ramachandran: true,
  volumeMode: "density",
  efieldSpacing: 1,
  seedSpacing: 7,
  lineDistance: 30,
  sliceFraction: 0.5,
  isoSigma: 2,
  ...preset,
});
