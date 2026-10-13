import { sampleVolumeWgsl } from "@molgpu/fields";
import { type VolumeGrid, volumeInverseTransform } from "@molgpu/table";
import { wgsl } from "@use-gpu/shader/wgsl";
import type { ColorStops } from "../../types.ts";
import { colorRampWgsl, wgslF32 as f32 } from "./color-ramp.ts";

// One square covering the volume; its corners come from three uniforms, so
// moving the plane is a uniform update. The world position doubles as the UV.
export const CORNERS = wgsl`
@link fn getCenter() -> vec3<f32>;
@link fn getAxisU() -> vec3<f32>;
@link fn getAxisV() -> vec3<f32>;
@export fn getCorner(i: u32) -> vec4<f32> {
  let s = select(-1.0, 1.0, (i & 1u) == 1u);
  let t = select(-1.0, 1.0, (i & 2u) == 2u);
  return vec4<f32>(getCenter() + s * getAxisU() + t * getAxisV(), 1.0);
}
`;

/** Fragment WGSL: sample the volume at the interpolated world position. */
export function sliceFragment(volume: VolumeGrid, stops: ColorStops): string {
  const m = volumeInverseTransform(volume);
  const t = volume.transform;
  const [nx, ny, nz] = volume.dims;
  const row = (r: number) => `${f32(m[r])}, ${f32(m[4 + r])}, ${f32(m[8 + r])}`;
  const ramp = colorRampWgsl(stops);
  return `@link fn getVolumeValue(i: u32) -> f32;
@link fn getRange() -> vec2<f32>;
${sampleVolumeWgsl(volume, "sliceSample", "getVolumeValue")}
fn sliceInside(p: vec3<f32>) -> bool {
  let d = p - vec3<f32>(${f32(t[12])}, ${f32(t[13])}, ${f32(t[14])});
  let u = vec3<f32>(
    dot(vec3<f32>(${row(0)}), d),
    dot(vec3<f32>(${row(1)}), d),
    dot(vec3<f32>(${row(2)}), d),
  );
  let top = vec3<f32>(${f32(nx - 1)}, ${f32(ny - 1)}, ${f32(nz - 1)});
  return all(u >= vec3<f32>(-1e-4)) && all(u <= top + vec3<f32>(1e-4));
}
fn sliceRamp(x: f32) -> vec4<f32> {
${ramp}
}
@export fn getFragment(color: vec4<f32>, uv: vec4<f32>, st: vec4<f32>) -> vec4<f32> {
  if (!sliceInside(uv.xyz)) { discard; }
  let range = getRange();
  let x = clamp((sliceSample(uv.xyz) - range.x) / (range.y - range.x), 0.0, 1.0);
  return sliceRamp(x) * color;
}
`;
}
