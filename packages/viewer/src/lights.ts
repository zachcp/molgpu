import type { AmbientLightProps, DirectionalLightProps, DomeLightProps, EnvironmentProps, PointLightProps, SpotLightProps, ViewerComponent } from './types.ts';
import { use } from '@use-gpu/live';
import {
  AmbientLight as UpstreamAmbientLight,
  DirectionalLight as UpstreamDirectionalLight,
  PointLight as UpstreamPointLight,
  SpotLight as UpstreamSpotLight,
  DomeLight as UpstreamDomeLight,
  Environment as UpstreamEnvironment,
} from '@use-gpu/workbench';

/**
 * Thin @molgpu/viewer wrappers over @use-gpu/workbench's light and environment
 * components. Each light registers itself into the surrounding light context and
 * so must sit inside a `<Pass lights>` (the pass that draws the shaded layers).
 * The wrappers only add molecular-domain defaults; every upstream prop forwards.
 */

/**
 * A fixed world-space key-light direction, shared across molgpu scenes. Lighting
 * is deliberately anchored to the world, not the camera bearing/pitch, so
 * rotating the structure re-lights it consistently rather than dragging the
 * highlight around with the view.
 */
export const KEY_LIGHT_DIRECTION: readonly [number, number, number] = Object.freeze([-1, -2, -1.5]);

/** Soft fill. Defaults to a gentle `intensity: 0.3` so the key light shapes form. */
export const AmbientLight: ViewerComponent<AmbientLightProps> = ({ intensity = 0.3, ...props }) =>
  use(UpstreamAmbientLight, { intensity, ...props });

/** The key light. Defaults to the shared world-space direction at full intensity. */
export const DirectionalLight: ViewerComponent<DirectionalLightProps> = ({ direction = KEY_LIGHT_DIRECTION, intensity = 1, ...props }) =>
  use(UpstreamDirectionalLight, { direction, intensity, ...props });

/** A positioned, falloff light. */
export const PointLight: ViewerComponent<PointLightProps> = (props) => use(UpstreamPointLight, props);

/** A positioned, cone-limited light. */
export const SpotLight: ViewerComponent<SpotLightProps> = (props) => use(UpstreamSpotLight, props);

/** A gradient sky/ground dome for soft, even illumination. */
export const DomeLight: ViewerComponent<DomeLightProps> = (props) => use(UpstreamDomeLight, props);

/** Image-based lighting: provides the environment map PBRMaterial reflects. */
export const Environment: ViewerComponent<EnvironmentProps> = (props) => use(UpstreamEnvironment, props);
