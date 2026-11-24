import { useDispatchObservation } from "../../internal/dispatch-observation.ts";
// <FieldLines>: RK4 streamlines of E = −∇φ through the nearest volume,
// integrated by a use.gpu Kernel once per volume generation and drawn with
// LineLayer. See docs/findings/2026-09-27-efield-plan.md §5.
import { modeProps, tint } from "../../rendering/opacity.ts";
import {
  type LC,
  use,
  useContext,
  useMemo,
  useRef,
  useResource,
  useState,
} from "@use-gpu/live";
import type { StorageSource, StorageTarget } from "@use-gpu/core";
import {
  Compute,
  ComputeBuffer,
  Kernel,
  LineLayer,
  useDeviceContext,
  useShader,
  useShaderRef,
} from "@use-gpu/workbench";
import { LoopContext } from "@use-gpu/frame";
import { loadModuleWithCache } from "@use-gpu/shader/wgsl";
import {
  FIELD_LINES_WORKGROUP as WORKGROUP,
  fieldLinesWgsl,
  latticeSeeds,
} from "./field-line-geometry.ts";
import type { ColorStops, Translucency, ViewerComponent } from "../../types.ts";
import type { VolumeGrid } from "@molgpu/table";
import { useVolume } from "../volume-context.ts";
import {
  gridBox,
  useBoundedPositions,
  useOitBounds,
} from "../../rendering/draw-mode.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "../../internal/instrumentation.ts";
import { useRepaint } from "../../internal/use-repaint.ts";
import { useBindingProbe } from "../../internal/use-binding-probe.ts";

import {
  type FieldLinesProps,
  normalizeFieldLinesOptions,
} from "./field-lines-options.ts";
import {
  rampWgsl,
  VERTEX_POSITIONS,
  VERTEX_WIDTHS,
} from "./field-lines-shaders.ts";
import { COPY_DST, STORAGE } from "../../internal/gpu-job.ts";

/** One 1D dispatch: 65 535 workgroups of the integrator's width. */
const MAX_INVOCATIONS = 65535 * WORKGROUP;

/** Test hook, not public API: the last integrated vertex buffer. */
export const fieldLinesTesting: {
  last: { buffer: GPUBuffer; vertices: number; generation: number } | null;
} = { last: null };

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
export const FieldLines: ViewerComponent<FieldLinesProps> = (props) => {
  const {
    seeds,
    maxLines,
    step,
    steps,
    minField,
    maxPotential,
    color,
    colorRange,
    stops,
    width,
    opacity,
    mode,
  } = normalizeFieldLinesOptions(props);
  useRepaint();
  useBindingProbe("fieldLines", color, opacity, width, colorRange);
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

  if (lines * 2 > MAX_INVOCATIONS) {
    throw new RangeError(
      `FieldLines: ${lines} lines exceed one dispatch; lower maxLines`,
    );
  }

  // The integrator runs as a use.gpu Kernel on the vertex target: linked
  // inputs, an immediate compute pass, and one dispatch per version.
  const integrator = useMemo(() => {
    count("shaderBuilds", "fieldLines:integrator");
    return loadModuleWithCache(
      fieldLinesWgsl(grid),
      "molgpu-field-lines",
      "auto",
    );
  }, [grid]);
  const seedSource = useMemo<StorageSource>(() => {
    const buffer = device.createBuffer({
      size: Math.max(16, Math.ceil(points.byteLength / 16) * 16),
      usage: STORAGE | COPY_DST,
      label: "molgpu:lines:seeds",
    });
    if (points.byteLength) {
      device.queue.writeBuffer(buffer, 0, points);
      count("uploadBytes", "lines:seeds", points.byteLength);
    }
    return {
      buffer,
      format: "f32",
      length: points.length,
      size: [points.length],
      version: 1,
    };
  }, [device, points]);
  useResource((dispose) => {
    // A retained LineLayer can keep submitting while its replacement shader
    // compiles. Release ownership and let WebGPU reclaim each allocation
    // once its last binding is unreachable.
    trackOwnedBuffer(seedSource.buffer, "lines:seeds");
    dispose(() => releaseOwnedBuffer(seedSource.buffer));
  }, [seedSource]);
  const params = useMemo(() => [lines, steps, step, minField], [
    lines,
    steps,
    step,
    minField,
  ]);
  const inputs = useMemo(() => [source, seedSource], [source, seedSource]);
  const next = useRef(0);
  // Integrate once per volume generation and per geometry change.
  const version = useMemo(() => ++next.current, [
    source,
    generation,
    integrator,
    seedSource,
    params,
    potentialCap,
  ]);
  const [dispatched, setDispatched] = useState(-1);
  const observe = useDispatchObservation(version, setDispatched);
  useResource(() => {
    if (dispatched >= 0) requestRepaint();
  }, [dispatched]);
  const integrate = (target: StorageTarget) =>
    use(Compute, {
      immediate: true,
      children: observe(
        use(Kernel, {
          shader: integrator,
          sources: inputs,
          args: [params, potentialCap],
          initial: true,
          version,
          size: [lines * 2, 1],
        }),
        () => {
          count("gathers", "fieldLines:dispatch");
          fieldLinesTesting.last = {
            buffer: target.buffer,
            vertices,
            generation,
          };
        },
      ),
    });

  if (!lines) return null;
  return (use(ComputeBuffer, {
    width: vertices,
    height: 1,
    format: "vec4<f32>",
    label: "molgpu:lines:vertices",
    children: integrate,
    then: (target: StorageTarget) =>
      dispatched < 0 ? null : use(LinesDraw, {
        target,
        vertices,
        version: dispatched,
        steps,
        step,
        grid,
        width,
        colorRange,
        stops,
        tint: tint(color, opacity),
        mode,
      }),
  }));
};

const LinesDraw: LC<{
  target: StorageTarget;
  vertices: number;
  version: number;
  steps: number;
  step: number;
  grid: VolumeGrid;
  width: number;
  colorRange?: readonly [number, number];
  stops: ColorStops;
  tint: number[];
  mode: Translucency["mode"];
}> = (
  {
    target,
    vertices,
    version,
    steps,
    step,
    grid,
    width,
    colorRange,
    stops,
    tint: tintValue,
    mode,
  },
) => {
  useResource((dispose) => {
    trackOwnedBuffer(target.buffer, "lines:vertices");
    dispose(() => releaseOwnedBuffer(target.buffer));
  }, [target.buffer]);
  const vertexSource = useMemo<StorageSource>(() => ({
    buffer: target.buffer,
    format: "vec4<f32>",
    length: vertices,
    size: [vertices],
    version,
  }), [target.buffer, vertices, version]);
  const drawMode = modeProps(mode, tintValue[3]);
  const box = useMemo(() => gridBox(grid.dims, grid.transform), [grid]);
  // Integration stops at the grid edge, within one step.
  const positions = useBoundedPositions(
    useShader(VERTEX_POSITIONS, [vertexSource]),
    useOitBounds(drawMode, box, step),
  );
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
  const tint = useMemo(() => tintValue, tintValue);
  const tintRef = useShaderRef(tint);
  const colors = useShader(rampModule, [vertexSource, rangeRef, tintRef]);
  return use(LineLayer, {
    positions,
    // Each line is one strip of 2·steps + 1 vertices.
    segment: 2 * steps,
    colors,
    widths,
    count: vertices,
    join: "round",
    ...drawMode,
  });
};
