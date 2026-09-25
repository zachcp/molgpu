// The "." entry carries no use.gpu types: everything below is owned by
// @molgpu/viewer. Exports that are inherently use.gpu-shaped (shader sources,
// Live contexts, custom-shader materials) live in `@molgpu/viewer/advanced`.
import type { StructureData } from '@molgpu/table';
import type { Field } from '@molgpu/fields';
import type { Selection, SelectionQuery } from '@molgpu/select';
import type { Curve, CurveValue } from '@molgpu/timeline';

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
  | Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array
  | Int32Array | Uint32Array | Float32Array | Float64Array;

/** A numeric vector: a plain array or a typed array. */
export type VectorLike = readonly number[] | TypedArray;

/** A colour: packed number, [r, g, b(, a)] vector, `{ rgb }`/`{ rgba }`, or a CSS string. */
export type ColorLike = number | VectorLike | { rgb: VectorLike } | { rgba: VectorLike } | string;

/** Blend-mode names accepted by layer and outline options. */
export type BlendMode = 'none' | 'alpha' | 'premultiply' | 'add' | 'subtract' | 'multiply';

/** Ångström-space axis-aligned extent, or null for an empty structure. */
export interface StructureBounds {
  readonly min: number[]; readonly max: number[]; readonly center: number[];
}

/** Material `type` names accepted by a representation's `material` prop. */
export type MaterialType = 'pbr' | 'basic' | 'normal' | 'flat' | 'lit';

/**
 * A representation's `material` prop. Either a spec object — `{ type?, ...props }`
 * where `type` defaults to 'pbr' and the rest forward to the matching material
 * component — or a `(children) => element` wrapper function for full control.
 */
export type MaterialSpec =
  | ({ type?: MaterialType } & Record<string, unknown>)
  | ((children: ViewerElement) => ViewerElement);

/** A resolved atom set, valid only for the resource and revisions that made it. */
export interface AtomSelection {
  readonly structure: StructureData['identity'];
  readonly topologyRevision: number;
  readonly positionsRevision: number;
  readonly domain: 'atom';
  readonly indices: Uint32Array;
  readonly bounds: StructureBounds | null;
}

/** CPU-side owner of the values shared by one <Structure> subtree. */
export interface StructureResource {
  readonly data: StructureData;
  readonly identity: StructureData['identity'];
  readonly topologyRevision: number;
  readonly positionsRevision: number;
  /** Lazily computed and cached; throws once the resource is disposed. */
  readonly bounds: StructureBounds | null;
  /** Indices must be sorted, unique and in range. Results are LRU-cached. */
  selection(indices: Uint32Array): AtomSelection;
  /** False for foreign, stale or post-dispose selection handles. */
  accepts(value: unknown): boolean;
  dispose(): void;
}

export function createStructureResource(
  data: StructureData,
  options?: { readonly maxSelections?: number },
): StructureResource;

/** Provides one StructureResource (and its shared GPU columns) to descendant
 *  representations. <Structure> wraps it; prefer <Structure>. */
export const StructureProvider: ViewerComponent<{
  data: StructureData;
  maxSelections?: number;
  children?: ViewerElement;
}>;

/** A compositional boundary only: it never owns a canvas or GPU device. */
export const Molecule: ViewerComponent<{ children?: ViewerElement }>;

/** Controlled global time in seconds. The caller sets time when scrubbing. */
export const TimelineProvider: ViewerComponent<{ time: number; children?: ViewerElement }>;
export function useTimelineTime(): number;
export function useTimelineSample<T extends CurveValue>(curve: Curve<T>): T;

export interface CameraPose {
  readonly target: readonly number[];
  readonly radius: number;
  readonly bearing: number;
  readonly pitch: number;
}
export interface FocusOptions {
  /** Empty query falls back to the full structure by default. */
  readonly empty?: 'structure' | 'null' | 'error';
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
/** Resolves a reusable query against an explicit current structure resource. */
export function focusSelection(resource: StructureResource, query: SelectionQuery, options?: FocusOptions): FocusResult | null;
export interface CameraFrame extends CameraPose {
  readonly time: number;
  readonly ease?: 'linear' | 'cosine' | 'hold' | 'bezier';
  readonly bezier?: readonly [number, number, number, number];
}
export type FocusCameraFrame = Omit<CameraFrame, 'target' | 'radius'> & {
  readonly focus: SelectionQuery;
  readonly target?: never;
  readonly radius?: never;
};
export type CameraCurve = readonly (CameraFrame | FocusCameraFrame)[];
export function createCameraCurve(frames: CameraCurve): CameraCurve;
export function sampleCamera(curve: CameraCurve, time: number, resource: StructureResource, options?: FocusOptions): CameraPose;
export function useCameraCurve(curve: CameraCurve, resource: StructureResource, options?: FocusOptions): CameraPose;

/** Resolves to StructureData, or to null when `cancelled()` becomes true. */
export type StructureLoader = (
  src: string,
  cancelled: () => boolean,
) => StructureData | null | Promise<StructureData | null>;

interface StructureCommonProps {
  /** Per-structure selection cache bound; defaults to 64. */
  maxSelections?: number;
  children?: ViewerElement;
}

/** Preloaded values. This path never loads a parser. */
export interface PreloadedStructureProps extends StructureCommonProps {
  data: StructureData;
  src?: undefined; loader?: undefined; loading?: undefined; error?: undefined;
}

/** A source to load. Replacing or unmounting it rejects in-flight results. */
export interface LoadedStructureProps extends StructureCommonProps {
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

export const Structure: ViewerComponent<StructureProps>;

/** How a representation's layer draws: opaque (writes depth, hides what is
 *  behind) or transparent (blended after opaques; exact under <Pass oit>). */
export type DrawMode = 'opaque' | 'transparent';

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
  shape?: 'circle' | 'diamond' | 'square' | 'up' | 'down' | 'left' | 'right';
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

/** Render atom sites as world-space shaded spheres, optionally restricted to a
 * selection and coloured by a field. */
export const Spacefill: ViewerComponent<{
  /** Multiplies each atom's Ångström radius; defaults to 1. */
  scale?: number;
  /** A @molgpu/select atom Selection for this structure; restricts the draw. */
  select?: Selection | null;
  /** A flat colour, or a @molgpu/fields Field composed shader-side per atom. */
  color?: VectorLike | Field;
  /** Wraps the shaded point layer; without one, the ambient scene material. */
  material?: MaterialSpec;
  /** Draw the atoms into the picking buffer so usePicking() can resolve them
   *  (needs a <PickingProvider> and a <Pass picking>). Defaults to false. */
  pickable?: boolean;
} & Translucency & PointLayerOptions>;

/** Draw bonds as world-space sticks, optionally restricted to a selection.
 * By default each bond has two element-coloured halves. An explicit color
 * preserves a single stroke with the supplied flat color or field. */
export const Bonds: ViewerComponent<{
  /** Stick width; defaults to 0.3. */
  width?: number;
  /** A @molgpu/select atom Selection for this structure. */
  select?: Selection | null;
  /** Keep bonds whose endpoints are 'both' (default) or 'either' selected. */
  endpoints?: 'both' | 'either';
  /** A flat colour, or a @molgpu/fields Field coloured per endpoint atom. */
  color?: VectorLike | Field;
  sides?: number;
  shaded?: boolean;
  /** Wraps the shaded stick layer; without one, the ambient scene material. */
  material?: MaterialSpec;
} & Translucency>;

/** Balls (Spacefill) + sticks (Bonds) over one selection and one colour. */
export const BallAndStick: ViewerComponent<{
  select?: Selection | null;
  /** A flat colour or a @molgpu/fields Field, applied to balls and sticks. */
  color?: VectorLike | Field;
  /** Ball radius scale; defaults to 0.3. */
  ball?: number;
  /** Stick width; defaults to 0.28. */
  stick?: number;
  endpoints?: 'both' | 'either';
  /** Forwarded to both balls and sticks, so they share one shading model. */
  material?: MaterialSpec;
} & Translucency>;

/** Draw the polymer backbone as a GPU-extruded tube (LineLayer's shaded
 * `@use-gpu/wgsl/geometry/tube` extrusion; no CPU mesh). Missing residues,
 * chain/model breaks, and a selection gap all end a run rather than
 * bridging across it. Only `select`/`smooth` rebuild trace/spline geometry;
 * `radius`/`color` update bindings. */
export const Tube: ViewerComponent<{
  /** A @molgpu/select atom Selection; without one, active model/primary-altloc atoms are used. */
  select?: Selection | null;
  /** Ångström tube radius; defaults to 0.3. */
  radius?: number;
  /** Samples per guide segment; defaults to 6. */
  smooth?: number;
  color?: VectorLike;
  sides?: number;
  join?: 'tangent' | 'bevel' | 'miter' | 'round';
  /** Wraps the shaded tube layer; without one, the ambient scene material. */
  material?: MaterialSpec;
} & Translucency>;

/** Draw the polymer backbone as a flat, oriented ribbon (0sj.1's
 * curve-segment kernel oriented by 0sj.2's per-residue direction/secondary-
 * structure data), fed to FaceLayer as a mesh. Helix/sheet get a wide
 * cross-section, coil a narrow one; there is no beta-strand arrowhead taper
 * yet. Only `select`/`smooth` rebuild the mesh; `color`/`opacity` update
 * bindings. */
export const Ribbon: ViewerComponent<{
  /** A @molgpu/select atom Selection; without one, active model/primary-altloc atoms are used. */
  select?: Selection | null;
  /** Samples per guide segment; defaults to 8. */
  smooth?: number;
  color?: VectorLike;
  /** Wraps the shaded ribbon layer; without one, the ambient scene material. */
  material?: MaterialSpec;
} & Translucency>;

/** A molecular (solvent-excluded) surface via Mol*'s scalar-field kernel,
 * @molgpu/geo's marching-cubes port, and FaceLayer. Only `select`,
 * `probeRadius`, and `resolution` rebuild the field/mesh (scheduled through
 * 0sj.7's cancellation/budget contract); `color`/`opacity` update bindings.
 * An oversize grid throws before the field is computed. */
export const Surface: ViewerComponent<{
  /** A @molgpu/select atom Selection; without one, active model/primary-altloc atoms are used. */
  select?: Selection | null;
  /** Ångström probe radius; defaults to 1.4 (water). */
  probeRadius?: number;
  /** Grid spacing in Ångströms; defaults to 0.5. Smaller is finer and slower. */
  resolution?: number;
  /** Grid byte budget override; see assertGridBudget's default. */
  maxBytes?: number;
  color?: VectorLike;
  /** Wraps the shaded face layer; without one, the ambient scene material. */
  material?: MaterialSpec;
  loading?: ViewerElement | (() => ViewerElement);
  error?: ViewerElement | ((failure: unknown) => ViewerElement);
} & Translucency>;

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

/** Physically based material; defaults matte and non-metallic (metalness 0, roughness 0.6). */
export const PBRMaterial: ViewerComponent<PBRMaterialProps>;
/** Unlit flat colour (ignores lights). */
export const BasicMaterial: ViewerComponent<BasicMaterialProps>;
/** Surface-normal debug material. */
export const NormalMaterial: ViewerComponent<NormalMaterialProps>;
/** Fresnel rim effect, composed over another material's children. */
export const FresnelMaterialEffect: ViewerComponent<FresnelMaterialEffectProps>;

/** The material `type` names accepted by a representation's `material` prop. */
export const materialTypes: ReadonlyArray<MaterialType>;

/** Wrap an element in a material spec so `shaded` layers beneath it read its model. */
export function withMaterial(material: MaterialSpec | null | undefined, element: ViewerElement): ViewerElement;

// --- Lights -----------------------------------------------------------------
// Thin wrappers over @use-gpu/workbench lights with molecular defaults. Each
// must sit inside the shaded `<Pass lights>`.

/** A fixed world-space key-light direction shared across molgpu scenes. */
export const KEY_LIGHT_DIRECTION: readonly [number, number, number];

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

/** Soft fill; defaults to intensity 0.3. */
export const AmbientLight: ViewerComponent<AmbientLightProps>;
/** Key light; defaults to KEY_LIGHT_DIRECTION at full intensity. */
export const DirectionalLight: ViewerComponent<DirectionalLightProps>;
/** A positioned, falloff light. */
export const PointLight: ViewerComponent<PointLightProps>;
/** A positioned, cone-limited light. */
export const SpotLight: ViewerComponent<SpotLightProps>;
/** A gradient sky/ground dome for soft, even illumination. */
export const DomeLight: ViewerComponent<DomeLightProps>;
/** Image-based lighting: the environment map PBR materials reflect. */
export const Environment: ViewerComponent<EnvironmentProps>;

// --- Pass / postprocessing --------------------------------------------------

/**
 * The scene-level render pass that draws representations and hosts lights. Thin
 * wrapper over @use-gpu/workbench's <Pass>: `lights` defaults on, and the
 * postprocessing flags forward untouched — `ssao`, `outline`, and `oit` (the
 * one that matters for transparent molecular surfaces). Depth of field is not
 * offered; it does not exist upstream in this version (tracked as hj0.5).
 */
export const Pass: ViewerComponent<PassProps>;

export interface SSAOOptions {
  opacity: number; indirect: number; radius: number;
  depthRamp: number; normalRamp: number; temporalBlend: number;
}
export interface OutlineOptions {
  inner: number; outer: number; color: VectorLike; blend: BlendMode;
  depthRamp: number; normalRamp: number;
}
export interface OverscanOptions { range: number; all: boolean; }

/** <Pass> props: render-pass flags plus the postprocessing options. */
export interface PassProps {
  children?: ViewerElement;
  mode?: 'forward' | 'deferred' | 'fullscreen';
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

/** Owns the picking registry; wrap both the pickable representations and any
 *  usePicking() caller in one. Must sit inside an <AutoCanvas>. */
export const PickingProvider: ViewerComponent<{ children?: ViewerElement }>;

/**
 * Resolve the atom under the cursor. `hover` tracks the pointer; `pick` is the
 * atom the last left press landed on — the click-to-seek hook, where the caller
 * maps the picked atom to a beat and seeks its own <TimelineProvider> (time
 * stays caller-owned). Optional `onHover`/`onPick` fire on change.
 */
export function usePicking(options?: {
  onHover?: (hit: PickHit | null) => void;
  onPick?: (hit: PickHit | null) => void;
}): { hover: PickHit | null; pick: PickHit | null };

/**
 * Read a set of @molgpu/fields for one picked atom, for a tooltip. `fields` maps
 * a label to an atom-domain Field; the result maps the same labels to the atom's
 * value (number, number[], or string). `t` is the timeline time for any
 * time-dependent field. Evaluations are cached per (field, data, t).
 */
export function tooltipFields(
  fields: Record<string, Field>,
  data: StructureData,
  atom: number,
  options?: { t?: number },
): Record<string, number | number[] | string>;

// --- Anchored labels & primitives -------------------------------------------

/** A flat text label anchored to the centroid of a selection (its mean atom
 *  position), not a literal coordinate. `select` chooses the atoms (whole active
 *  structure without one); `at` overrides with an explicit point. Needs
 *  <FontLoader> + <SDFFontProvider> ancestors for the glyphs. */
export const Label: ViewerComponent<{
  select?: Selection | null;
  /** Explicit [x, y, z] anchor, overriding the selection centroid. */
  at?: readonly number[];
  text?: string;
  size?: number;
  color?: VectorLike;
  offset?: readonly number[];
  family?: string;
  /** 0–1, multiplied into the text colour's alpha (text always blends). */
  opacity?: number;
}>;

/** A distance measurement between two selections' centroids: a connecting line
 *  plus a midpoint label of the separation in Ångström. Needs <FontLoader> +
 *  <SDFFontProvider> ancestors for the label. */
export const Distance: ViewerComponent<{
  a: Selection;
  b: Selection;
  color?: VectorLike;
  width?: number;
  size?: number;
  labelColor?: VectorLike;
  /** 0–1, fades the line and label together. */
  opacity?: number;
  /** Customise the label text; receives the distance in Ångström. */
  format?: (distance: number) => string;
}>;

/** The centroid (mean atom position, Ångström) of a selection, or of the whole
 *  structure when `select` is null — the anchor <Label>/<Distance> use. */
export function centroid(data: StructureData, select?: Selection | null): [number, number, number];

/** Join annotation records (or a fetched JSON `src`) onto the nearest Structure
 * by identity, returning a field. `options` must be stable across renders. */
export function useAnnotation<R = unknown>(input: {
  records?: readonly R[];
  src?: string;
  loader?: (src: string, cancelled: () => boolean) => unknown;
  domain?: 'residue' | 'chain';
  fields: readonly string[];
  value?: (record: R) => number | readonly number[];
  type?: unknown;
  policy?: 'fallback' | 'fail';
  fallback?: number | readonly number[];
  duplicate?: 'error' | 'first' | 'last';
  lift?: boolean;
}): { field: Field | null; pending: boolean; error: unknown };

export interface ViewScale {
  readonly pixelRatio: number;
  readonly viewScale: number;
  readonly worldScale: number;
}

/** Convert an Ångström radius to PointLayer's `sizes` input for `depth: 1`. */
export function pointSizeForRadius(radius: number, view: ViewScale): number;
export function pointSizeForCameraRadius(radius: number, view: {
  height: number; pixelRatio?: number; fov?: number; focus?: number;
}): number;
export function pointSizesForRadii(
  radii: Float32Array, view: ViewScale, scale?: number,
): Float32Array;

/** World-space radius emitted by shaded LineLayer for a width/depth pair. */
export function lineRadiusForWidth(width: number, depth: number, view?: {
  pixelRatio?: number; viewScale?: number; worldScale?: number; clipW?: number;
}): number;

/** useAwait dependency key: structure identity/revisions plus geometry-only
 * params. Throws if `params` holds a style key (color, opacity). */
export function geometryDeps(resource: StructureResource, params?: Record<string, unknown>): readonly unknown[];
export interface GridBudget { maxBytes?: number; bytesPerCell?: number; }
/** Throws a RangeError (code GEOMETRY_BUDGET_EXCEEDED) before a grid this size would be allocated. */
export function assertGridBudget(dims: readonly [number, number, number], budget?: GridBudget): number;
export function copyOwned<T extends { slice(): T }>(typedArray: T): T;
export function runGeometryJob<T>(kernel: () => T | Promise<T>, cancelled: () => boolean): Promise<T | null>;
/** Schedule a cancellable geometry build; see use-geometry-job.mjs for the full contract. */
export function useGeometryJob<P extends Record<string, unknown>, T>(
  resource: StructureResource, params: P, kernel: (resource: StructureResource, params: P) => T | Promise<T>,
): readonly [T | undefined, unknown, boolean];

// Only the declarations marked `export` above are public.
export {};
