// Shader specialization depends on the grid, lattice side and colour stops.
// Linked values (volume samples, plane, style, range and tint) stay live.
import { sampleVolumeGradientWgsl } from "@molgpu/fields";
import type { VolumeGrid } from "@molgpu/table";
import type { SliceStops } from "./volume-slice.ts";
import { colorRampWgsl, wgslF32 as f32 } from "./color-ramp.ts";

/** Shared prelude: lattice placement and the field at an arrow's tail. */
function prelude(grid: VolumeGrid, side: number): string {
  return `@link fn getVolumeValue(i: u32) -> f32;
@link fn getCenter() -> vec3<f32>;
@link fn getAxisU() -> vec3<f32>;
@link fn getAxisV() -> vec3<f32>;
@link fn getStyle() -> vec4<f32>;
${sampleVolumeGradientWgsl(grid, "arrowGrad", "getVolumeValue")}
fn arrowTail(a: u32) -> vec3<f32> {
  let n = ${side}u;
  let s = -1.0 + (f32(a % n) + 0.5) * ${f32(2 / side)};
  let t = -1.0 + (f32(a / n) + 0.5) * ${f32(2 / side)};
  return getCenter() + s * getAxisU() + t * getAxisV();
}
fn arrowField(a: u32) -> vec3<f32> { return -arrowGrad(arrowTail(a)); }
// style = (scale Å per unit |E|, maxLength Å, minField, width px)
fn arrowShown(e: vec3<f32>) -> bool { return length(e) >= getStyle().z; }
`;
}

/** Endpoint WGSL (exported for the harness, not public API). */
export function positionsWgsl(grid: VolumeGrid, side: number): string {
  return `${prelude(grid, side)}
@export fn getArrowPosition(k: u32) -> vec4<f32> {
  let a = k / 2u;
  let p = arrowTail(a);
  if ((k & 1u) == 0u) { return vec4<f32>(p, 1.0); }
  let e = arrowField(a);
  let m = length(e);
  let len = min(m * getStyle().x, getStyle().y);
  return vec4<f32>(p + select(vec3<f32>(0.0), e / m * len, m > 0.0), 1.0);
}
`;
}

export function widthsWgsl(grid: VolumeGrid, side: number): string {
  return `${prelude(grid, side)}
@export fn getArrowWidth(k: u32) -> f32 {
  return select(0.0, getStyle().w, arrowShown(arrowField(k / 2u)));
}
`;
}

export function colorsWgsl(
  grid: VolumeGrid,
  side: number,
  stops: SliceStops | null,
): string {
  const ramp = colorRampWgsl(stops);
  return `${prelude(grid, side)}
@link fn getRange() -> vec2<f32>;
@link fn getTint() -> vec4<f32>;
fn arrowRamp(x: f32) -> vec4<f32> {
${ramp}
}
@export fn getArrowColor(k: u32) -> vec4<f32> {
  let e = arrowField(k / 2u);
  if (!arrowShown(e)) { return vec4<f32>(0.0); }
  let range = getRange();
  let x = clamp((length(e) - range.x) / (range.y - range.x), 0.0, 1.0);
  return arrowRamp(x) * getTint();
}
`;
}
