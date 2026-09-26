/**
 * WebGPU harness for <Trajectory> and <UnitCell>. `deno task test:components`
 * builds it with vite and drives every mode from run-trajectory.mjs through
 * `window.__trajectory`.
 */
import { React, render, useState } from "@use-gpu/live";
import type { LiveElement } from "@use-gpu/live";
import type { StorageSource } from "@use-gpu/core";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
} from "@use-gpu/workbench";
import {
  createStructure,
  createTrajectory,
  type StructureData,
  type TrajectoryData,
  type TrajectoryFrame,
} from "@molgpu/table";
import { frameCurve } from "@molgpu/timeline";
import {
  Spacefill,
  Structure,
  TimelineProvider,
  Trajectory,
  type TrajectoryFrameState,
  UnitCell,
  useCoordinateSnapshot,
  useTrajectoryFrame,
} from "@molgpu/viewer";
import { useCoordinates } from "@molgpu/viewer/advanced";
import {
  enableInstrumentation,
  instrumentDevice,
  snapshotCounters,
} from "../../src/internal/instrumentation.ts";

enableInstrumentation();

const ATOMS = 3;
function atoms(n: number): StructureData {
  const positions = Float32Array.from(
    { length: n * 3 },
    (_, i) => i % 3 === 0 ? (i / 3) * 4 - 4 : 0,
  );
  return createStructure({
    positions,
    topology: {
      atoms: {
        count: n,
        id: Array.from({ length: n }, (_, i) => String(i + 1)),
        name: Array.from({ length: n }, (_, i) => `C${i + 1}`),
        altloc: new Array(n).fill(""),
        residue: new Uint32Array(n),
        element: new Uint8Array(n).fill(6),
        occupancy: new Float32Array(n).fill(1),
        bfactor: new Float32Array(n),
        radius: new Float32Array(n).fill(1.2),
      },
      residues: {
        count: 1,
        chain: new Uint32Array(1),
        labelSeq: new Int32Array([1]),
        authSeq: ["1"],
        insertionCode: [""],
        comp: ["GLY"],
        polymer: ["other"],
      },
      chains: {
        count: 1,
        model: new Int32Array([1]),
        labelId: ["A"],
        authId: ["A"],
      },
      bonds: {
        count: 0,
        a: new Uint32Array(),
        b: new Uint32Array(),
        order: new Uint8Array(),
        source: [],
      },
      instances: {
        count: 1,
        chain: new Uint32Array(1),
        operatorId: ["identity"],
        transform: Float64Array.from([
          ...[1, 0, 0, 0],
          ...[0, 1, 0, 0],
          ...[0, 0, 1, 0],
          ...[0, 0, 0, 1],
        ]),
      },
    },
  });
}
const STRUCTURE = atoms(ATOMS);

/** Frame k: atom i at (4i - 4 + k, k + 1, -k); exact in f32, and no frame
 * equals the structure's own positions (y = 0). */
const syntheticFrame = (k: number, n = ATOMS): Float32Array =>
  Float32Array.from({ length: n * 3 }, (_, j) => {
    const i = Math.floor(j / 3);
    return [4 * i - 4 + k, k + 1, -k][j % 3];
  });
const FRAMES: TrajectoryFrame[] = [0, 1, 2, 3].map((k) => ({
  positions: syntheticFrame(k),
}));
const WHOLE = createTrajectory({ atomCount: ATOMS, frames: FRAMES });
// Two trajectory atoms move topology rows 2 and 0; row 1 keeps upstream.
const SUBSET = createTrajectory({
  atomCount: 2,
  frames: [0, 1, 2, 3].map((k) => ({ positions: syntheticFrame(k, 2) })),
  atomMap: [2, 0],
});
// Atom 0 crosses x = 10 between frames 0 and 1 in a 10 Å box that grows.
const BOXED = createTrajectory({
  atomCount: ATOMS,
  frames: [0, 1].map((k) => ({
    positions: Float32Array.of(9.5 - 9 * k, 1, 1, 2, 2, 2, 3, 3, 3),
    box: Float32Array.of(10 + 2 * k, 0, 0, 0, 10, 0, 0, 0, 10),
  })),
});
// A source that answers after `delay` ms, for streaming states.
const slow = (delay: number): TrajectoryData =>
  createTrajectory({
    atomCount: ATOMS,
    frameCount: 4,
    source: {
      read: (i) =>
        new Promise((resolve) => setTimeout(() => resolve(FRAMES[i]), delay)),
    },
  });
const SLOW = slow(300);
const byLatency = new Map<number, TrajectoryData>();
const latency = (ms: number): TrajectoryData => {
  let trajectory = byLatency.get(ms);
  if (!trajectory) byLatency.set(ms, trajectory = slow(ms));
  return trajectory;
};

type Mode =
  | "none"
  | "whole"
  | "subset"
  | "boxed"
  | "timeline"
  | "cell"
  | "slow"
  | "snapshot"
  | "src";
interface State {
  mode: Mode;
  frame: number;
  interpolate: "linear" | "nearest";
  pbc: "none" | "minimum-image";
  time: number;
  src: string;
  latency: number;
}

interface Probe {
  mounted: boolean;
  device: GPUDevice | null;
  source: StorageSource | null;
  state: TrajectoryFrameState | null;
  snapshot: { generation: number; positions: number[] } | null;
  generation: number | null;
  errors: string[];
  frames: number[][];
  root: number[];
  counters: typeof snapshotCounters;
  update(patch: Partial<State>): void;
}
const probe: Probe = {
  mounted: false,
  device: null,
  source: null,
  state: null,
  snapshot: null,
  generation: null,
  errors: [],
  frames: FRAMES.map((f) => Array.from(f.positions)),
  root: Array.from(STRUCTURE.positions),
  counters: snapshotCounters,
  update: () => {},
};
(globalThis as unknown as { __trajectory: Probe }).__trajectory = probe;

const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (
  this: GPUAdapter,
  ...args: Parameters<typeof request>
) {
  const device = instrumentDevice(await request.apply(this, args));
  probe.device = device;
  device.addEventListener("uncapturederror", (event) => {
    probe.errors.push((event as GPUUncapturedErrorEvent).error.message);
  });
  return device;
};

/** A snapshot consumer, like <Ribbon>: records the latest CPU snapshot. */
const SnapshotProbe = (): null => {
  const snapshot = useCoordinateSnapshot();
  probe.snapshot = snapshot
    ? {
      generation: snapshot.generation,
      positions: Array.from(snapshot.data.positions),
    }
    : null;
  probe.generation = useCoordinates()?.generation ?? null;
  return null;
};

const Probe = (): null => {
  probe.source = useCoordinates()?.source ?? null;
  probe.state = useTrajectoryFrame();
  return null;
};

const played = (
  state: State,
  trajectory: TrajectoryData,
  extra?: LiveElement,
) => (
  <Structure data={STRUCTURE}>
    <Trajectory
      data={trajectory}
      frame={state.frame}
      interpolate={state.interpolate}
      pbc={state.pbc}
    >
      <Spacefill color={[1, 0.2, 0.2, 1]} />
      <Probe />
      {extra ?? null}
    </Trajectory>
  </Structure>
);

const Scene = ({ state }: { state: State }): LiveElement => {
  switch (state.mode) {
    case "none":
      return null;
    case "whole":
      return played(state, WHOLE);
    case "subset":
      return played(state, SUBSET);
    case "boxed":
      return played(state, BOXED);
    case "slow":
      return played(state, SLOW);
    case "snapshot":
      return played(state, latency(state.latency), <SnapshotProbe />);
    case "timeline":
      return (
        <TimelineProvider time={state.time}>
          <Structure data={STRUCTURE}>
            <Trajectory data={WHOLE} frame={frameCurve({ frames: 4, fps: 1 })}>
              <Spacefill />
              <Probe />
            </Trajectory>
          </Structure>
        </TimelineProvider>
      );
    case "cell":
      // Only the box: the canvas shows lines and nothing else.
      return (
        <Structure data={STRUCTURE}>
          <Trajectory data={BOXED} frame={state.frame}>
            <UnitCell color={[0.2, 1, 0.2, 1]} width={3} />
            <Probe />
          </Trajectory>
        </Structure>
      );
    case "src":
      return (
        <Structure data={STRUCTURE}>
          <Trajectory src={state.src} frame={state.frame}>
            <Spacefill />
            <Probe />
          </Trajectory>
        </Structure>
      );
  }
};

const App = (): LiveElement => {
  const [state, setState] = useState<State>({
    mode: "none",
    frame: 0,
    interpolate: "linear",
    pbc: "none",
    time: 0,
    src: "",
    latency: 0,
  });
  probe.update = (patch) => setState((previous) => ({ ...previous, ...patch }));
  probe.mounted = true;
  return (
    <OrbitCamera radius={40} bearing={0} pitch={0} target={[4, 4, 0]}>
      <Pass lights={true}>
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

render(
  <WebGPU
    fallback={(failure: unknown) => {
      probe.errors.push(String(failure));
      return null;
    }}
  >
    <AutoCanvas selector="#root" samples={4} backgroundColor={[0, 0, 0, 1]}>
      <App />
    </AutoCanvas>
  </WebGPU>,
);
