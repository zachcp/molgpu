// The "." entry's types. It carries no use.gpu types: everything below is
// owned by @molgpu/viewer. Exports that are inherently use.gpu-shaped (shader sources,
// Live contexts, custom-shader materials) live in `@molgpu/viewer/advanced`.
import type { StructureData, TrajectoryData, VolumeData } from "@molgpu/table";
import type { Curve } from "@molgpu/timeline";
import type { SelectionQuery } from "@molgpu/select";

// --- Owned element, component and value types -------------------------------

/**
 * One node of a rendered scene, as produced by JSX or by calling a component.
 * Opaque by design: its concrete shape belongs to the renderer (a use.gpu Live
 * element; `@molgpu/viewer/advanced` is where upstream types are exposed).
 */
export type ViewerElement = object | null | undefined | false;

/** A viewer component: a function of props that renders a scene element. Use
 *  it in JSX (`<Spacefill />`) or through the renderer's `use()`. */
export type ViewerComponent<P = {}> = (props: P) => ViewerElement;

export type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

/** A numeric vector: a plain array or a typed array. */
export type VectorLike = readonly number[] | TypedArray;

/** A colour: packed number, [r, g, b(, a)] vector, `{ rgb }`/`{ rgba }`, or a CSS string. */
export type ColorLike = number | VectorLike | { rgb: VectorLike } | {
  rgba: VectorLike;
} | string;

/** Blend-mode names accepted by layer and outline options. */
export type BlendMode =
  | "none"
  | "alpha"
  | "premultiply"
  | "add"
  | "subtract"
  | "multiply";

/** Ångström-space axis-aligned extent, or null for an empty structure. */
export interface StructureBounds {
  readonly min: number[];
  readonly max: number[];
  readonly center: number[];
}

/** Material `type` names accepted by a representation's `material` prop. */
export type MaterialType = "pbr" | "basic" | "normal" | "flat" | "lit";

/**
 * A representation's `material` prop. Either a spec object — `{ type?, ...props }`
 * where `type` defaults to 'pbr' and the rest forward to the matching material
 * component — or a `(children) => element` wrapper function for full control.
 */
export type MaterialSpec =
  | ({ type?: MaterialType } & Record<string, unknown>)
  | ((children: ViewerElement) => ViewerElement);

/** CPU-side owner of the values shared by one <Structure> subtree. */
export interface StructureResource {
  readonly data: StructureData;
  readonly identity: StructureData["identity"];
  readonly topologyRevision: number;
  readonly positionsRevision: number;
  readonly attributesRevision: number;
  /** Lazily computed and cached; throws once the resource is disposed. */
  readonly bounds: StructureBounds | null;
  dispose(): void;
}

export interface CameraPose {
  readonly target: readonly number[];
  readonly radius: number;
  readonly bearing: number;
  readonly pitch: number;
}
export interface FocusOptions {
  /** Empty query falls back to the full structure by default. */
  readonly empty?: "structure" | "null" | "error";
  readonly fov?: number;
  readonly aspect?: number;
  readonly padding?: number;
  /** Scale of displayed atom radii, e.g. Spacefill.scale. */
  readonly atomRadiusScale?: number;
}
export interface FocusResult {
  readonly target: readonly number[];
  readonly radius: number;
  readonly bounds: StructureBounds | null;
}
export interface CameraFrame extends CameraPose {
  readonly time: number;
  readonly ease?: "linear" | "cosine" | "hold" | "bezier";
  readonly bezier?: readonly [number, number, number, number];
}
export type FocusCameraFrame = Omit<CameraFrame, "target" | "radius"> & {
  readonly focus: SelectionQuery;
  readonly target?: never;
  readonly radius?: never;
};
export type CameraCurve = readonly (CameraFrame | FocusCameraFrame)[];

/** Resolves to StructureData, or to null when `cancelled()` becomes true. */
export type StructureLoader = (
  src: string,
  cancelled: () => boolean,
) => StructureData | null | Promise<StructureData | null>;

/** Preloaded values. This path never loads a parser. */
export interface PreloadedStructureProps {
  children?: ViewerElement;
  data: StructureData;
  src?: undefined;
  loader?: undefined;
  loading?: undefined;
  error?: undefined;
}

/** A source to load. Replacing or unmounting it rejects in-flight results. */
export interface LoadedStructureProps {
  children?: ViewerElement;
  src: string;
  data?: undefined;
  /** Defaults to fetch + BCIF lowering through @molgpu/io. Its identity is a
   * reload dependency alongside `src`, so pass a stable or memoized function. */
  loader?: StructureLoader;
  loading?: ViewerElement | (() => ViewerElement);
  error?: ViewerElement | ((failure: unknown) => ViewerElement);
}

/** `data` and `src` are mutually exclusive, and exactly one is required. */
export type StructureProps = PreloadedStructureProps | LoadedStructureProps;

/** Open one trajectory source; resolve null when `cancelled()` became true. */
export type TrajectoryLoader = (
  src: string,
  cancelled: () => boolean,
) => TrajectoryData | null | Promise<TrajectoryData | null>;

/** Props shared by both `<Trajectory>` forms. */
export interface TrajectoryPlayback {
  children?: ViewerElement;
  /**
   * Fractional frame index, or a curve from timeline seconds to frames (see
   * `frameCurve` in @molgpu/timeline). Clamped to `[0, frameCount - 1]`.
   */
  frame: number | Curve<number>;
  /** `"linear"` (default) blends neighbouring frames; `"nearest"` rounds. */
  interpolate?: "linear" | "nearest";
  /**
   * `"minimum-image"` interpolates each atom along the shortest periodic
   * displacement when both frames carry a box, so atoms that wrap do not
   * cross the box on screen. Default `"none"`.
   */
  pbc?: "none" | "minimum-image";
}
/** A trajectory already opened, e.g. with `openTrajectory` from @molgpu/io. */
export interface PreloadedTrajectoryProps extends TrajectoryPlayback {
  data: TrajectoryData;
  src?: undefined;
  loader?: undefined;
}
/** A DCD/XTC/TRR URL, opened for streaming through @molgpu/io. */
export interface LoadedTrajectoryProps extends TrajectoryPlayback {
  src: string;
  data?: undefined;
  /** Defaults to `openTrajectory(src)` (HTTP Range reads). Pass a stable function. */
  loader?: TrajectoryLoader;
}
/** `data` and `src` are mutually exclusive, and exactly one is required. */
export type TrajectoryProps = PreloadedTrajectoryProps | LoadedTrajectoryProps;

/** Apply a column-major 4x4 affine to all atoms or an atom selection. */
export interface TransformProps {
  children?: ViewerElement;
  matrix: ArrayLike<number> | Curve<readonly number[]>;
  /** Unlike Superpose, this selects output rows. Other rows pass through. */
  select?: SelectionQuery;
}

/** What the nearest `<Trajectory>` shows, from `useTrajectoryFrame()`. */
export interface TrajectoryFrameState {
  readonly trajectory: TrajectoryData;
  /** The clamped frame asked for (after sampling a curve). */
  readonly requested: number;
  /**
   * Frames on screen, `a + t (b - a)`. It trails `requested` while frames
   * load, and is null before the first frame lands (upstream coordinates show).
   */
  readonly displayed: {
    readonly a: number;
    readonly b: number;
    readonly t: number;
  } | null;
  /** `a + t (b - a)` of `displayed`, or null. */
  readonly frame: number | null;
  /** Interpolated column-major box of the displayed frames, if both have one. */
  readonly box: Float32Array | null;
}

/** Load one volume source; resolve null when `cancelled()` became true. */
export type VolumeLoader = (
  src: string,
  cancelled: () => boolean,
) => VolumeData | null | Promise<VolumeData | null>;

/**
 * `<Volume>` props: exactly one of `data` (a preloaded `VolumeData`) or `src`
 * (loaded with `loader`, by default fetch + CCP4/MRC through @molgpu/io).
 */
export type VolumeProps =
  | {
    children?: ViewerElement;
    data: VolumeData;
    src?: undefined;
    loader?: undefined;
    loading?: undefined;
    error?: undefined;
  }
  | {
    children?: ViewerElement;
    src: string;
    data?: undefined;
    /** Its identity is a reload dependency alongside `src`. */
    loader?: VolumeLoader;
    loading?: ViewerElement | (() => ViewerElement);
    error?: ViewerElement | ((failure: unknown) => ViewerElement);
  };

/** How a representation's layer draws: opaque (writes depth, hides what is
 *  behind) or transparent (blended after opaques; exact under <Pass oit>). */
export type DrawMode = "opaque" | "transparent";

/** Transparency props shared by every representation. */
export interface Translucency {
  /** 0–1, multiplied into the colour's alpha. A uniform: changing it (a fade,
   *  a timeline curve) never rebuilds or re-uploads geometry. Defaults to 1. */
  opacity?: number;
  /** Draw mode override. By default it is 'transparent' whenever the effective
   *  alpha (colour alpha × opacity) is below 1, else the layer's opaque mode.
   *  Pair translucent representations with <Pass oit>. */
  mode?: DrawMode;
}

/** Point-layer drawing flags that <Spacefill> forwards to its layer. */
export interface PointLayerOptions {
  shape?: "circle" | "diamond" | "square" | "up" | "down" | "left" | "right";
  hard?: boolean;
  hollow?: boolean;
  outline?: number;
  shaded?: boolean;
  depth?: number;
  zBias?: number;
  blend?: BlendMode | null;
  shadow?: boolean;
  depthTest?: boolean;
  depthWrite?: boolean;
  alphaToCoverage?: boolean;
  alphaToDiscard?: boolean;
}

// --- Materials --------------------------------------------------------------
// Thin wrappers over @use-gpu/workbench materials with molecular defaults. A
// material provides the shading model that `shaded` layers beneath it read; use
// as a wrapping element, or via a representation's `material` prop.

/** Props shared by the material wrappers. Texture maps and `render` callbacks
 *  forward at runtime but are typed only upstream (@use-gpu/workbench). */
export interface MaterialProps {
  children?: ViewerElement;
}
export interface PBRMaterialProps extends MaterialProps {
  albedo?: ColorLike;
  metalness?: number;
  roughness?: number;
  emissive?: VectorLike;
}
export interface BasicMaterialProps extends MaterialProps {
  color?: ColorLike;
}
export type NormalMaterialProps = MaterialProps;
export interface FresnelMaterialEffectProps extends MaterialProps {
  opacity?: number;
}

/** Shadow-map settings for a shadow-casting light (needs `<Pass shadows>`). */
export interface ShadowMapOptions {
  size?: readonly number[];
  depth?: readonly number[];
  bias?: readonly number[];
  span?: readonly number[];
  up?: readonly number[];
  blur?: number;
  resolution?: number;
  fov?: number;
}
export interface AmbientLightProps {
  color?: ColorLike;
  intensity?: number;
}
export interface DirectionalLightProps {
  position?: VectorLike;
  direction?: VectorLike;
  color?: ColorLike;
  intensity?: number;
  shadowMap?: ShadowMapOptions;
  debug?: boolean;
}
export interface PointLightProps {
  position?: VectorLike;
  color?: ColorLike;
  intensity?: number;
  cutoff?: number;
  shadowMap?: ShadowMapOptions;
  infinite?: boolean;
  debug?: boolean;
}
export interface SpotLightProps extends PointLightProps {
  direction?: VectorLike;
  fov?: number;
  feather?: number;
}
export interface DomeLightProps {
  direction?: VectorLike;
  horizon?: ColorLike;
  zenith?: ColorLike;
  intensity?: number;
  bleed?: number;
}
/** A custom environment `map` (a shader source) forwards at runtime but is
 *  typed only upstream; use a named `preset` here. */
export interface EnvironmentProps {
  preset?: string;
  gain?: number;
  children?: ViewerElement;
}

export interface SSAOOptions {
  opacity: number;
  indirect: number;
  radius: number;
  depthRamp: number;
  normalRamp: number;
  temporalBlend: number;
}
export interface OutlineOptions {
  inner: number;
  outer: number;
  color: VectorLike;
  blend: BlendMode;
  depthRamp: number;
  normalRamp: number;
}
export interface OverscanOptions {
  range: number;
  all: boolean;
}

/** <Pass> props: render-pass flags plus the postprocessing options. */
export interface PassProps {
  children?: ViewerElement;
  mode?: "forward" | "deferred" | "fullscreen";
  /** Defaults to true (unlike upstream). */
  lights?: boolean;
  shadows?: boolean;
  picking?: boolean;
  facets?: boolean;
  color?: boolean;
  overlay?: boolean | { color?: boolean; picking?: boolean };
  merge?: boolean;
  /** Order-independent transparency, for transparent surfaces. */
  oit?: boolean;
  ssao?: boolean | number | Partial<SSAOOptions>;
  outline?: boolean | number | Partial<OutlineOptions>;
  overscan?: number | Partial<OverscanOptions>;
  debug?: string;
  debugIndex?: number;
}

// --- Picking ----------------------------------------------------------------

/** An atom resolved from a picking hit. `resource` is the StructureResource the
 *  atom belongs to; `atom` is its row; `instance` is the drawn instance index. */
export interface PickHit {
  readonly id: number;
  readonly resource: StructureResource;
  readonly atom: number;
  readonly instance: number;
}
