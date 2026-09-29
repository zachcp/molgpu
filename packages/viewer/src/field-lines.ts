// <FieldLines>: RK4 streamlines of E = −∇φ through the nearest volume,
// integrated in one compute pass per volume generation and drawn with
// LineLayer. See docs/findings/2026-09-27-efield-plan.md §5.
import { use, useContext, useMemo, useResource } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import {
  LineLayer,
  LoopContext,
  useDeviceContext,
  useShader,
  useShaderRef,
} from "@use-gpu/workbench";
import { loadModuleWithCache, wgsl } from "@use-gpu/shader/wgsl";
import {
  FIELD_LINES_WORKGROUP as WORKGROUP,
  fieldLinesWgsl,
  latticeSeeds,
  lineSegments,
} from "./internal/field-line-geometry.ts";
import type { Translucency, VectorLike, ViewerComponent } from "./types.ts";
import { useVolume } from "./volume-context.ts";
import { withColumns } from "./internal/representation.ts";
import { checkOpacity, modeProps } from "./internal/opacity.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";
import { useRepaint } from "./internal/use-repaint.ts";
import { useBindingProbe } from "./internal/use-binding-probe.ts";
import { viewer } from "./internal/elements.ts";
import type { SliceStops } from "./volume-slice.ts";
import { colorRampWgsl } from "./internal/color-ramp.ts";

const STORAGE = 0x0080;
const UNIFORM = 0x0040;
const COPY_SRC = 0x0004;
const COPY_DST = 0x0008;

/** Test hook, not public API: the last integrated vertex buffer. */
export const fieldLinesTesting: {
  last: { buffer: GPUBuffer; vertices: number; generation: number } | null;
} = { last: null };

const DEFAULT_STOPS: SliceStops = [
  [0, [0.25, 0.35, 1, 1]],
  [1, [1, 0.85, 0.2, 1]],
];

const VERTEX_POSITIONS = wgsl`
@link fn getVertex(i: u32) -> vec4<f32>;
@export fn getLinePosition(i: u32) -> vec4<f32> {
  return vec4<f32>(getVertex(i).xyz, 1.0);
}
`;
const VERTEX_WIDTHS = wgsl`
@link fn getVertex(i: u32) -> vec4<f32>;
@link fn getWidth() -> f32;
@export fn getLineWidth(i: u32) -> f32 {
  return select(0.0, getWidth(), getVertex(i).w >= 0.0);
}
`;
/** Colour by |E| through the ramp, or flat; stopped vertices are clear. */
function rampWgsl(stops: SliceStops | null): string {
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

/**
 * Streamlines of the electric field E = −∇φ of the nearest `<EField>` (or any
 * scalar `<Volume>` read as a potential), traced with RK4 on E/|E| in both
 * directions from each seed, on the GPU, once per volume generation.
 *
 * `seeds` is `{ spacing }` (default 4 Å): a lattice through the grid thinned
 * by a fixed stride to `maxLines` (default 4096); or explicit packed xyz
 * points, which throw beyond `maxLines`. Each line has `steps` (default 128)
 * arc-length steps of `step` Å (default 0.25) each way. A line stops when it
 * leaves the grid, where |E| < `minField` (default 0.05 per Å) or where
 * |φ| > `maxPotential` (default ten times the volume's display range, so a
 * line ends near a charge rather than at its clamp). The field comes from central differences
 * of the grid (half a cell), so lines agree with the displayed volume.
 *
 * `color` tints every line; `colorRange` (|E| per Å) with `stops` colours by
 * field strength. `colorRange`, `color`, `width` and `opacity` are uniforms;
 * `stops` recompiles a shader; none re-integrates. Seeds, steps, step and
 * the grid rebuild the pass.
 */
export const FieldLines: ViewerComponent<
  {
    seeds?: Float32Array | { readonly spacing?: number };
    maxLines?: number;
    step?: number;
    steps?: number;
    minField?: number;
    maxPotential?: number;
    color?: VectorLike;
    colorRange?: readonly [number, number];
    stops?: SliceStops;
    /** Line width in pixels; default 2. */
    width?: number;
  } & Translucency
> = (
  {
    seeds = { spacing: 4 },
    maxLines = 4096,
    step = 0.25,
    steps = 128,
    minField = 0.05,
    maxPotential,
    color = [1, 1, 1, 1],
    colorRange,
    stops = DEFAULT_STOPS,
    width = 2,
    opacity = 1,
    mode,
  },
) => {
  useRepaint();
  useBindingProbe("fieldLines", color, opacity, width, colorRange);
  checkOpacity(opacity, "FieldLines");
  for (
    const [name, value] of [
      ["step", step],
      ["minField", minField],
      ["maxPotential", maxPotential ?? 1],
      ["width", width],
    ] as const
  ) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`FieldLines ${name} must be positive and finite`);
    }
  }
  if (!Number.isSafeInteger(steps) || steps < 1) {
    throw new TypeError("FieldLines steps must be a positive integer");
  }
  if (!Number.isSafeInteger(maxLines) || maxLines < 1) {
    throw new TypeError("FieldLines maxLines must be a positive integer");
  }
  if (colorRange && !(colorRange[1] > colorRange[0])) {
    throw new TypeError("FieldLines colorRange must be [lo, hi] with lo < hi");
  }
  const { grid, source, generation, range } = useVolume();
  // Ten times the display range: well inside the charges' clamp for every
  // model's default range (distance ≈ 1 Å, vacuum ≈ 4 Å from a unit charge).
  const potentialCap = maxPotential ??
    10 * Math.max(Math.abs(range[0]), Math.abs(range[1]));
  const device = useDeviceContext();
  const requestRepaint = useContext(LoopContext);
  const spacing = seeds instanceof Float32Array ? 0 : seeds.spacing ?? 4;
  const points = useMemo(() => {
    if (seeds instanceof Float32Array) {
      if (seeds.length % 3) {
        throw new TypeError("FieldLines seeds must be packed xyz");
      }
      if (seeds.length / 3 > maxLines) {
        throw new RangeError(
          `FieldLines: ${
            seeds.length / 3
          } seeds exceed maxLines ${maxLines}; pass fewer seeds or raise maxLines`,
        );
      }
      return seeds;
    }
    if (!(spacing > 0)) {
      throw new TypeError("FieldLines seed spacing must be positive");
    }
    return latticeSeeds(grid, spacing, maxLines);
  }, [grid, seeds instanceof Float32Array ? seeds : spacing, maxLines]);
  const lines = points.length / 3;
  const vertices = lines * (2 * steps + 1);

  const pipeline = useMemo(() => {
    count("shaderBuilds", "fieldLines:integrator");
    return device.createComputePipeline({
      layout: "auto",
      compute: {
        module: device.createShaderModule({
          code: fieldLinesWgsl(grid),
          label: "molgpu:field-lines",
        }),
        entryPoint: "main",
      },
      label: "molgpu:field-lines",
    });
  }, [device, grid]);
  const buffers = useMemo(() => {
    const make = (size: number, usage: number, label: string) => {
      const buffer = device.createBuffer({
        size: Math.max(16, Math.ceil(size / 16) * 16),
        usage,
        label: `molgpu:${label}`,
      });
      trackOwnedBuffer(buffer, label);
      return buffer;
    };
    const seedBuffer = make(
      points.byteLength,
      STORAGE | COPY_DST,
      "lines:seeds",
    );
    if (points.byteLength) {
      device.queue.writeBuffer(seedBuffer, 0, points);
      count("uploadBytes", "lines:seeds", points.byteLength);
    }
    const out = make(vertices * 16, STORAGE | COPY_SRC, "lines:vertices");
    const params = make(32, UNIFORM | COPY_DST, "lines:params");
    const bytes = new ArrayBuffer(32);
    new Uint32Array(bytes, 0, 2).set([lines, steps]);
    new Float32Array(bytes, 16, 3).set([step, minField, potentialCap]);
    device.queue.writeBuffer(params, 0, bytes);
    count("uploadBytes", "lines:params", 32);
    return { seedBuffer, out, params };
  }, [device, points, steps, step, minField, potentialCap]);
  useResource((dispose) => {
    // A retained LineLayer can keep submitting these vertices while its
    // replacement shader compiles. Release our ownership and let WebGPU
    // reclaim each allocation after the last binding becomes unreachable.
    dispose(() => Object.values(buffers).forEach(releaseOwnedBuffer));
  }, [buffers]);
  const group = useMemo(() =>
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: source.buffer } },
        { binding: 1, resource: { buffer: buffers.seedBuffer } },
        { binding: 2, resource: { buffer: buffers.out } },
        { binding: 3, resource: { buffer: buffers.params } },
      ],
    }), [pipeline, buffers, source.buffer]);
  // Integrate once per volume generation (and pass rebuild), during render,
  // after the volume's own compute was submitted.
  useMemo(() => {
    if (!lines) return;
    const encoder = device.createCommandEncoder({ label: "molgpu:lines" });
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil((lines * 2) / WORKGROUP));
    pass.end();
    device.queue.submit([encoder.finish()]);
    count("gathers", "fieldLines:dispatch");
    fieldLinesTesting.last = { buffer: buffers.out, vertices, generation };
  }, [group, generation]);
  useResource(() => requestRepaint(), [group, generation]);

  const vertexSource = useMemo<StorageSource>(() => ({
    buffer: buffers.out,
    format: "vec4<f32>",
    length: vertices,
    size: [vertices],
    version: generation,
  }), [buffers.out, vertices, generation]);
  const positions = useShader(VERTEX_POSITIONS, [vertexSource]);
  const widthRef = useShaderRef(width);
  const widths = useShader(VERTEX_WIDTHS, [vertexSource, widthRef]);
  const rampModule = useMemo(
    () => (count("shaderBuilds", "fieldLines:ramp"),
      loadModuleWithCache(
        rampWgsl(colorRange ? [...stops].sort((a, b) => a[0] - b[0]) : null),
        "molgpu-field-lines",
        "auto",
      )),
    [colorRange ? stops : null, !!colorRange],
  );
  const rangeRef = useShaderRef(colorRange ?? [0, 1]);
  const tint = useMemo(
    () => [color[0], color[1], color[2], (color[3] ?? 1) * opacity],
    [color, opacity],
  );
  const tintRef = useShaderRef(tint);
  const colors = useShader(rampModule, [vertexSource, rangeRef, tintRef]);
  const segments = useMemo(() => lineSegments(lines, steps), [lines, steps]);
  if (!lines) return null;
  return viewer(withColumns(
    [{ key: "segments", data: segments, format: "i32" }],
    (map) =>
      use(LineLayer, {
        positions,
        segments: map.segments,
        colors,
        widths,
        count: vertices,
        join: "round",
        ...modeProps(mode, tint[3]),
      }),
  ));
};
