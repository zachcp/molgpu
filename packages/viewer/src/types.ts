// The viewer boundary uses the pinned native LiveElement for scene composition.
// Molecular values stay owned; shader/context APIs live in the advanced entry.
import type { LiveElement } from "@use-gpu/live";
import type { StructureData, TrajectoryData, VolumeData } from "@molgpu/table";
import type { Curve } from "@molgpu/timeline";
import type {
  DielectricModel,
  NormalModeData,
  PotentialUnit,
} from "@molgpu/dynamics";
import type { Selection, SelectionQuery } from "@molgpu/select";

/** Reusable query, exact resolved atom membership, or the consumer's default. */
export type SelectionInput = SelectionQuery | Selection | null;

/** Opaque diagnostic source identity; generations are local to each source. */
export interface SelectionSource {
  readonly kind: "topology" | "positions" | "attribute";
  readonly name?: string;
  readonly owner: string;
  readonly source: string;
  readonly generation: number;
}

/** Resolution at the nearest scope; published inputs may trail live rendering. */
export type SelectionStatus =
  & {
    readonly slot: "select" | "center" | "a" | "b" | "focus";
    readonly label: string;
    readonly sources: readonly SelectionSource[];
    readonly consistency: "latest-published";
  }
  & (
    | { readonly status: "pending" }
    | {
      readonly status: "ready";
      readonly count: number;
      readonly updating: boolean;
    }
    | { readonly status: "error"; readonly error: Error }
  );

/** Optional diagnostics; empty membership is valid and warnings default off. */
export interface SelectionDiagnostics {
  onSelectionStatus?: (status: SelectionStatus) => void;
  warnEmptySelection?: boolean;
}

// --- Scene elements, components and owned values ---------------------------

/**
 * One node of a rendered scene, as produced by JSX or by calling a component.
 * Aliases the pinned use.gpu LiveElement so native scene composition stays typed.
 */
export type ViewerElement = LiveElement;

/** A viewer component: a function of props that renders a scene element. Use
 *  it in JSX (`<Spacefill />`) or through the renderer's `use()`. */
export type ViewerComponent<P = object> = (
  props: P,
) => ViewerElement;

/** A numeric vector, such as an RGBA colour: a plain array or a typed array. */
export type VectorLike =
  | readonly number[]
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

/** RGBA colour stops over a normalised 0–1 range. */
export type ColorStops = ReadonlyArray<
  readonly [number, readonly [number, number, number, number]]
>;

/** Blend-mode names accepted by `<Spacefill>`'s point-layer options. */
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
export type MaterialType = "pbr" | "basic" | "normal";

/**
 * Constant material settings, or a native Live wrapper for shader maps, lazy
 * values and render callbacks. PBR defaults to metalness 0 and roughness 0.6.
 * Albedo/basic color multiply the representation's color (including alpha).
 */
export type MaterialSpec =
  | {
    type?: "pbr";
    metalness?: number;
    roughness?: number;
    albedo?: VectorLike;
    emissive?: VectorLike;
  }
  | { type: "basic"; color?: VectorLike }
  | { type: "normal" }
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
export interface FocusOptions extends SelectionDiagnostics {
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
  readonly focus: SelectionInput;
  readonly target?: never;
  readonly radius?: never;
};
export type CameraCurve = readonly (CameraFrame | FocusCameraFrame)[];

/** Load with a request signal; replacement/unmount aborts it and suppresses stale results. */
export type StructureLoader = (
  src: string,
  cancelled: () => boolean,
  signal?: AbortSignal,
) => StructureData | null | Promise<StructureData | null>;

/**
 * `<Structure>` props: exactly one of `data` (preloaded; never loads a parser)
 * or `src` (loaded; replacing or unmounting it rejects in-flight results).
 */
export type StructureProps =
  | {
    children?: ViewerElement;
    data: StructureData;
    src?: undefined;
    loader?: undefined;
    loading?: undefined;
    error?: undefined;
  }
  | {
    children?: ViewerElement;
    src: string;
    data?: undefined;
    /** Defaults to fetch + BCIF lowering through @molgpu/io. Its identity is a
     * reload dependency alongside `src`, so pass a stable or memoized function. */
    loader?: StructureLoader;
    loading?: ViewerElement | (() => ViewerElement);
    error?: ViewerElement | ((failure: unknown) => ViewerElement);
  };

/** Open with a request signal; replacement/unmount aborts it and suppresses stale results. */
export type TrajectoryLoader = (
  src: string,
  cancelled: () => boolean,
  signal?: AbortSignal,
) => TrajectoryData | null | Promise<TrajectoryData | null>;

/**
 * Source and frame state of one `<Trajectory>`. On `error`, upstream
 * coordinates pass through until the source changes; `phase` says whether
 * opening the source or reading `frame` failed.
 */
export type TrajectoryStatus =
  | { readonly status: "opening" }
  | { readonly status: "ready"; readonly frameCount: number }
  | {
    readonly status: "error";
    readonly phase: "source" | "frame";
    /** The frame that failed to load, or null for a source failure. */
    readonly frame: number | null;
    readonly error: unknown;
  };

/**
 * `<Trajectory>` props: playback (`frame`, `interpolate`, `pbc`) plus exactly
 * one of `data` (opened already, e.g. with `openTrajectory` from @molgpu/io) or
 * `src` (a DCD/XTC/TRR URL streamed through @molgpu/io).
 */
export type TrajectoryProps =
  & {
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
    /**
     * Source and frame state. Failures pass upstream coordinates through and
     * are reported here instead of thrown; without a callback each failure is
     * logged once with `console.error`.
     */
    onStatus?: (status: TrajectoryStatus) => void;
  }
  & (
    | { data: TrajectoryData; src?: undefined; loader?: undefined }
    | {
      src: string;
      data?: undefined;
      /** Defaults to `openTrajectory(src)` (HTTP Range reads). Pass a stable function. */
      loader?: TrajectoryLoader;
    }
  );

/** Apply a column-major 4x4 affine to all atoms or an atom selection. */
export interface TransformProps extends SelectionDiagnostics {
  children?: ViewerElement;
  matrix: ArrayLike<number> | Curve<readonly number[]>;
  /** Unlike Superpose, this selects output rows. Other rows pass through. */
  select?: SelectionInput;
}

/** Rigidly fit upstream coordinates onto a reference. */
export interface SuperposeProps extends SelectionDiagnostics {
  children?: ViewerElement;
  /**
   * Reference positions in topology row order: packed xyz, a `StructureData`
   * with the same atoms, or `"first"` for frame 0 of the nearest
   * `<Trajectory>` (upstream passes through while it loads).
   */
  to: Float32Array | StructureData | "first";
  /** Fit atoms (at least three, not collinear). Unlike Transform, every
   * output atom moves. Omitted means all atoms. */
  select?: SelectionInput;
  /** Align centroids (default). False rotates about the source centroid. */
  translate?: boolean;
  /** Reports the GPU fit result asynchronously; busy readbacks may skip frames. */
  onStatus?: (status: SuperposeStatus) => void;
}

/** Fit outcome for one published coordinate generation. */
export interface SuperposeStatus {
  readonly status: "solved" | "passthrough";
  /** Fitted RMSD in Å, or null when a collinear frame passed through. */
  readonly rmsd: number | null;
  readonly generation: number;
}

/** What `<Unwrap>` found on one displayed frame. */
export interface UnwrapStatus {
  /**
   * `ok`; `ambiguous` when some covalent ring edge does not close; `search-limit`
   * when an exact image search exceeded its candidate bound (that bond keeps
   * its best image so far); `missing-box` or `invalid-box` when positions
   * passed through.
   */
  readonly status:
    | "ok"
    | "ambiguous"
    | "search-limit"
    | "missing-box"
    | "invalid-box";
  readonly ambiguousRingEdges: number;
  /** The provider generation (or, when passing through, the upstream one). */
  readonly generation: number;
}

/** Make covalent components whole on a periodic frame. */
export interface UnwrapProps extends SelectionDiagnostics {
  children?: ViewerElement;
  /**
   * Column-major 3×3 box vectors (a, b, c as columns). Defaults to the
   * nearest `<Trajectory>`'s displayed box; null passes positions through.
   */
  box?: ArrayLike<number> | null;
  /** Move each component holding these atoms so their centroid lies in the
   * primary cell. */
  center?: SelectionInput;
  /** Called asynchronously after unwrapped frames, and when a box is missing
   * or invalid. Frames may be skipped while earlier reports are in flight. */
  onStatus?: (status: UnwrapStatus) => void;
}

/** Add a precomputed normal mode to upstream coordinates. */
export interface NormalModeProps {
  children?: ViewerElement;
  mode: NormalModeData;
  amplitude: number;
  /** Cycles per second; a nonzero value requires a TimelineProvider. */
  frequency?: number;
  /** Radians at time zero. */
  phase?: number;
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

/**
 * `<EField>` props. Physics defaults follow `electrostatics()` in
 * @molgpu/dynamics: ε = 4r, 1 Å distance clamp, output in kT/e at 298.15 K.
 */
export interface EFieldProps extends SelectionDiagnostics {
  children?: ViewerElement;
  /** Summed molecular query or exact atom selection; default first-model/primary-altloc atoms. */
  select?: SelectionInput;
  /** Charge column (e per atom); defaults to `partialCharge`. */
  charge?: string;
  /** `vacuum`, `distance` (ε = D·r, the default) or `debye`. */
  model?: DielectricModel;
  /** ε for vacuum (1) and debye (78.54); D for distance (4). */
  epsilon?: number;
  /** mol/L, debye only; defaults to 0.15. */
  ionicStrength?: number;
  /** Kelvin; defaults to 298.15. */
  temperature?: number;
  /** Å below which distances clamp; defaults to 1. */
  minDistance?: number;
  /** Output unit; defaults to `kT/e`. */
  unit?: PotentialUnit;
  /** Grid spacing in Å; defaults to 1. */
  spacing?: number;
  /** Å added around the summed atoms' bounds; defaults to 8. */
  padding?: number;
  /** Explicit axis-aligned grid extent in Å (no padding), instead of padded bounds. */
  box?: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
  };
  /** Sample ceiling; defaults to 128³. A larger grid throws a RangeError. */
  maxSamples?: number;
  /**
   * Ceiling on samples × charged atoms per computation; defaults to 2³⁴
   * (about 1.7e10, some tens of ms to a few hundred ms on an integrated GPU).
   * A larger sum throws a RangeError naming a spacing that fits.
   */
  maxPairs?: number;
  /**
   * Display interval ±range (a slice's default). Defaults to 15 kT/e, or 2
   * kT/e for `debye` (the same values in kcal/mol/e when that is the unit).
   */
  range?: number;
  /** Cap recomputation per second; default: every coordinate generation. */
  maxHz?: number;
}

/** Load with a request signal; replacement/unmount aborts it and suppresses stale results. */
export type VolumeLoader = (
  src: string,
  cancelled: () => boolean,
  signal?: AbortSignal,
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

// --- Picking ----------------------------------------------------------------

/** An atom resolved from a picking hit. `resource` is the StructureResource the
 *  atom belongs to; `atom` is its row; `instance` is the drawn instance index. */
export interface PickHit {
  readonly id: number;
  readonly resource: StructureResource;
  readonly atom: number;
  readonly instance: number;
}
