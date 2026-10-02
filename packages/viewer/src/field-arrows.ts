// <FieldArrows>: E = −∇φ glyphs on a lattice in a plane through the nearest
// volume. Every endpoint is a shader function of the arrow index, the plane
// uniforms and the live samples: no compute pass and no per-move buffer.
// See docs/findings/2026-09-27-efield-plan.md.
import { use, useMemo } from "@use-gpu/live";
import {
  ArrowLayer,
  useArrowSegmentsSource,
  useShader,
  useShaderRef,
} from "@use-gpu/workbench";
import { loadModuleWithCache } from "@use-gpu/shader/wgsl";
import { sampleVolumeGradientWgsl } from "@molgpu/fields";
import type { VolumeGrid } from "@molgpu/table";
import type { Translucency, VectorLike, ViewerComponent } from "./types.ts";
import { useVolume } from "./volume-context.ts";
import { checkOpacity, modeProps } from "./internal/opacity.ts";
import { type SlicePlane, slicePlaneFrame } from "./internal/slice-plane.ts";
import { count } from "./internal/instrumentation.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";
import { viewer } from "./internal/elements.ts";
import type { SliceStops } from "./volume-slice.ts";
import { colorRampWgsl, wgslF32 as f32 } from "./internal/color-ramp.ts";

const DEFAULT_STOPS: SliceStops = [
  [0, [0.25, 0.35, 1, 1]],
  [1, [1, 0.85, 0.2, 1]],
];

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

function widthsWgsl(grid: VolumeGrid, side: number): string {
  return `${prelude(grid, side)}
@export fn getArrowWidth(k: u32) -> f32 {
  return select(0.0, getStyle().w, arrowShown(arrowField(k / 2u)));
}
`;
}

function colorsWgsl(
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

/**
 * Arrows of the electric field E = −∇φ of the nearest `<EField>` (or scalar
 * `<Volume>`), on a square lattice `spacing` Å apart in `plane` (the same
 * plane type as `<VolumeSlice>`; default the middle k plane). Each arrow
 * starts at its lattice point and points along E; its length is |E|·`scale`
 * Å, capped at `maxLength` (default 0.9 × spacing). Lattice points outside
 * the grid, or where |E| < `minField` (default 1e-3 per Å), are hidden.
 *
 * `color` tints; `colorRange` (|E| per Å) with `stops` colours by strength.
 * Moving the plane, `scale`, `maxLength`, `minField`, `width`, `color`,
 * `colorRange` and `opacity` are uniform writes: nothing is uploaded or
 * computed. The endpoints follow the live samples, so arrows update with
 * every volume generation. `spacing` and `stops` rebuild shaders.
 */
export const FieldArrows: ViewerComponent<
  {
    plane?: SlicePlane;
    spacing?: number;
    scale?: number;
    maxLength?: number;
    minField?: number;
    color?: VectorLike;
    colorRange?: readonly [number, number];
    stops?: SliceStops;
    /** Line width in pixels; default 3. */
    width?: number;
  } & Translucency
> = (
  {
    plane,
    spacing = 2,
    scale = 1,
    maxLength,
    minField = 1e-3,
    color = [1, 1, 1, 1],
    colorRange,
    stops = DEFAULT_STOPS,
    width = 3,
    opacity = 1,
    mode,
  },
) => {
  useRepaint();
  useBindingProbe("fieldArrows", color, opacity, width, scale, colorRange);
  checkOpacity(opacity, "FieldArrows");
  const cap = maxLength ?? 0.9 * spacing;
  for (
    const [name, value] of [
      ["spacing", spacing],
      ["scale", scale],
      ["maxLength", cap],
      ["minField", minField],
      ["width", width],
    ] as const
  ) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`FieldArrows ${name} must be positive and finite`);
    }
  }
  if (colorRange && !(colorRange[1] > colorRange[0])) {
    throw new TypeError("FieldArrows colorRange must be [lo, hi] with lo < hi");
  }
  const { grid, source } = useVolume();
  const frame = slicePlaneFrame(
    grid,
    plane ?? { axis: 2, index: (grid.dims[2] - 1) / 2 },
  );
  // The frame's extent depends only on the grid, so moving the plane keeps
  // the lattice size (and every buffer) unchanged.
  const radius = Math.hypot(frame.u[0], frame.u[1], frame.u[2]);
  const side = Math.max(1, Math.min(256, Math.floor((2 * radius) / spacing)));
  const arrows = side * side;

  const modules = useMemo(() => {
    count("shaderBuilds", "fieldArrows:modules");
    const load = (code: string) =>
      loadModuleWithCache(code, "molgpu-field-arrows", "auto");
    return {
      positions: load(positionsWgsl(grid, side)),
      widths: load(widthsWgsl(grid, side)),
      colors: load(
        colorsWgsl(
          grid,
          side,
          colorRange ? [...stops].sort((a, b) => a[0] - b[0]) : null,
        ),
      ),
    };
  }, [grid, side, colorRange ? stops : null, !!colorRange]);
  const center = useShaderRef(frame.center);
  const u = useShaderRef(frame.u);
  const v = useShaderRef(frame.v);
  const style = useShaderRef([scale, cap, minField, width]);
  const links = [source, center, u, v, style];
  const positions = useShader(modules.positions, links);
  const widths = useShader(modules.widths, links);
  const rangeRef = useShaderRef(colorRange ?? [0, 1]);
  const tint = useMemo(
    () => [color[0], color[1], color[2], (color[3] ?? 1) * opacity],
    [color, opacity],
  );
  const tintRef = useShaderRef(tint);
  const colors = useShader(modules.colors, [...links, rangeRef, tintRef]);
  const chunks = useMemo(() => new Array(arrows).fill(2), [arrows]);
  const segments = useArrowSegmentsSource(chunks, null, false, false, true);
  return viewer(use(ArrowLayer, {
    positions,
    colors,
    widths,
    segments: segments.segments,
    anchors: segments.anchors,
    trims: segments.trims,
    count: segments.count,
    width,
    size: 3,
    ...modeProps(mode, tint[3]),
  }));
};
