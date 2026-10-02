/**
 * WebGPU harness for <ElasticNetwork>. run-elastic.mjs builds it with vite
 * and drives it through `window.__elastic`.
 */
import { React, render, useState } from "@use-gpu/live";
import type { LiveElement } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
} from "@use-gpu/workbench";
import type { StructureData } from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import { type ElasticNetworkData, elasticNetworkData } from "@molgpu/dynamics";
import {
  ElasticNetwork,
  type ElasticNetworkStatus,
  Ribbon,
  Spacefill,
  Structure,
} from "@molgpu/viewer";
import { useCoordinates, useCoordinateSnapshot } from "@molgpu/viewer/advanced";
import {
  enableInstrumentation,
  snapshotCounters,
} from "../../src/internal/instrumentation.ts";
import { elasticTesting } from "../../src/elastic-network.ts";

void React;

enableInstrumentation();

interface State {
  mode: "none" | "spacefill" | "ribbon";
  id: string;
  version: number;
  step: number;
  seed: number;
  temperature: number;
  gamma: number;
  maxStepsPerFrame: number;
  color: [number, number, number, number];
}

interface Probe {
  mounted: boolean;
  errors: string[];
  failure: string | null;
  device: GPUDevice | null;
  status: ElasticNetworkStatus | null;
  /** `ready` of the first coordinates seen below the provider per network. */
  firstReady: boolean | null;
  coordinates: { buffer: GPUBuffer; count: number; generation: number } | null;
  snapshot: { positions: number[]; generation: number } | null;
  testing: typeof elasticTesting;
  counters: typeof snapshotCounters;
  update(patch: Partial<State>): void;
  load(id: string): Promise<{
    atoms: number;
    nodes: number;
    reference: number[];
    guideRows: number[];
  }>;
  /** Resolve once the provider reports `step` reached and not lagging. */
  reach(step: number): Promise<ElasticNetworkStatus>;
  readNodes(): Promise<number[]>;
  readCoordinates(): Promise<number[]>;
  /** Advance `every` steps `samples` times; per-node xyz sums and squares. */
  sample(every: number, samples: number): Promise<{
    sum: number[];
    sum2: number[];
  }>;
}

const probe: Probe = {
  mounted: false,
  errors: [],
  failure: null,
  device: null,
  status: null,
  firstReady: null,
  coordinates: null,
  snapshot: null,
  testing: elasticTesting,
  counters: snapshotCounters,
  update: () => {},
  load: () => Promise.reject(new Error("not mounted")),
  reach: () => Promise.reject(new Error("not mounted")),
  readNodes: () => Promise.resolve([]),
  readCoordinates: () => Promise.resolve([]),
  sample: () => Promise.reject(new Error("not mounted")),
};
(globalThis as unknown as { __elastic: Probe }).__elastic = probe;

const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (
  this: GPUAdapter,
  ...args: Parameters<typeof request>
) {
  const device = await request.apply(this, args);
  probe.device = device;
  device.addEventListener("uncapturederror", (event) => {
    probe.errors.push((event as GPUUncapturedErrorEvent).error.message);
  });
  return device;
};

async function readBuffer(buffer: GPUBuffer, bytes: number) {
  const device = probe.device!;
  const staging = device.createBuffer({ size: bytes, usage: 0x0008 | 0x0001 });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(0x0001);
  const values = Array.from(new Float32Array(staging.getMappedRange()));
  staging.unmap();
  staging.destroy();
  return values;
}

const structures = new Map<string, StructureData>();
const networks = new Map<string, ElasticNetworkData>();
const network = (id: string, version: number) => {
  const key = `${id}:${version}`;
  let data = networks.get(key);
  if (!data) {
    const s = structures.get(id)!;
    data = elasticNetworkData(s.positions, s.topology, { version });
    networks.set(key, data);
  }
  return data;
};

let waiters: (() => void)[] = [];
const onStatus = (status: ElasticNetworkStatus) => {
  probe.status = status;
  const pending = waiters;
  waiters = [];
  pending.forEach((wake) => wake());
};

const CoordinateProbe = (): null => {
  const coordinates = useCoordinates();
  if (coordinates) {
    if (probe.firstReady === null) probe.firstReady = coordinates.ready ?? true;
    probe.coordinates = {
      buffer: coordinates.source.buffer,
      count: coordinates.count,
      generation: coordinates.generation,
    };
  }
  return null;
};

const SnapshotProbe = (): null => {
  const snapshot = useCoordinateSnapshot({ maxHz: 30 });
  if (snapshot) {
    probe.snapshot = {
      positions: Array.from(snapshot.data.positions),
      generation: snapshot.generation,
    };
  }
  return null;
};

const Scene = ({ state }: { state: State }): LiveElement => {
  if (state.mode === "none" || !structures.has(state.id)) return null;
  const data = structures.get(state.id)!;
  return (
    <Structure data={data}>
      <ElasticNetwork
        network={network(state.id, state.version)}
        step={state.step}
        seed={state.seed}
        temperature={state.temperature}
        gamma={state.gamma}
        maxStepsPerFrame={state.maxStepsPerFrame}
        onStatus={onStatus}
      >
        <CoordinateProbe />
        {state.mode === "ribbon"
          ? (
            <>
              <Ribbon />
              <SnapshotProbe />
            </>
          )
          : <Spacefill color={state.color} />}
      </ElasticNetwork>
    </Structure>
  );
};

let current: State;

const App = (): LiveElement => {
  const [state, setState] = useState<State>({
    mode: "none",
    id: "1crn",
    version: 1,
    step: 0,
    seed: 7,
    temperature: 300,
    gamma: 1,
    maxStepsPerFrame: 20,
    color: [0.8, 0.8, 0.8, 1],
  });
  current = state;
  probe.update = (patch) => {
    if (
      patch.mode !== undefined || patch.version !== undefined ||
      patch.id !== undefined
    ) probe.firstReady = null;
    setState((previous) => ({ ...previous, ...patch }));
  };
  probe.mounted = true;
  return (
    <OrbitCamera radius={60} bearing={0.3} pitch={0.3} target={[10, 10, 10]}>
      <Pass lights>
        <AmbientLight color={[1, 1, 1]} intensity={0.6} />
        <DirectionalLight
          position={[0.3, 0.5, 1]}
          color={[1, 1, 1]}
          intensity={0.8}
        />
        <Scene state={state} />
      </Pass>
    </OrbitCamera>
  );
};

probe.load = async (id) => {
  const bytes = new Uint8Array(
    await (await fetch(`./${id}.bcif`)).arrayBuffer(),
  );
  const data = await structureFromBcif(bytes);
  structures.set(id, data);
  const net = network(id, 1);
  return {
    atoms: data.topology.atoms.count,
    nodes: net.system.springs.nodeCount,
    reference: Array.from(net.system.reference),
    guideRows: Array.from(net.guideRows),
  };
};

probe.reach = (step) =>
  new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      const s = probe.status;
      if (s && s.step === step && s.target === step && !s.lagging) {
        // One more animation frame so the displacement kernel dispatches.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(s)));
      } else if (performance.now() - started > 120_000) {
        reject(new Error(`step ${step} not reached: ${JSON.stringify(s)}`));
      } else waiters.push(check);
    };
    check();
  });

probe.readNodes = () => {
  const last = elasticTesting.last!;
  return readBuffer(last.state, last.nodeCount * 12);
};
probe.readCoordinates = () =>
  readBuffer(probe.coordinates!.buffer, probe.coordinates!.count * 12);

probe.sample = async (every, samples) => {
  const n = elasticTesting.last!.nodeCount;
  const sum = new Array(3 * n).fill(0), sum2 = new Array(3 * n).fill(0);
  let step = current.step;
  for (let s = 0; s < samples; s++) {
    step += every;
    probe.update({ step });
    await probe.reach(step);
    const x = await probe.readNodes();
    for (let i = 0; i < 3 * n; i++) {
      sum[i] += x[i];
      sum2[i] += x[i] * x[i];
    }
  }
  return { sum, sum2 };
};

const Root = (): LiveElement => (
  <WebGPU
    fallback={(failure: unknown) => {
      probe.errors.push(String(failure));
      return null;
    }}
  >
    <AutoCanvas selector="#root" samples={4} backgroundColor={[0, 0, 0, 1]}>
      <App />
    </AutoCanvas>
  </WebGPU>
);

globalThis.addEventListener("error", (event) => {
  probe.failure = String(event.error ?? event.message);
});
render(<Root />);
