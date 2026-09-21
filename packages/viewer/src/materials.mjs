import { use } from '@use-gpu/live';
import {
  PBRMaterial as UpstreamPBRMaterial,
  BasicMaterial as UpstreamBasicMaterial,
  NormalMaterial as UpstreamNormalMaterial,
  ShaderFlatMaterial,
  ShaderLitMaterial,
  FresnelMaterialEffect as UpstreamFresnelMaterialEffect,
} from '@use-gpu/workbench';
import { resolveMaterial, materialTypes } from './internal/material-spec.mjs';

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
export const PBRMaterial = ({ metalness = 0, roughness = 0.6, ...props }) =>
  use(UpstreamPBRMaterial, { metalness, roughness, ...props });

/** Unlit flat colour (fastest; ignores lights). */
export const BasicMaterial = (props) => use(UpstreamBasicMaterial, props);

/** Surface-normal debug material — colours by world/view normal. */
export const NormalMaterial = (props) => use(UpstreamNormalMaterial, props);

/** Custom flat (unlit) fragment shader. */
export const FlatMaterial = (props) => use(ShaderFlatMaterial, props);

/** Custom lit fragment shader — the general escape hatch under PBRMaterial. */
export const LitMaterial = (props) => use(ShaderLitMaterial, props);

/** Fresnel rim effect, composed over another material's children. */
export const FresnelMaterialEffect = (props) => use(UpstreamFresnelMaterialEffect, props);

export { materialTypes };

/** Material-spec `type` → wrapper component, for the representations' `material` prop. */
const MATERIALS = {
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
export const withMaterial = (material, element) => {
  const resolved = resolveMaterial(material);
  if (resolved.kind === 'none') return element;
  if (resolved.kind === 'wrap') return resolved.wrap(element);
  return use(MATERIALS[resolved.type], { ...resolved.props, children: element });
};
