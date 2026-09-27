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
import { createCurve, frameCurve } from "@molgpu/timeline";
import { where } from "@molgpu/select";
import {
  NormalMode,
  Spacefill,
  Structure,
  Superpose,
  type SuperposeStatus,
  TimelineProvider,
  Trajectory,
  type TrajectoryFrameState,
  Transform,
  UnitCell,
  Unwrap,
  type UnwrapStatus,
  useCoordinateSnapshot,
  useTrajectoryFrame,
} from "@molgpu/viewer";
import { useCoordinates, WobbleCoordinates } from "@molgpu/viewer/advanced";
import {
  enableInstrumentation,
  instrumentDevice,
  snapshotCounters,
} from "../../src/internal/instrumentation.ts";

enableInstrumentation();

const ATOMS = 3;
function atoms(
  n: number,
  positions = Float32Array.from(
    { length: n * 3 },
    (_, i) => i % 3 === 0 ? (i / 3) * 4 - 4 : 0,
  ),
  bonds: [number, number][] = [],
): StructureData {
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
        count: bonds.length,
        a: Uint32Array.from(bonds, (bond) => bond[0]),
        b: Uint32Array.from(bonds, (bond) => bond[1]),
        order: new Uint8Array(bonds.length).fill(1),
        source: bonds.map(() => "explicit" as const),
        // Covalent: the only bonds the unwrap forest follows.
        flags: new Uint8Array(bonds.length).fill(1),
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
const SKEW_BOX = Float32Array.of(10, 0, 0, 9, 1, 0, 0, 0, 10);
const SKEW = createTrajectory({
  atomCount: ATOMS,
  frames: [
    { positions: Float32Array.of(0, 0, 0, 2, 2, 2, 3, 3, 3), box: SKEW_BOX },
    {
      positions: Float32Array.of(9.31, 0.49, 0, 2, 2, 2, 3, 3, 3),
      box: SKEW_BOX,
    },
  ],
});
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const SHIFT = [...IDENTITY.slice(0, 12), 2, 0, 0, 1];
const MATRIX_CURVE = createCurve([
  { time: 0, value: IDENTITY },
  { time: 1, value: SHIFT },
]);
const SELECT_ROWS = [0, 1, 2].map((wanted) =>
  where("atom", `row=${wanted}`, (_data, row) => row === wanted)
);
const MODE_MAP = Uint32Array.of(0, 0, 1);
const MODES = [
  {
    atomToNode: MODE_MAP,
    vectors: Float32Array.of(1, 0, 0, 0, 2, 0),
    version: 1,
  },
  {
    atomToNode: MODE_MAP,
    vectors: Float32Array.of(0, 0, 3, 0, -1, 0),
    version: 2,
  },
];
// Superpose: 12 non-planar atoms. Frame 0 (the reference) sits ~1000 Å from
// the origin; frame 1 is a small rigid motion with 0.05 Å noise; frame 2 a
// large rotation with 0.3 Å noise; frame 3 the mirror image (the fit stays a
// proper rotation); frame 4 is collinear and passes through.
const SUP_BASE = [
  [0, 0, 0],
  [1.5, 0, 0],
  [2.2, 1.3, 0],
  [3.6, 1.4, 0.6],
  [4.1, 2.8, 1.1],
  [5.5, 3.0, 0.4],
  [6.0, 4.2, 1.5],
  [7.4, 4.5, 1.0],
  [1.0, -1.2, 0.9],
  [2.5, -0.8, 2.0],
  [3.9, 0.2, -1.1],
  [5.0, -1.6, 0.3],
];
const SUP_ATOMS = SUP_BASE.length;
function rotate(axis: number[], angle: number, p: number[]): number[] {
  const n = Math.hypot(...axis), [x, y, z] = axis.map((v) => v / n);
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    (t * x * x + c) * p[0] + (t * x * y - s * z) * p[1] +
    (t * x * z + s * y) * p[2],
    (t * x * y + s * z) * p[0] + (t * y * y + c) * p[1] +
    (t * y * z - s * x) * p[2],
    (t * x * z - s * y) * p[0] + (t * y * z + s * x) * p[1] +
    (t * z * z + c) * p[2],
  ];
}
const noise = (i: number, scale: number) =>
  [1, 2, 3].map((k) => scale * Math.sin(12.9898 * (i + 1) * k));
const packed = (points: number[][], offset: number[]) =>
  Float32Array.from(points.flatMap((p) => p.map((v, a) => v + offset[a])));
const SUP_FRAMES: Float32Array[] = [
  packed(SUP_BASE, [1000, -500, 250]),
  packed(
    SUP_BASE.map((p, i) =>
      rotate([1, 2, 0.5], 0.7, p.map((v, a) => v + noise(i, 0.05)[a]))
    ),
    [1003, -498, 251],
  ),
  packed(
    SUP_BASE.map((p, i) =>
      rotate([-0.3, 1, 2], 2.5, p.map((v, a) => v + noise(i, 0.3)[a]))
    ),
    [997, -505, 249],
  ),
  packed(SUP_BASE.map(([x, y, z]) => [-x, y, z]), [1000, -500, 250]),
  packed(SUP_BASE.map((_, i) => [i, 2 * i, 3 * i]), [1000, -500, 250]),
];
const SUP_STRUCTURE = atoms(SUP_ATOMS, packed(SUP_BASE, [0, 0, 0]));
const SUP_TRAJECTORY = createTrajectory({
  atomCount: SUP_ATOMS,
  frames: SUP_FRAMES.map((positions) => ({ positions })),
});
const SUP_FIXED = packed(
  SUP_BASE.map((p) => rotate([0.2, -1, 0.4], 1.1, p)),
  [-20, 40, 7],
);
const SUP_FIT = where("atom", "row<6", (_data, row) => row < 6);
// Unwrap: a skew triclinic cell holding a 14-atom zig-zag chain that spans
// several box lengths (depth 13: four pointer-jumping rounds), a six-ring, a
// diatomic and a lone atom. Frames wrap every atom into the primary cell; the
// box changes between frames 0 and 1. Frame 2 displaces one ring atom so its
// ring closure is ambiguous.
const UNW_WHOLE: number[][] = [
  ...Array.from(
    { length: 14 },
    (_, i) => [0.5 + 1.2 * i, 1 + 0.7 * (i % 2), 3],
  ),
  ...Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i;
    return [4.6 + 1.4 * Math.cos(angle), 2.2 + 1.4 * Math.sin(angle), 1.2];
  }),
  [4.7, 4.6, 5.5],
  [5.6, 5.3, 5.9],
  [2, 2.5, 2],
];
const UNW_BONDS: [number, number][] = [
  ...Array.from({ length: 13 }, (_, i): [number, number] => [i, i + 1]),
  ...Array.from({ length: 6 }, (_, i): [number, number] => [
    14 + i,
    14 + (i + 1) % 6,
  ]),
  [20, 21],
];
const UNW_BOXES = [
  [5, 0, 0, 2, 5, 0, 1, 1, 6],
  [5.3, 0, 0, 2, 5.2, 0, 1, 1, 6.1],
  [5, 0, 0, 2, 5, 0, 1, 1, 6],
];
function wrap(points: number[][], box: number[]): Float32Array {
  const [a, d, g, b, e, h, c, f, i] = box;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inverse = [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
  return Float32Array.from(points.flatMap((p) => {
    const cell = [0, 1, 2].map((r) =>
      Math.floor(
        inverse[3 * r] * p[0] + inverse[3 * r + 1] * p[1] +
          inverse[3 * r + 2] * p[2],
      )
    );
    return [0, 1, 2].map((r) =>
      p[r] - (box[r] * cell[0] + box[3 + r] * cell[1] + box[6 + r] * cell[2])
    );
  }));
}
const UNW_FRAMES = [
  wrap(UNW_WHOLE, UNW_BOXES[0]),
  wrap(
    UNW_WHOLE.map((p) => [p[0] + 3.1, p[1] - 2.7, p[2] + 1.9]),
    UNW_BOXES[1],
  ),
  wrap(
    UNW_WHOLE.map((p, i) => i === 17 ? [p[0] + 2, p[1] + 1.5, p[2]] : p),
    UNW_BOXES[2],
  ),
];
const UNW_STRUCTURE = atoms(
  UNW_WHOLE.length,
  Float32Array.from(UNW_WHOLE.flat()),
  UNW_BONDS,
);
const UNW_TRAJECTORY = createTrajectory({
  atomCount: UNW_WHOLE.length,
  frames: UNW_FRAMES.map((positions, k) => ({
    positions,
    box: Float32Array.from(UNW_BOXES[k]),
  })),
});
const UNW_RING = where("atom", "ring", (_data, row) => row >= 14 && row < 20);
const SINGULAR = [1, 0, 0, 2, 0, 0, 0, 0, 1];
const LIMIT_BOX = [10, 0, 0, 9.99, 0.01, 0, 0, 0, 10];
const LIMIT_STRUCTURE = atoms(
  2,
  Float32Array.of(0, 0, 0, 5, 0, 0),
  [[0, 1]],
);
const DEEP_STRUCTURE = atoms(
  34,
  Float32Array.from(
    { length: 34 * 3 },
    (_, j) => j % 3 === 0 ? (Math.floor(j / 3) * 1.5) % 10 : 0,
  ),
  Array.from({ length: 33 }, (_, i) => [i, i + 1] as [number, number]),
);
// First-dispatch race (molgpu-sept-usx): the same inputs as root positions,
// so a static kernel provider (Wobble at amplitude 0) sits between the root and
// the CoordinatePasses consumer with no further upstream generations.
const SUP_STATIC = atoms(SUP_ATOMS, Float32Array.from(SUP_FRAMES[2]));
const UNW_STATIC = atoms(
  UNW_WHOLE.length,
  Float32Array.from(UNW_FRAMES[0]),
  UNW_BONDS,
);
const recordUnwrap = (status: UnwrapStatus) => {
  probe.unwrap.statuses.push(status);
};
// Gate 13 scene at N atoms: 10-atom covalent chains in a periodic box, a
// four-frame trajectory drifting across the box, and one mode node per chain.
type GateScene = {
  structure: StructureData;
  trajectory: TrajectoryData;
  mode: { atomToNode: Uint32Array; vectors: Float32Array; version: number };
  box: number[];
  frame0: Float32Array;
};
const gates = new Map<number, GateScene>();
function gateScene(n: number): GateScene {
  let scene = gates.get(n);
  if (scene) return scene;
  const chains = Math.ceil(n / 10), side = Math.ceil(Math.cbrt(chains));
  const box = [16 * side, 0, 0, 0, 4 * side, 0, 0, 0, 4 * side];
  const whole = new Float32Array(n * 3);
  const bonds: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const chain = Math.floor(i / 10), k = i % 10;
    whole[3 * i] = 16 * (chain % side) + 1.5 * k;
    whole[3 * i + 1] = 4 * (Math.floor(chain / side) % side) + 0.5 * (k % 2);
    whole[3 * i + 2] = 4 * Math.floor(chain / (side * side));
    if (k && i) bonds.push([i - 1, i]);
  }
  const frames = [0, 1, 2, 3].map((k) => {
    const positions = new Float32Array(n * 3);
    for (let j = 0; j < n * 3; j++) {
      const axis = j % 3, length = box[4 * axis];
      const v = whole[j] + (axis === 0 ? 5.3 * k : 0.1 * k);
      positions[j] = v - length * Math.floor(v / length);
    }
    return { positions, box: Float32Array.from(box) };
  });
  const nodes = chains;
  scene = {
    structure: atoms(n, whole, bonds),
    trajectory: createTrajectory({ atomCount: n, frames }),
    mode: {
      atomToNode: Uint32Array.from({ length: n }, (_, i) => Math.floor(i / 10)),
      vectors: Float32Array.from(
        { length: nodes * 3 },
        (_, i) => 0.3 * Math.sin(i),
      ),
      version: 1,
    },
    box,
    frame0: frames[0].positions,
  };
  gates.set(n, scene);
  return scene;
}
const GateProbe = (): null => {
  const coordinates = useCoordinates();
  probe.gate = coordinates
    ? { generation: coordinates.generation, count: coordinates.count }
    : null;
  probe.source = coordinates?.source ?? null;
  probe.state = useTrajectoryFrame();
  return null;
};
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
  | "skew"
  | "timeline"
  | "cell"
  | "slow"
  | "snapshot"
  | "src"
  | "transform"
  | "transform-selected"
  | "transform-curve"
  | "normal-mode"
  | "superpose"
  | "unwrap"
  | "unwrap-limit"
  | "unwrap-deep"
  | "static-superpose"
  | "static-unwrap"
  | "gate";
interface State {
  mode: Mode;
  frame: number;
  interpolate: "linear" | "nearest";
  pbc: "none" | "minimum-image";
  time: number;
  src: string;
  latency: number;
  matrix: number[];
  selectedRow: number;
  modeVersion: number;
  amplitude: number;
  supTo: "first" | "fixed";
  supSelect: boolean;
  supTranslate: boolean;
  unwrapBox: "trajectory" | "none" | "singular";
  unwrapCenter: boolean;
  gateAtoms: number;
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
  gate: { generation: number; count: number } | null;
  superpose: {
    frames: number[][];
    root: number[];
    fixed: number[];
    statuses: SuperposeStatus[];
  };
  unwrap: {
    frames: number[][];
    boxes: number[][];
    bonds: [number, number][];
    root: number[];
    statuses: UnwrapStatus[];
  };
  counters: typeof snapshotCounters;
  /** Frame 0 bounds of the gate scene, as the cell-list bounds pass reports. */
  gateBounds(n: number): number[];
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
  gate: null,
  superpose: {
    frames: SUP_FRAMES.map((f) => Array.from(f)),
    root: Array.from(SUP_STRUCTURE.positions),
    fixed: Array.from(SUP_FIXED),
    statuses: [],
  },
  unwrap: {
    frames: [],
    boxes: [],
    bonds: [],
    root: [],
    statuses: [],
  },
  counters: snapshotCounters,
  gateBounds: (n) => {
    const positions = gateScene(n).frame0;
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], positions[i]);
      hi[i % 3] = Math.max(hi[i % 3], positions[i]);
    }
    return [...lo, 0, ...hi, n];
  },
  update: () => {},
};
(globalThis as unknown as { __trajectory: Probe }).__trajectory = probe;
Object.assign(probe.unwrap, {
  frames: UNW_FRAMES.map((f) => Array.from(f)),
  boxes: UNW_BOXES,
  bonds: UNW_BONDS,
  root: Array.from(UNW_STRUCTURE.positions),
});

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
    case "skew":
      return played(state, SKEW);
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
    case "transform":
    case "transform-selected":
      return (
        <Structure data={STRUCTURE}>
          <Transform
            matrix={state.matrix}
            select={state.mode === "transform-selected"
              ? SELECT_ROWS[state.selectedRow]
              : undefined}
          >
            <Spacefill />
            <Probe />
          </Transform>
        </Structure>
      );
    case "transform-curve":
      return (
        <TimelineProvider time={state.time}>
          <Structure data={STRUCTURE}>
            <Transform matrix={MATRIX_CURVE}>
              <Spacefill />
              <Probe />
            </Transform>
          </Structure>
        </TimelineProvider>
      );
    case "normal-mode":
      return (
        <TimelineProvider time={state.time}>
          <Structure data={STRUCTURE}>
            <Trajectory data={WHOLE} frame={state.frame}>
              <NormalMode
                mode={MODES[state.modeVersion - 1]}
                amplitude={state.amplitude}
                frequency={1}
              >
                <Spacefill />
                <Probe />
              </NormalMode>
            </Trajectory>
          </Structure>
        </TimelineProvider>
      );
    case "superpose":
      return (
        <Structure data={SUP_STRUCTURE}>
          <Trajectory data={SUP_TRAJECTORY} frame={state.frame}>
            <Superpose
              to={state.supTo === "first" ? "first" : SUP_FIXED}
              select={state.supSelect ? SUP_FIT : undefined}
              translate={state.supTranslate}
              onStatus={(status) => probe.superpose.statuses.push(status)}
            >
              <Spacefill />
              <Probe />
            </Superpose>
          </Trajectory>
        </Structure>
      );
    case "gate": {
      const g = gateScene(state.gateAtoms);
      return (
        <TimelineProvider time={state.time}>
          <Structure data={g.structure}>
            <Trajectory data={g.trajectory} frame={state.frame}>
              <Unwrap>
                <Superpose to="first">
                  <NormalMode mode={g.mode} amplitude={1} frequency={1}>
                    <GateProbe />
                  </NormalMode>
                </Superpose>
              </Unwrap>
            </Trajectory>
          </Structure>
        </TimelineProvider>
      );
    }
    case "unwrap": {
      const unwrapped = (
        <Unwrap
          box={state.unwrapBox === "singular" ? SINGULAR : undefined}
          center={state.unwrapCenter ? UNW_RING : undefined}
          onStatus={recordUnwrap}
        >
          <Spacefill />
          <Probe />
        </Unwrap>
      );
      return (
        <Structure data={UNW_STRUCTURE}>
          {state.unwrapBox === "none"
            ? unwrapped
            : (
              <Trajectory data={UNW_TRAJECTORY} frame={state.frame}>
                {unwrapped}
              </Trajectory>
            )}
        </Structure>
      );
    }
    case "static-superpose":
      return (
        <Structure data={SUP_STATIC}>
          <WobbleCoordinates phase={0} amplitude={0}>
            <Superpose to={SUP_FIXED}>
              <Probe />
            </Superpose>
          </WobbleCoordinates>
        </Structure>
      );
    case "static-unwrap":
      return (
        <Structure data={UNW_STATIC}>
          <WobbleCoordinates phase={0} amplitude={0}>
            <Unwrap box={UNW_BOXES[0]}>
              <Probe />
            </Unwrap>
          </WobbleCoordinates>
        </Structure>
      );
    case "unwrap-limit":
      return (
        <Structure data={LIMIT_STRUCTURE}>
          <Unwrap box={LIMIT_BOX} onStatus={recordUnwrap}>
            <Probe />
          </Unwrap>
        </Structure>
      );
    case "unwrap-deep":
      return (
        <Structure data={DEEP_STRUCTURE}>
          <Unwrap box={[10, 0, 0, 0, 10, 0, 0, 0, 10]}>
            <Probe />
          </Unwrap>
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
    matrix: IDENTITY,
    selectedRow: 0,
    modeVersion: 1,
    amplitude: 0,
    supTo: "first",
    supSelect: false,
    supTranslate: true,
    unwrapBox: "trajectory",
    unwrapCenter: false,
    gateAtoms: 0,
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
