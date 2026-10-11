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
import type { ViewerComponent } from "../../types.ts";
import { useVolume } from "../volume-context.ts";
import { modeProps } from "../../rendering/opacity.ts";
import { slicePlaneFrame } from "./slice-plane.ts";
import { count } from "../../internal/instrumentation.ts";
import { useRepaint } from "../../internal/use-repaint.ts";
import { useBindingProbe } from "../../internal/use-binding-probe.ts";

import {
  type FieldArrowsProps,
  normalizeFieldArrowsOptions,
} from "./field-arrows-options.ts";
import {
  colorsWgsl,
  positionsWgsl,
  widthsWgsl,
} from "./field-arrows-shaders.ts";

// Kept for the endpoint readback harness; not a public package entry.
export { positionsWgsl } from "./field-arrows-shaders.ts";

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
 * every volume generation. Changing lattice size, colour stops, or whether
 * `colorRange` is present rebuilds shaders.
 */
export const FieldArrows: ViewerComponent<FieldArrowsProps> = (props) => {
  useRepaint();
  const {
    plane,
    spacing,
    scale,
    maxLength: cap,
    minField,
    color,
    colorRange,
    stops,
    width,
    opacity,
    mode,
  } = normalizeFieldArrowsOptions(props);
  useBindingProbe("fieldArrows", color, opacity, width, scale, colorRange);
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
  return (use(ArrowLayer, {
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
