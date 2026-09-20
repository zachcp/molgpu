import type { LC, LiveContext, LiveElement } from '@use-gpu/live';
import type { VectorLike } from '@use-gpu/core';
import type { ShaderSource } from '@use-gpu/shader';
import type { PointLayerProps } from '@use-gpu/workbench';
import type { StructureData } from '@molgpu/table';
import type { Field } from '@molgpu/fields';
import type { Selection } from '@molgpu/select';

/** Ångström-space axis-aligned extent, or null for an empty structure. */
export interface StructureBounds {
  readonly min: number[]; readonly max: number[]; readonly center: number[];
}

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

/** GPU columns allocated once per structure and shared by representations. */
export interface StructureSources {
  readonly positions: ShaderSource;
  readonly radii: ShaderSource;
}

export interface StructureContextValue {
  readonly resource: StructureResource;
  /** Null for an empty structure, which owns no GPU source. */
  readonly sources: StructureSources | null;
}

export const StructureContext: LiveContext<StructureContextValue | undefined>;

export const StructureProvider: LC<{
  data: StructureData;
  maxSelections?: number;
  children?: LiveElement;
}>;

/** Throws when called outside a <Structure> subtree. */
export function useStructure(): StructureContextValue;

/** A compositional boundary only: it never owns a canvas or GPU device. */
export const Molecule: LC<{ children?: LiveElement }>;

/** Resolves to StructureData, or to null when `cancelled()` becomes true. */
export type StructureLoader = (
  src: string,
  cancelled: () => boolean,
) => StructureData | null | Promise<StructureData | null>;

interface StructureCommonProps {
  /** Per-structure selection cache bound; defaults to 64. */
  maxSelections?: number;
  children?: LiveElement;
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
  loading?: LiveElement | (() => LiveElement);
  error?: LiveElement | ((failure: unknown) => LiveElement);
}

/** `data` and `src` are mutually exclusive, and exactly one is required. */
export type StructureProps = PreloadedStructureProps | LoadedStructureProps;

export const Structure: LC<StructureProps>;

/** Render atom sites as world-space shaded spheres, optionally restricted to a
 * selection and coloured by a field. */
export const Spacefill: LC<{
  /** Multiplies each atom's Ångström radius; defaults to 1. */
  scale?: number;
  /** A @molgpu/select atom Selection for this structure; restricts the draw. */
  select?: Selection | null;
  /** A flat colour, or a @molgpu/fields Field composed shader-side per atom. */
  color?: VectorLike | Field;
} & Omit<PointLayerProps, 'positions' | 'sizes' | 'count' | 'color'>>;

/** Draw Ångström radii through PointLayer's camera-normalized `sizes` API. */
export const WorldSpacePointLayer: LC<{
  positions: ShaderSource;
  colors?: ShaderSource;
  radii: Float32Array;
  /** Defaults to `radii.length`. */
  count?: number;
  scale?: number;
} & Omit<PointLayerProps, 'positions' | 'colors' | 'sizes' | 'count' | 'depth'>>;

/**
 * Lower a numeric @molgpu/fields Field to a use.gpu shader source, composed over
 * existing GPU inputs. `inputs` maps each compiled binding id to a StorageSource
 * (buffer input) or a number/ShaderRef (uniform), so a per-row column is never
 * materialised and a uniform change is a binding update, not a re-upload.
 */
export function useField(
  field: Field,
  inputs: Record<string, ShaderSource | number | { current: number }>,
  options?: { domain?: 'atom' | 'residue' },
): ShaderSource;

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
