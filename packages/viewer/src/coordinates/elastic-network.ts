// <ElasticNetwork>: Langevin dynamics of an elastic network as a coordinate
// provider. The application owns progress (a target `step`); this component
// owns the integrator state and publishes upstream + node displacement.
//
// Raw WebGPU for the integrator: use.gpu 0.20.0 Iterate can repeat an
// ordered compute sequence, but recording here ends the compute pass to copy
// checkpoint buffers between steps; restoring also copies before the pass.
// Iterate receives a compute-pass encoder and does not express those command-
// encoder copy boundaries. The integrator submits its own command buffer
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
import { checkElasticBindings, checkpointLayout } from "./elastic-bindings.ts";
import { CoordinateKernel } from "./coordinate-kernel.ts";
import {
  count,
  releaseOwnedBuffer,
  trackOwnedBuffer,
} from "../internal/instrumentation.ts";

import { TimelineContext } from "../timeline-context.ts";
import type {
  ElasticNetworkProps,
  ElasticNetworkStatus,
  ViewerComponent,
} from "../types.ts";

const SHADER = wgsl`${elasticDisplacementWgsl}`;
const STORAGE = 0x0080, COPY_DST = 0x0008, COPY_SRC = 0x0004;
const UNIFORM = 0x0040;

/** Test hooks: integrator work this module encoded and repaints it asked for. */
export const elasticTesting: {
  batches: number;
  steps: number;
  restores: number;
  repaints: number;
  last: { state: GPUBuffer; nodeCount: number } | null;
} = { batches: 0, steps: 0, restores: 0, repaints: 0, last: null };

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

/** One recorded integrator state (x, v, f) in a ring slot. */
interface Checkpoint {
  step: number;
  slot: number;
  perturbed: boolean;
}

interface Ring {
  buffer: GPUBuffer;
  every: number;
  slotBytes: number;
  slots: number;
  /** Retained checkpoints, oldest to newest. */
  list: Checkpoint[];
  free: number[];
}

function createRing(
  device: GPUDevice,
  nodeCount: number,
  record: NonNullable<ElasticNetworkProps["record"]>,
): Ring {
  const { slotBytes, slots } = checkpointLayout(nodeCount, record);
  checkElasticBindings({ checkpoints: slots * slotBytes }, {
    maxStorageBufferBindingSize: Infinity,
    maxBufferSize: device.limits.maxBufferSize,
  });
  const buffer = device.createBuffer({
    size: slots * slotBytes,
    usage: COPY_SRC | COPY_DST,
    label: "molgpu:elastic:checkpoints",
  });
  trackOwnedBuffer(buffer, "elastic:checkpoints");
  return {
    buffer,
    every: record.every,
    slotBytes,
    slots,
    list: [],
    free: Array.from({ length: slots }, (_, i) => slots - 1 - i),
  };
}

interface Run {
  gpu: Gpu | null;
  ring: Ring | null;
  seed: number;
  completed: number;
  epoch: number;
  forcesValid: boolean;
  paramsKey: string | null;
  perturbed: boolean;
  /** Integration since the last reset or restore departs from the
   * recorded history (a tug, or a parameter change). */
  dirty: boolean;
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
  record,
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
  const tugging = !!tug && tug.k > 0;
  const params = useMemo<LangevinParams>(
    () => langevinParams(network.system, { temperature, gamma, dt, seed, tug }),
    [network, temperature, gamma, dt, seed, tugKey],
  );
  const paramsKey = `${temperature}:${gamma}:${dt}:${tugKey}`;
  const gpu = useMemo(() => createGpu(device, network), [device, network]);
  useResource((dispose) => {
    dispose(() => {
      gpu.made.forEach(releaseOwnedBuffer);
      // The test hook must not keep a retired state buffer reachable.
      if (elasticTesting.last?.state === gpu.state) elasticTesting.last = null;
    });
  }, [gpu]);
  const ring = useMemo(
    () =>
      record
        ? createRing(device, network.system.springs.nodeCount, record)
        : null,
    [device, network, record?.every, record?.checkpoints, record?.maxBytes],
  );
  useResource((dispose) => {
    if (ring) dispose(() => releaseOwnedBuffer(ring.buffer));
  }, [ring]);

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
    ring: null,
    seed,
    completed: 0,
    epoch: 0,
    forcesValid: false,
    paramsKey: null,
    perturbed: false,
    dirty: false,
  });

  const progress = useMemo(() => {
    const r = run.current;
    const reset = () => {
      if (r.gpu === gpu) device.queue.writeBuffer(gpu.state, 0, gpu.initial);
      device.queue.writeBuffer(gpu.clock, 0, new Uint32Array(1));
      Object.assign(r, {
        gpu,
        seed,
        completed: 0,
        epoch: r.epoch + 1,
        forcesValid: false,
        perturbed: false,
        dirty: false,
      });
    };
    if (r.gpu !== gpu || r.seed !== seed) {
      reset();
      r.ring = null;
    }
    if (r.ring !== ring) {
      // A new ring (or none) starts empty; the run itself continues.
      r.ring = ring;
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
        r.dirty = true;
      }
      r.paramsKey = paramsKey;
      r.forcesValid = false;
    }

    // Seek: restore a checkpoint, replay from step 0, or clamp.
    let goal = target, evicted = false;
    let restore: Checkpoint | null = null;
    const newestAtOrBelow = (step: number) => {
      const list = ring?.list ?? [];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].step <= step) return list[i];
      }
      return null;
    };
    if (goal < r.completed || (ring && goal > r.completed)) {
      const c = newestAtOrBelow(goal);
      const oldest = ring?.list[0];
      if (goal < r.completed) {
        if (c) restore = c;
        else if (oldest?.perturbed) {
          // Before the retained range of a perturbed run: nothing replays it.
          goal = oldest.step;
          evicted = true;
          if (r.completed !== oldest.step || r.dirty) restore = oldest;
        } else reset();
      } else if (c && c.step > r.completed && !r.dirty && !tugging) {
        restore = c;
      }
    }

    const steps = Math.min(
      maxStepsPerFrame,
      goal - (restore?.step ?? r.completed),
    );
    if (restore || steps > 0 || !r.forcesValid) {
      const p = pipelines(device);
      const encoder = device.createCommandEncoder({ label: "molgpu:elastic" });
      if (restore) {
        encoder.copyBufferToBuffer(
          ring!.buffer,
          restore.slot * ring!.slotBytes,
          gpu.state,
          0,
          ring!.slotBytes,
        );
        device.queue.writeBuffer(gpu.clock, 0, Uint32Array.of(restore.step));
        Object.assign(r, {
          completed: restore.step,
          perturbed: restore.perturbed,
          dirty: false,
          forcesValid: true,
        });
        elasticTesting.restores++;
      }
      let pass = encoder.beginComputePass({ label: "molgpu:elastic" });
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
        r.completed++;
        if (tugging) {
          r.perturbed = true;
          r.dirty = true;
        }
        if (ring && r.completed % ring.every === 0) {
          const step = r.completed, list = ring.list;
          const at = list.findIndex((c) => c.step >= step);
          const existing = at >= 0 && list[at].step === step;
          // A departing run branches: later checkpoints belong to the old
          // history. An identical run keeps them.
          if (at >= 0 && (r.dirty || !existing)) {
            if (r.dirty) {
              for (const c of list.splice(at)) ring.free.push(c.slot);
            } else continue; // inside an evicted gap: keep order
          } else if (existing) continue;
          if (!ring.free.length) ring.free.push(list.shift()!.slot);
          const slot = ring.free.pop()!;
          pass.end();
          encoder.copyBufferToBuffer(
            gpu.state,
            0,
            ring.buffer,
            slot * ring.slotBytes,
            ring.slotBytes,
          );
          pass = encoder.beginComputePass({ label: "molgpu:elastic" });
          pass.setBindGroup(0, gpu.group);
          list.push({ step, slot, perturbed: r.perturbed });
        }
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
      r.forcesValid = true;
      if (steps > 0) {
        elasticTesting.batches++;
        elasticTesting.steps += steps;
      }
    }
    elasticTesting.last = {
      state: gpu.state,
      nodeCount: network.system.springs.nodeCount,
    };
    return {
      completed: r.completed,
      epoch: r.epoch,
      goal,
      perturbed: r.perturbed,
      evicted,
      firstStep: ring?.list[0]?.step ?? null,
      lastStep: ring?.list.at(-1)?.step ?? null,
    };
  }, [gpu, ring, target, seed, paramsKey, params, maxStepsPerFrame, wake]);

  const lagging = progress.completed < progress.goal;
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
      evicted: progress.evicted,
      firstStep: progress.firstStep,
      lastStep: progress.lastStep,
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
  return (use(Integrator, {
    ...props,
    target: Math.floor(requested),
    children: children,
  }));
};
