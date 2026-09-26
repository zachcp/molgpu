import { useShader, useShaderRef } from "@use-gpu/workbench";
import type { ShaderSource } from "@use-gpu/shader";
import { wgsl } from "@use-gpu/shader/wgsl";

// Scale a per-row colour source's alpha by a uniform, composed shader-side like
// world-space-points' SCALED_SIZE: changing opacity is a uniform write, never a
// new colour column or re-upload.
const OPACITY_COLORS = wgsl`
@link fn getColor(index: u32) -> vec4<f32>;
@link fn getOpacity() -> f32;
@export fn getOpacityColor(index: u32) -> vec4<f32> {
  let c = getColor(index);
  return vec4<f32>(c.rgb, c.a * getOpacity());
}
`;

/** A colour ShaderSource whose alpha is multiplied by `opacity` (a uniform). */
export function useOpacityColors(
  colors: ShaderSource,
  opacity: number,
): ShaderSource {
  const opacityRef = useShaderRef(opacity);
  return useShader(OPACITY_COLORS, [colors, opacityRef]);
}
