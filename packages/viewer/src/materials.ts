import type { LC } from '@use-gpu/live';
import type { ShaderFlatMaterialProps, ShaderLitMaterialProps } from '@use-gpu/workbench';
import type { BasicMaterialProps, FresnelMaterialEffectProps, MaterialSpec, MaterialType, NormalMaterialProps, PBRMaterialProps, ViewerComponent, ViewerElement } from './types.ts';
import { use } from '@use-gpu/live';
import {
  PBRMaterial as UpstreamPBRMaterial,
  BasicMaterial as UpstreamBasicMaterial,
  NormalMaterial as UpstreamNormalMaterial,
  ShaderFlatMaterial,
  ShaderLitMaterial,
  FresnelMaterialEffect as UpstreamFresnelMaterialEffect,
} from '@use-gpu/workbench';
import { live, viewer } from './internal/elements.ts';
import { resolveMaterial, materialTypes } from './internal/material-spec.ts';

/**
 * Thin @molgpu/viewer wrappers over @use-gpu/workbench's material components.
 * A material is a context provider: it wraps geometry and every `shaded` layer
 * beneath it reads its shading model from the surrounding MaterialContext. The
 * wrappers add molecular-domain defaults and nothing else — every upstream prop
 * (maps, emissive, environment, render/children) forwards untouched.
 */

/**
 * Physically based material. Molecules read best as a matte, non-metallic
 * surface, so we default `metalness: 0` and a slightly rougher `roughness: 0.6`
 * than upstream's 0.5. Pass `albedo` for a flat base colour, or leave it and let
 * a representation's per-vertex colour drive the fragment.
 */
export const PBRMaterial: ViewerComponent<PBRMaterialProps> = ({ metalness = 0, roughness = 0.6, ...props }) =>
  use(UpstreamPBRMaterial, { metalness, roughness, ...props });

/** Unlit flat colour (fastest; ignores lights). */
export const BasicMaterial: ViewerComponent<BasicMaterialProps> = (props) => use(UpstreamBasicMaterial, props);

/** Surface-normal debug material — colours by world/view normal. */
export const NormalMaterial: ViewerComponent<NormalMaterialProps> = (props) => use(UpstreamNormalMaterial, props);

/** Custom flat (unlit) fragment shader. */
export const FlatMaterial: LC<ShaderFlatMaterialProps> = (props) => use(ShaderFlatMaterial, props);

/** Custom lit fragment shader — the general escape hatch under PBRMaterial. */
export const LitMaterial: LC<ShaderLitMaterialProps> = (props) => use(ShaderLitMaterial, props);

/** Fresnel rim effect, composed over another material's children. */
export const FresnelMaterialEffect: ViewerComponent<FresnelMaterialEffectProps> = (props) => use(UpstreamFresnelMaterialEffect, props);

export { materialTypes };

/** Material-spec `type` → wrapper component, for the representations' `material` prop. */
// Each wrapper takes its own props; resolveMaterial has already validated the spec.
const MATERIALS: Record<MaterialType, LC<any>> = {
  pbr: PBRMaterial,
  basic: BasicMaterial,
  normal: NormalMaterial,
  flat: FlatMaterial,
  lit: LitMaterial,
};

/**
 * Wrap a representation's rendered element in a material so the `shaded` layers
 * beneath it pick up its MaterialContext. `material` is null/undefined (no wrap),
 * a `(children) => element` function (escape hatch), or a spec object
 * `{ type?, ...props }` — see resolveMaterial for the exact contract.
 */
export function withMaterial(material: MaterialSpec | null | undefined, element: ViewerElement): ViewerElement {
  const resolved = resolveMaterial(material);
  if (resolved.kind === 'none') return element;
  if (resolved.kind === 'wrap') return resolved.wrap(element);
  return viewer(use(MATERIALS[resolved.type], { ...resolved.props, children: live(element) }));
}
