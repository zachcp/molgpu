import { sampleVolumeWgsl } from "@molgpu/fields";
import { type VolumeData, volumeInverseTransform } from "@molgpu/table";
import type { Translucency, VectorLike, ViewerComponent } from "./types.ts";
import { use, useMemo } from "@use-gpu/live";
import {
  FaceLayer,
  ShaderFlatMaterial,
  useShader,
  useShaderRef,
} from "@use-gpu/workbench";
import { loadModuleWithCache, wgsl } from "@use-gpu/shader/wgsl";
import { useVolume } from "./volume-context.ts";
import { withColumns } from "./internal/representation.ts";
import { checkOpacity, modeProps } from "./internal/opacity.ts";
import { type SlicePlane, slicePlaneFrame } from "./internal/slice-plane.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";

export type { SlicePlane } from "./internal/slice-plane.ts";

/** Colour stops `[t, [r, g, b, a]]` over the normalised range 0–1. */
export type SliceStops = ReadonlyArray<
  readonly [number, readonly [number, number, number, number]]
>;

const GREYS: SliceStops = [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]];
const QUAD = Uint32Array.from([0, 1, 2, 2, 1, 3]);

// One square covering the volume; its corners come from three uniforms, so
// moving the plane is a uniform update. The world position doubles as the UV.
const CORNERS = wgsl`
@link fn getCenter() -> vec3<f32>;
@link fn getAxisU() -> vec3<f32>;
@link fn getAxisV() -> vec3<f32>;
@export fn getCorner(i: u32) -> vec4<f32> {
  let s = select(-1.0, 1.0, (i & 1u) == 1u);
  let t = select(-1.0, 1.0, (i & 2u) == 2u);
  return vec4<f32>(getCenter() + s * getAxisU() + t * getAxisV(), 1.0);
}
`;

const f32 = (x: number): string => {
  const s = `${Math.fround(x)}`;
  return /[.e]/.test(s) ? s : `${s}.0`;
};
const vec4 = (c: readonly number[]) => `vec4<f32>(${c.map(f32).join(", ")})`;

/** Fragment WGSL: sample the volume at the interpolated world position. */
function sliceFragment(volume: VolumeData, stops: SliceStops): string {
  const m = volumeInverseTransform(volume);
  const t = volume.transform;
  const [nx, ny, nz] = volume.dims;
  const row = (r: number) => `${f32(m[r])}, ${f32(m[4 + r])}, ${f32(m[8 + r])}`;
  let ramp = `  if (x <= ${f32(stops[0][0])}) { return ${
    vec4(stops[0][1])
  }; }\n`;
  for (let i = 1; i < stops.length; i++) {
    const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
    ramp += `  if (x <= ${f32(t1)}) { return mix(${vec4(c0)}, ${
      vec4(c1)
    }, (x - ${f32(t0)}) / ${f32(Math.max(t1 - t0, 1e-12))}); }\n`;
  }
  ramp += `  return ${vec4(stops[stops.length - 1][1])};`;
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

/**
 * A planar cross-section through the nearest `<Volume>`, coloured per fragment
 * by sampling the volume's shared GPU samples (trilinear, the same WGSL as
 * `volumeSample`) through a piecewise-linear colour ramp. `plane` is a grid
 * plane (`{ axis, index }`, which follows the grid's shear) or a world plane
 * (`{ normal, point }`); only the part inside the grid is drawn. `range` maps
 * values to 0–1 (default: the volume's min and max) and `stops` colour that
 * interval. Moving the plane, changing `range` or `opacity` updates uniforms
 * only: no geometry is rebuilt and the volume is never re-uploaded.
 */
export const VolumeSlice: ViewerComponent<
  {
    /** Defaults to the middle k (third-axis) grid plane. */
    plane?: SlicePlane;
    /** Value interval mapped to 0–1. Defaults to the volume's min and max. */
    range?: readonly [number, number];
    /** Colour stops over 0–1. Defaults to black → white. */
    stops?: SliceStops;
    /** Multiplied into every fragment's colour. Defaults to white. */
    color?: VectorLike;
  } & Translucency
> = (
  { plane, range, stops = GREYS, color = [1, 1, 1, 1], opacity = 1, mode },
) => {
  useRepaint();
  useBindingProbe("slice", color, opacity);
  checkOpacity(opacity, "VolumeSlice");
  const { volume, source } = useVolume();
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new TypeError("VolumeSlice: stops needs at least two [t, color]");
  }
  const sorted = useMemo(
    () => [...stops].sort((a, b) => a[0] - b[0]) as SliceStops,
    [stops],
  );
  const frame = slicePlaneFrame(
    volume,
    plane ?? { axis: 2, index: (volume.dims[2] - 1) / 2 },
  );
  const { min, max } = volume.stats;
  const [lo, hi] = range ?? [min, max > min ? max : min + 1];
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    throw new TypeError(
      "VolumeSlice: range must be two distinct finite numbers",
    );
  }
  const center = useShaderRef(frame.center);
  const u = useShaderRef(frame.u);
  const v = useShaderRef(frame.v);
  const rangeRef = useShaderRef([lo, hi]);
  const corners = useShader(CORNERS, [center, u, v]);
  const module = useMemo(
    () =>
      loadModuleWithCache(
        sliceFragment(volume, sorted),
        "molgpu-volume-slice",
        "auto",
      ),
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
