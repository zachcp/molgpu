// <ElasticNetwork>: Langevin dynamics of an elastic network as a coordinate
// provider. The application owns progress (a target `step`); this component
// owns the integrator state and publishes upstream + node displacement.
//
// Raw WebGPU, not a use.gpu Kernel, for the integrator: one rendered frame
// encodes up to `maxStepsPerFrame` steps of four dependent dispatches each,
// and Kernel dispatches once per version and cannot repeat a dispatch
// sequence k times in a frame. The integrator submits its own command buffer
// from render, as <EField> does, so it lands before the frame's compute pass
// where CoordinateKernel applies the displacement. Retirement follows the
// GPU retirement decision: the provider releases ownership of its buffers and
// never destroys them, because the published displacement kernel can still
// reference the state buffer from a retained dispatch.
import {
  type LC,
  type LiveElement,
  use,
  useContext,
  useMemo,
  useRef,
  useResource,
  useState,
} from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import { wgsl } from "@use-gpu/shader/wgsl";
import { LoopContext, useDeviceContext } from "@use-gpu/workbench";
import { type LangevinParams, langevinParams } from "@molgpu/dynamics";
import {
  elasticDisplacementWgsl,
  LANGEVIN_PARAMS_BYTES,
  langevinBuffers,
  langevinUniform,
  langevinWgsl,
} from "@molgpu/dynamics/wgsl";
import type { ElasticNetworkData } from "@molgpu/dynamics";
import { sample } from "@molgpu/timeline";
import { useCoordinates } from "./coordinates-context.ts";
import { checkElasticBindings } from "./internal/elastic-bindings.ts";
import { CoordinateKernel } from "./internal/coordinate-kernel.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "./internal/instrumentation.ts";
import { live, viewer } from "./internal/elements.ts";
import { TimelineContext } from "./timeline-context.ts";
import type {
  ElasticNetworkProps,
  ElasticNetworkStatus,
  ViewerComponent,
} from "./types.ts";

const SHADER = wgsl`${elasticDisplacementWgsl}`;
const STORAGE = 0x0080, COPY_DST = 0x0008, COPY_SRC = 0x0004;
const UNIFORM = 0x0040;

/** Test hooks: integrator work this module encoded and repaints it asked for. */
export const elasticTesting: {
  batches: number;
  steps: number;
  repaints: number;
  last: { state: GPUBuffer; nodeCount: number } | null;
} = { batches: 0, steps: 0, repaints: 0, last: null };

interface Pipelines {
  layout: GPUBindGroupLayout;
  bao: GPUComputePipeline;
  finish: GPUComputePipeline;
  drift: GPUComputePipeline;
  forces: GPUComputePipeline;
  forcesKick: GPUComputePipeline;
}
const pipelineCache = new WeakMap<GPUDevice, Pipelines>();

function pipelines(device: GPUDevice): Pipelines {
  let cached = pipelineCache.get(device);
  if (!cached) {
    const module = device.createShaderModule({
      code: langevinWgsl,
      label: "molgpu:elastic",
    });
    const entry = (
      binding: number,
      type: GPUBufferBindingType,
    ): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: 0x4, // COMPUTE
      buffer: { type },
    });
    const layout = device.createBindGroupLayout({
      label: "molgpu:elastic",
      entries: [
        entry(0, "uniform"),
        entry(1, "storage"),
        entry(2, "read-only-storage"),
        entry(3, "read-only-storage"),
        entry(4, "read-only-storage"),
        entry(5, "storage"),
        entry(6, "storage"),
      ],
    });
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [layout],
    });
    const make = (entryPoint: string) =>
      device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint },
        label: `molgpu:elastic:${entryPoint}`,
      });
    cached = {
      layout,
      bao: make("langevinBao"),
      finish: make("langevinFinish"),
      drift: make("langevinDrift"),
      forces: make("langevinForces"),
      forcesKick: make("langevinForcesKick"),
    };
    pipelineCache.set(device, cached);
  }
  return cached;
}

interface Gpu {
  uniform: GPUBuffer;
  state: GPUBuffer;
  clock: GPUBuffer;
  initial: Float32Array;
  group: GPUBindGroup;
  workgroups: number;
  sources: readonly StorageSource[];
  made: GPUBuffer[];
}

function createGpu(device: GPUDevice, network: ElasticNetworkData): Gpu {
  const packed = langevinBuffers(network.system);
  checkElasticBindings({
    state: packed.state.byteLength,
    nodes: packed.nodes.byteLength,
    neighbours: packed.csr.byteLength,
    "rest lengths": packed.restLength.byteLength,
    "atom map": network.atomToNode.byteLength,
  }, device.limits);
  const made: GPUBuffer[] = [];
  const buffer = (
    label: string,
    usage: number,
    data: ArrayBufferView | null,
    bytes = data?.byteLength ?? 0,
  ) => {
    const b = device.createBuffer({
      size: Math.max(16, Math.ceil(bytes / 4) * 4),
      usage: usage | COPY_DST,
      label: `molgpu:elastic:${label}`,
    });
    if (data && data.byteLength) {
      device.queue.writeBuffer(b, 0, data as BufferSource);
      count("uploadBytes", `elastic:${label}`, data.byteLength);
    }
    trackOwnedBuffer(b, `elastic:${label}`);
    made.push(b);
    return b;
  };
  const uniform = buffer("params", UNIFORM, null, LANGEVIN_PARAMS_BYTES);
  const state = buffer("state", STORAGE | COPY_SRC, packed.state);
  const nodes = buffer("nodes", STORAGE, packed.nodes);
  const csr = buffer("csr", STORAGE, packed.csr);
  const rest = buffer("rest", STORAGE, packed.restLength);
  const scratch = buffer("scratch", STORAGE, null, 4 * packed.scratchFloats);
  const clock = buffer("clock", STORAGE | COPY_SRC, new Uint32Array(1));
  const map = buffer("map", STORAGE, network.atomToNode);
  const reference = buffer("reference", STORAGE, network.system.reference);
  const group = device.createBindGroup({
    label: "molgpu:elastic",
    layout: pipelines(device).layout,
    entries: [uniform, state, nodes, csr, rest, scratch, clock].map((
      b,
      binding,
    ) => ({ binding, resource: { buffer: b } })),
  });
  const source = (
    b: GPUBuffer,
    format: "f32" | "u32",
    length: number,
  ): StorageSource =>
    Object.freeze({
      buffer: b,
      format,
      length,
      size: [length],
      version: network.version,
    }) as StorageSource;
  return {
    uniform,
    state,
    clock,
    initial: packed.state,
    group,
    workgroups: packed.workgroups,
    sources: [
      source(map, "u32", network.atomToNode.length),
      source(state, "f32", packed.state.length),
      source(reference, "f32", network.system.reference.length),
    ],
    made,
  };
}

interface Run {
  gpu: Gpu | null;
  seed: number;
  completed: number;
  epoch: number;
  forcesValid: boolean;
  paramsKey: string | null;
  perturbed: boolean;
}

const Integrator: LC<
  Omit<ElasticNetworkProps, "step" | "children"> & {
    target: number;
    children: LiveElement;
  }
> = ({
  network,
  target,
  seed = 0,
  temperature = 300,
  gamma = 1,
  dt = 0.02,
  maxStepsPerFrame = 20,
  tug,
  onStatus,
  children,
}) => {
  const upstream = useCoordinates();
  const device = useDeviceContext();
  const requestRepaint = useContext(LoopContext);
  if (!Number.isSafeInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
    throw new TypeError("maxStepsPerFrame must be a positive integer");
  }
  if (upstream && network.atomToNode.length !== upstream.count) {
    throw new TypeError(
      "<ElasticNetwork> network was built for a different atom count",
    );
  }
  const tugKey = tug ? `${tug.node}:${tug.k}:${tug.target.join(",")}` : "none";
  const params = useMemo<LangevinParams>(
    () => langevinParams(network.system, { temperature, gamma, dt, seed, tug }),
    [network, temperature, gamma, dt, seed, tugKey],
  );
  const paramsKey = `${temperature}:${gamma}:${dt}:${tugKey}`;
  const gpu = useMemo(() => createGpu(device, network), [device, network]);
  useResource((dispose) => {
    dispose(() => gpu.made.forEach(releaseOwnedBuffer));
  }, [gpu]);

  const alive = useRef(true);
  useResource((dispose) => {
    alive.current = true;
    dispose(() => {
      alive.current = false;
    });
  }, []);
  const [wake, setWake] = useState(0);
  const run = useRef<Run>({
    gpu: null,
    seed,
    completed: 0,
    epoch: 0,
    forcesValid: false,
    paramsKey: null,
    perturbed: false,
  });

  const progress = useMemo(() => {
    const r = run.current;
    if (r.gpu !== gpu || r.seed !== seed || target < r.completed) {
      if (r.gpu === gpu) device.queue.writeBuffer(gpu.state, 0, gpu.initial);
      device.queue.writeBuffer(gpu.clock, 0, new Uint32Array(1));
      Object.assign(r, {
        gpu,
        seed,
        completed: 0,
        epoch: r.epoch + 1,
        forcesValid: false,
        perturbed: false,
      });
    }
    if (r.paramsKey !== paramsKey || !r.forcesValid) {
      device.queue.writeBuffer(
        gpu.uniform,
        0,
        langevinUniform(network.system, params),
      );
      if (
        r.paramsKey !== null && r.paramsKey !== paramsKey && r.completed > 0
      ) {
        r.perturbed = true;
      }
      r.paramsKey = paramsKey;
      r.forcesValid = false;
    }
    const steps = Math.min(maxStepsPerFrame, target - r.completed);
    if (steps > 0 || !r.forcesValid) {
      const p = pipelines(device);
      const encoder = device.createCommandEncoder({ label: "molgpu:elastic" });
      const pass = encoder.beginComputePass({ label: "molgpu:elastic" });
      pass.setBindGroup(0, gpu.group);
      const nodes = (pipeline: GPUComputePipeline) => {
        pass.setPipeline(pipeline);
        pass.dispatchWorkgroups(gpu.workgroups);
      };
      if (!r.forcesValid) nodes(p.forces);
      for (let s = 0; s < steps; s++) {
        nodes(p.bao);
        pass.setPipeline(p.finish);
        pass.dispatchWorkgroups(1);
        nodes(p.drift);
        nodes(p.forcesKick);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
      r.forcesValid = true;
      if (steps > 0) {
        r.completed += steps;
        if (tug && tug.k > 0) r.perturbed = true;
        elasticTesting.batches++;
        elasticTesting.steps += steps;
      }
    }
    elasticTesting.last = {
      state: gpu.state,
      nodeCount: network.system.springs.nodeCount,
    };
    return { completed: r.completed, epoch: r.epoch, perturbed: r.perturbed };
  }, [gpu, target, seed, paramsKey, params, maxStepsPerFrame, wake]);

  const lagging = progress.completed < target;
  // Catch up one batch per animation frame while behind; idle otherwise.
  useResource((dispose) => {
    if (!lagging) return;
    const id = requestAnimationFrame(() => {
      if (alive.current) setWake((w) => w + 1);
    });
    dispose(() => cancelAnimationFrame(id));
  }, [progress]);
  useResource(() => {
    if (progress.completed === 0 && progress.epoch === 1) return;
    elasticTesting.repaints++;
    requestRepaint();
  }, [progress.completed, progress.epoch]);

  const report = useRef<ElasticNetworkProps["onStatus"]>(onStatus);
  report.current = onStatus;
  useResource(() => {
    const status: ElasticNetworkStatus = Object.freeze({
      step: progress.completed,
      target,
      lagging,
      perturbed: progress.perturbed,
    });
    report.current?.(status);
  }, [progress, target]);

  if (!upstream) return children;
  return use(CoordinateKernel, {
    upstream,
    shader: SHADER,
    sources: gpu.sources,
    parameterKey: `${network.version}:${progress.epoch}:${progress.completed}`,
    children,
  });
};

/**
 * Langevin dynamics of an elastic network. Integrates toward the target
 * `step` at up to `maxStepsPerFrame` steps per frame and re-provides upstream
 * coordinates plus each guide node's displacement to its residue's atoms.
 */
export const ElasticNetwork: ViewerComponent<ElasticNetworkProps> = (
  { step, children, ...props },
) => {
  const time = useContext(TimelineContext);
  let requested: number;
  if (typeof step === "number") requested = step;
  else {
    if (time === null) {
      throw new Error(
        "<ElasticNetwork> step is a curve, which needs a <TimelineProvider> ancestor",
      );
    }
    requested = sample(step, time);
  }
  if (!Number.isFinite(requested) || requested < 0) {
    throw new TypeError("<ElasticNetwork> step must be finite and nonnegative");
  }
  return viewer(
    use(Integrator, {
      ...props,
      target: Math.floor(requested),
      children: live(children),
    }),
  );
};
