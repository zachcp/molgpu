// @molgpu/viewer/advanced: the use.gpu-shaped escape hatches. Unlike ".", these
// declarations name @use-gpu/* types directly (shader sources, Live contexts,
// shader modules); the peer versions are pinned, so these types are exact.
import type { LC, LiveContext } from '@use-gpu/live';
import type { ShaderSource } from '@use-gpu/shader';
import type { PointLayerProps, ShaderFlatMaterialProps, ShaderLitMaterialProps } from '@use-gpu/workbench';
import type { Field } from '@molgpu/fields';
// Type-only: resolves to ./index.d.ts (the runtime module is ./index.mjs).
import type { StructureResource } from './index.js';

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

/** The nearest <Structure>'s resource and GPU sources; undefined outside one. */
export const StructureContext: LiveContext<StructureContextValue | undefined>;

/** Throws when called outside a <Structure> subtree. */
export function useStructure(): StructureContextValue;

/** Controlled global time in seconds, as provided by <TimelineProvider>. */
export const TimelineContext: LiveContext<number | null>;

/** Custom flat (unlit) fragment shader. */
export const FlatMaterial: LC<ShaderFlatMaterialProps>;
/** Custom lit fragment shader — the general escape hatch under PBR. */
export const LitMaterial: LC<ShaderLitMaterialProps>;

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
 * The `curve:t` binding uses the nearest TimelineProvider unless explicitly
 * supplied in `inputs`.
 */
export function useField(
  field: Field,
  inputs?: Record<string, ShaderSource | number | { current: number }>,
  options?: { domain?: 'atom' | 'residue' },
): ShaderSource;

export {};
