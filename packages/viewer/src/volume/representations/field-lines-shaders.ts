import { wgsl } from "@use-gpu/shader/wgsl";
import type { ColorStops } from "../../types.ts";
import { colorRampWgsl } from "./color-ramp.ts";

export const VERTEX_POSITIONS = wgsl`
@link fn getVertex(i: u32) -> vec4<f32>;
@export fn getLinePosition(i: u32) -> vec4<f32> {
  return vec4<f32>(getVertex(i).xyz, 1.0);
}
`;
export const VERTEX_WIDTHS = wgsl`
@link fn getVertex(i: u32) -> vec4<f32>;
@link fn getWidth() -> f32;
@export fn getLineWidth(i: u32) -> f32 {
  return select(0.0, getWidth(), getVertex(i).w >= 0.0);
}
`;
/** Colour by |E| through the ramp, or flat; stopped vertices are clear. */
export function rampWgsl(stops: ColorStops | null): string {
  const ramp = colorRampWgsl(stops);
  return `@link fn getVertex(i: u32) -> vec4<f32>;
@link fn getRange() -> vec2<f32>;
@link fn getTint() -> vec4<f32>;
fn lineRamp(x: f32) -> vec4<f32> {
${ramp}
}
@export fn getLineColor(i: u32) -> vec4<f32> {
  let w = getVertex(i).w;
  if (w < 0.0) { return vec4<f32>(0.0); }
  let range = getRange();
  let x = clamp((w - range.x) / (range.y - range.x), 0.0, 1.0);
  return lineRamp(x) * getTint();
}
`;
}
