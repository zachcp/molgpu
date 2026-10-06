import { type LC, provide, use, useMemo } from "@use-gpu/live";
import {
  FresnelMaterialEffect,
  MaterialContext,
  PBRMaterial,
  useMaterialContext,
  useShader,
  useShaderRef,
} from "@use-gpu/workbench";
import { wgsl } from "@use-gpu/shader/wgsl";
import { SurfaceFragment } from "@use-gpu/wgsl/use/types.wgsl";
import type { ViewerElement } from "@molgpu/viewer";

// Perturbs the parent material's shaded normal with the gradient of 3D value
// noise of world position (Å), so a UV-less SES mesh gets pits and ridges
// without a normal map. Amplitude and scale are uniforms.
const BUMP_SURFACE = {
  module: wgsl`
use '@use-gpu/wgsl/use/types'::{ SurfaceFragment };

@link fn getSurface(
  color: vec4<f32>,
  uv: vec4<f32>,
  st: vec4<f32>,
  normal: vec4<f32>,
  tangent: vec4<f32>,
  position: vec4<f32>,
  coord: vec4<f32>,
) -> SurfaceFragment {};
@link fn getAmplitude() -> f32 {};
@link fn getScale() -> f32 {};

fn hash3(p: vec3<f32>) -> f32 {
  let q = fract(p * 0.1031);
  let r = q + dot(q, q.yzx + 33.33);
  return fract((r.x + r.y) * r.z);
}

fn valueNoise(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let x00 = mix(hash3(i), hash3(i + vec3<f32>(1.0, 0.0, 0.0)), u.x);
  let x10 = mix(hash3(i + vec3<f32>(0.0, 1.0, 0.0)), hash3(i + vec3<f32>(1.0, 1.0, 0.0)), u.x);
  let x01 = mix(hash3(i + vec3<f32>(0.0, 0.0, 1.0)), hash3(i + vec3<f32>(1.0, 0.0, 1.0)), u.x);
  let x11 = mix(hash3(i + vec3<f32>(0.0, 1.0, 1.0)), hash3(i + vec3<f32>(1.0, 1.0, 1.0)), u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}

// Two octaves: pores plus finer grit.
fn pumice(p: vec3<f32>) -> f32 {
  return valueNoise(p) * 0.7 + valueNoise(p * 2.9 + 17.0) * 0.3;
}

@export fn getBumpSurface(
  color: vec4<f32>,
  uv: vec4<f32>,
  st: vec4<f32>,
  normal: vec4<f32>,
  tangent: vec4<f32>,
  position: vec4<f32>,
  coord: vec4<f32>,
) -> SurfaceFragment {
  var surface = getSurface(color, uv, st, normal, tangent, position, coord);
  let amplitude = getAmplitude();
  if (amplitude <= 0.0) { return surface; }

  let p = surface.position.xyz / max(surface.position.w, 1e-6) * getScale();
  let e = 0.08;
  let n0 = pumice(p);
  let gradient = vec3<f32>(
    pumice(p + vec3<f32>(e, 0.0, 0.0)) - n0,
    pumice(p + vec3<f32>(0.0, e, 0.0)) - n0,
    pumice(p + vec3<f32>(0.0, 0.0, e)) - n0,
  ) / e;
  let N = normalize(surface.normal.xyz);
  let tangential = gradient - N * dot(gradient, N);
  surface.normal = vec4<f32>(normalize(N - amplitude * tangential), surface.normal.w);
  // Pits read darker, as cavities would under ambient light.
  let cavity = mix(1.0, 0.55 + 0.45 * n0, clamp(amplitude, 0.0, 1.0));
  surface.albedo = vec4<f32>(surface.albedo.rgb * cavity, surface.albedo.a);
  return surface;
}
`,
  // Any export of the types module carries its full code for the linker.
  libs: { "@use-gpu/wgsl/use/types": SurfaceFragment },
};

/**
 * Wraps the shaded surface of the material above it with a procedural bump.
 * Changing amplitude or scale only rewrites uniforms.
 */
const SurfaceBump: LC<{
  amplitude: number;
  scale: number;
  children?: ViewerElement;
}> = ({ amplitude, scale, children }) => {
  const material = useMaterialContext();
  const a = useShaderRef(amplitude);
  const s = useShaderRef(scale);
  const getSurface = useShader(BUMP_SURFACE, [
    material.shaded.getSurface,
    a,
    s,
  ]);
  const context = useMemo(
    () => ({ ...material, shaded: { ...material.shaded, getSurface } }),
    [material, getSurface],
  );
  return provide(MaterialContext, context, children);
};

/**
 * Glass: PBR with use.gpu's FresnelMaterialEffect, so faces turned to the
 * camera stay clear and grazing edges glow. `fresnel: false` sets the effect's
 * base opacity to 1 (Schlick then returns 1: no change), so toggling it is a
 * uniform write, not a new shader or layer.
 */
export const glassMaterial = (
  { roughness, metalness, fresnel }: {
    roughness: number;
    metalness: number;
    fresnel: boolean;
  },
) =>
(children: ViewerElement): ViewerElement =>
  use(PBRMaterial, {
    roughness,
    metalness,
    children: use(FresnelMaterialEffect, {
      opacity: fresnel ? 0.04 : 1,
      children,
    }),
  });

/** Pumice: matte PBR with a procedural bump of `amplitude` at `scale` per Å. */
export const pumiceMaterial = (
  { roughness, amplitude, scale }: {
    roughness: number;
    amplitude: number;
    scale: number;
  },
) =>
(children: ViewerElement): ViewerElement =>
  use(PBRMaterial, {
    roughness,
    metalness: 0,
    children: use(SurfaceBump, { amplitude, scale, children }),
  });
