import type { ColorStops, ViewerComponent } from "../../types.ts";
import { use, useMemo } from "@use-gpu/live";
import {
  FaceLayer,
  ShaderFlatMaterial,
  useShader,
  useShaderRef,
} from "@use-gpu/workbench";
import { loadModuleWithCache } from "@use-gpu/shader/wgsl";
import { useVolume } from "../volume-context.ts";
import { withColumns } from "../../rendering/representation.ts";
import { modeProps } from "../../rendering/opacity.ts";
import { slicePlaneFrame } from "./slice-plane.ts";
import { useRepaint } from "../../internal/use-repaint.ts";
import { useBindingProbe } from "../../internal/use-binding-probe.ts";
import { count } from "../../internal/instrumentation.ts";
import {
  normalizeVolumeSliceOptions,
  type VolumeSliceProps,
} from "./volume-slice-options.ts";
import { CORNERS, sliceFragment } from "./volume-slice-shaders.ts";

export type { SlicePlane } from "./slice-plane.ts";

/** Colour stops `[t, [r, g, b, a]]` over the normalised range 0–1. */
export type SliceStops = ColorStops;

const QUAD = Uint32Array.from([0, 1, 2, 2, 1, 3]);

/**
 * A planar cross-section through the nearest `<Volume>` or `<EField>`, coloured per fragment
 * by sampling the volume's shared GPU samples (trilinear, the same WGSL as
 * `volumeSample`) through a piecewise-linear colour ramp. `plane` is a grid
 * plane (`{ axis, index }`, which follows the grid's shear) or a world plane
 * (`{ normal, point }`); only the part inside the grid is drawn. `range` maps
 * values to 0–1 (default: the volume's display range, min to max for a loaded
 * volume and ±range for `<EField>`) and `stops` colour that
 * interval. Moving the plane, changing `range` or `opacity` updates uniforms
 * only: no geometry is rebuilt and the volume is never re-uploaded. The shader
 * depends only on the grid, so a computed volume's new samples are drawn live
 * without a recompile.
 */
export const VolumeSlice: ViewerComponent<VolumeSliceProps> = (props) => {
  const { grid: volume, source, range: fallback } = useVolume();
  const { plane, range: [lo, hi], stops, color, opacity, mode } =
    normalizeVolumeSliceOptions(props, fallback);

  useRepaint();
  useBindingProbe("slice", color, opacity);
  const sorted = useMemo(
    () => [...stops].sort((a, b) => a[0] - b[0]) as SliceStops,
    [stops],
  );
  const frame = slicePlaneFrame(
    volume,
    plane ?? { axis: 2, index: (volume.dims[2] - 1) / 2 },
  );
  const center = useShaderRef(frame.center);
  const u = useShaderRef(frame.u);
  const v = useShaderRef(frame.v);
  const rangeRef = useShaderRef([lo, hi]);
  const corners = useShader(CORNERS, [center, u, v]);
  const module = useMemo(
    () => (count("shaderBuilds", "slice:module"),
      loadModuleWithCache(
        sliceFragment(volume, sorted),
        "molgpu-volume-slice",
        "auto",
      )),
    [volume, sorted],
  );
  const fragment = useShader(module, [source, rangeRef]);
  const drawColor = useMemo(
    () => [color[0], color[1], color[2], (color[3] ?? 1) * opacity],
    [color, opacity],
  );
  const drawMode = modeProps(mode, drawColor[3]);
  return withColumns(
    [{ key: "indices", data: QUAD, format: "u32" }],
    (map) =>
      use(ShaderFlatMaterial, {
        fragment,
        children: use(FaceLayer, {
          positions: corners,
          uvs: corners,
          indices: map.indices,
          color: drawColor,
          side: "both",
          ...drawMode,
        }),
      }),
  );
};
