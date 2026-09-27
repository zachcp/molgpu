/**
 * WebGPU harness for <EField> and the representations that read it.
 * `deno task test:components` builds it with vite and drives every mode from
 * run-efield.mjs through `window.__efield`.
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
import {
  createStructure,
  createTrajectory,
  type StructureData,
  type TrajectoryData,
  type VolumeGrid,
  withAttributes,
} from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import { resolve, type Selection, where } from "@molgpu/select";
import { coordinateBounds, createVolume, sampleVolume } from "@molgpu/table";

import { buildSurfaceGeometry } from "../../src/internal/surface-geometry.ts";
import {
  coulombGrid,
  type ElectrostaticsOptions,
  templateCharges,
} from "@molgpu/dynamics";
import { byPotential } from "@molgpu/fields";
import {
  EField,
  type EFieldProps,
  FieldArrows,
  FieldLines,
  Isosurface,
  Spacefill,
  Structure,
  Surface,
  Trajectory,
  VolumeSlice,
} from "@molgpu/viewer";
import {
  createStructureResource,
  useVolume,
  WobbleCoordinates,
} from "@molgpu/viewer/advanced";
import {
  enableInstrumentation,
  snapshotCounters,
} from "../../src/internal/instrumentation.ts";
import { efieldTesting } from "../../src/efield.ts";
import { fieldLinesTesting } from "../../src/field-lines.ts";
import { positionsWgsl } from "../../src/field-arrows.ts";
import { slicePlaneFrame } from "../../src/internal/slice-plane.ts";

enableInstrumentation();

/** A hand-built structure: one residue per atom, charges as partialCharge. */
function charged(
  positions: ArrayLike<number>,
  charges: ArrayLike<number>,
  altloc?: string[],
): StructureData {
  const count = charges.length;
  const data = createStructure({
    positions: Float32Array.from(positions),
    topology: {
      atoms: {
        count,
        id: Array.from({ length: count }, (_, i) => String(i + 1)),
        // Altloc copies share a name; everything else is distinct.
        name: Array.from(
          { length: count },
          (_, i) => altloc?.[i] === "B" ? "C1" : `C${i + 1}`,
        ),
        altloc: altloc ?? new Array(count).fill(""),
        residue: new Uint32Array(count),
        element: new Uint8Array(count).fill(6),
        occupancy: new Float32Array(count).fill(1),
        bfactor: new Float32Array(count),
        radius: new Float32Array(count).fill(1),
      },
      residues: {
        count: 1,
        chain: new Uint32Array(1),
        labelSeq: new Int32Array([1]),
        authSeq: ["1"],
        insertionCode: [""],
        comp: ["UNK"],
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
  return withAttributes(data, {
    partialCharge: {
      domain: "atom",
      kind: "scalar",
      values: Float32Array.from(charges),
      provenance: "user",
    },
  });
}

// Deterministic pseudo-random cloud: large cancellation between + and −.
function cloud(n: number, seed = 7) {
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const positions = Float32Array.from({ length: n * 3 }, () => rand() * 16 - 8);
  const charges = Float32Array.from(
    { length: n },
    (_, i) => (i % 2 ? 1 : -1) * (0.2 + rand() * 0.6),
  );
  return { positions, charges };
}
const CLOUD = cloud(300);
const RANDOM = charged(CLOUD.positions, CLOUD.charges);
// An ideal ± pair on the x axis, 6 Å apart.
const DIPOLE = charged([-3, 0, 0, 3, 0, 0], [1, -1]);
// One +1 e charge at the origin.
const UNIT = charged([0, 0, 0], [1]);
const SPARSE = charged([0, 0, 0, 10_000, 0, 0], [1, 0]);
// Altloc B copy of the positive charge must not be summed.
const ALTLOC = charged([-3, 0, 0, 3, 0, 0, -3, 0.5, 0], [1, -1, 1], [
  "A",
  "",
  "B",
]);
// Three frames of the dipole sliding along x.
const FRAMES: TrajectoryData = createTrajectory({
  atomCount: 2,
  frames: [0, 1, 2].map((k) => ({
    positions: Float32Array.of(-3 + k, 0, 0, 3 + k, 0, 0),
  })),
});

// Seeds on the dipole's mid-plane (created once: new seeds rebuild the pass).
const LINE_SEEDS = Float32Array.from(
  [0.4, 0.8, 1.2, 1.6, 2.0, 2.4].flatMap((y) => [0, y, 0]),
);

const perf = new Map<number, StructureData>();
/** n alternating charges spread through a 60 Å cube. */
const PERF = (n: number) => {
  let data = perf.get(n);
  if (!data) {
    const { positions, charges } = cloud(n, 11);
    data = charged(positions.map((v) => v * 3.75), charges);
    perf.set(n, data);
  }
  return data;
};

let crambin: StructureData | null = null;
const chains = new Map<string, Selection>();
/** Protein atoms of one author chain of the loaded structure. */
function chainSelection(id: string): Selection {
  let hit = chains.get(id);
  if (!hit) {
    const data = crambin!;
    const { atoms, residues, chains: c } = data.topology;
    hit = resolve(
      where("atom", `chain ${id} protein`, (_, row) => {
        const residue = atoms.residue[row];
        return c.authId[residues.chain[residue]] === id &&
          residues.polymer[residue] === "protein";
      }),
      data,
    );
    chains.set(id, hit);
  }
  return hit;
}

type Mode =
  | "none"
  | "random"
  | "sparse"
  | "altloc"
  | "wobble"
  | "trajectory"
  | "iso"
  | "slice"
  | "crambin"
  | "surface"
  | "lines"
  | "arrows"
  | "select"
  | "perf";
interface State {
  mode: Mode;
  physics: ElectrostaticsOptions;
  phase: number;
  frame: number;
  spacing: number;
  maxSamples?: number;
  planeIndex: number;
  lineRange: [number, number];
  arrowScale: number;
  sampleOffset: number;
  chain: string;
  perfAtoms: number;
  target: [number, number, number];
  radius: number;
}

interface Probe {
  mounted: boolean;
  phase: string;
  failure: string | null;
  device: GPUDevice | null;
  errors: string[];
  grid: VolumeGrid | null;
  generation: number;
  counters: typeof snapshotCounters;
  update(patch: Partial<State>): void;
  load(url: string): Promise<void>;
  readPotential(): Promise<number[]>;
  cpuPotential(which: string, extra?: Record<string, number>): number[];
  readLines(): Promise<{ vertices: number[]; generation: number }>;
  hold(): void;
  release(): void;
  dispatchPairs(n: number): void;
  surfaceStats(chain: string): Promise<{ mean: number; count: number }>;
  center: [number, number, number];
  /** ms from a coordinate change to the finished recomputation. */
  timeRecompute(phase: number): Promise<number>;
  arrowEnds(
    index: number,
    spacing: number,
    scale: number,
    cap: number,
  ): Promise<{ side: number; ends: number[] }>;
}
const probe: Probe = {
  mounted: false,
  phase: "idle",
  failure: null,
  device: null,
  errors: [],
  grid: null,
  generation: 0,
  counters: snapshotCounters,
  update: () => {},
  load: async () => {},
  readPotential: async () => [],
  cpuPotential: () => [],
  readLines: async () => ({ vertices: [], generation: 0 }),
  hold: () => {},
  release: () => {},
  dispatchPairs: () => {},
  surfaceStats: async () => ({ mean: 0, count: 0 }),
  arrowEnds: async () => ({ side: 0, ends: [] }),
  center: [0, 0, 0],
  timeRecompute: async () => 0,
};
(globalThis as unknown as { __efield: Probe }).__efield = probe;

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
  await device.queue.onSubmittedWorkDone();
  const staging = device.createBuffer({
    size: bytes,
    usage: 0x0008 | 0x0001,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(0x0001);
  const values = Array.from(new Float32Array(staging.getMappedRange()));
  staging.unmap();
  staging.destroy();
  return values;
}

let potentialBuffer: GPUBuffer | null = null;
const VolumeProbe = (): null => {
  const { grid, source, generation } = useVolume();
  probe.grid = grid;
  probe.generation = generation;
  potentialBuffer = source.buffer;
  probe.phase = "ready";
  return null;
};
probe.readPotential = () => {
  const [nx, ny, nz] = probe.grid!.dims;
  return readBuffer(potentialBuffer!, nx * ny * nz * 4);
};
probe.readLines = async () => {
  const last = fieldLinesTesting.last!;
  return {
    vertices: await readBuffer(last.buffer, last.vertices * 16),
    generation: last.generation,
  };
};
let releaseGate: (() => void) | null = null;
probe.hold = () => {
  efieldTesting.gate = new Promise((resolve) => (releaseGate = resolve));
};
probe.release = () => {
  efieldTesting.gate = null;
  releaseGate?.();
};
probe.dispatchPairs = (n) => {
  efieldTesting.pairsPerDispatch = n;
};

/** CPU oracle on the probe's grid, with the atoms each mode sums. */
probe.cpuPotential = (which, extra = {}) => {
  const grid = probe.grid!;
  let positions: ArrayLike<number>, charges: ArrayLike<number>;
  let rows: number[] | null = null;
  switch (which) {
    case "random":
      positions = CLOUD.positions;
      charges = CLOUD.charges;
      break;
    case "sparse":
      positions = SPARSE.positions;
      charges = SPARSE.attributes!.partialCharge.values;
      break;
    case "altloc":
      positions = ALTLOC.positions;
      charges = ALTLOC.attributes!.partialCharge.values;
      rows = [0, 1];
      break;
    case "wobble": {
      // WobbleCoordinates: y += sin(phase + 0.4 x) * 0.8.
      positions = Float32Array.from(CLOUD.positions, (v, j) =>
        j % 3 === 1
          ? v +
            Math.fround(
              Math.sin(extra.phase + CLOUD.positions[j - 1] * 0.4) * 0.8,
            )
          : v);
      charges = CLOUD.charges;
      break;
    }
    case "trajectory":
      positions = [-3 + extra.frame, 0, 0, 3 + extra.frame, 0, 0];
      charges = [1, -1];
      break;
    case "crambin":
      positions = crambin!.positions;
      charges = crambin!.attributes!.partialCharge.values;
      rows = [];
      for (let i = 0; i < charges.length; i++) rows.push(i);
      break;
    default:
      throw new Error(`no oracle for ${which}`);
  }
  const atoms: number[] = [];
  const pick = rows ?? Array.from({ length: charges.length }, (_, i) => i);
  for (const i of pick) {
    if (charges[i] === 0) continue;
    atoms.push(
      Math.fround(positions[i * 3]),
      Math.fround(positions[i * 3 + 1]),
      Math.fround(positions[i * 3 + 2]),
      Math.fround(charges[i]),
    );
  }
  return Array.from(coulombGrid(grid, atoms, current.physics));
};

/**
 * Mean GPU potential over one chain's SES vertices, sampled 1.4 Å out along
 * the normals, as <Surface color={byPotential()}> samples it.
 */
probe.surfaceStats = async (id) => {
  const selection = chainSelection(id);
  const grid = probe.grid!;
  const volume = createVolume({
    values: Float32Array.from(await probe.readPotential()),
    dims: grid.dims,
    transform: grid.transform,
  }, { maxSamples: Infinity });
  const resource = createStructureResource(crambin!);
  const mesh = await buildSurfaceGeometry(resource, {
    indices: selection.indices,
  });
  resource.dispose();
  const { positions, normals, vertexCount } = mesh!;
  let sum = 0;
  for (let i = 0; i < vertexCount; i++) {
    const n = Math.hypot(
      normals[i * 3],
      normals[i * 3 + 1],
      normals[i * 3 + 2],
    );
    const at = [0, 1, 2].map((a) =>
      positions[i * 3 + a] + 1.4 * normals[i * 3 + a] / n
    );
    sum += sampleVolume(volume, at[0], at[1], at[2]);
  }
  return { mean: sum / vertexCount, count: vertexCount };
};

/**
 * Run <FieldArrows>' endpoint shader in a compute pass, with its links bound
 * to the same values the component passes, and read every endpoint back.
 */
probe.arrowEnds = async (index, spacing, scale, cap) => {
  const device = probe.device!;
  const grid = probe.grid!;
  const frame = slicePlaneFrame(grid, { axis: 2, index });
  const radius = Math.hypot(...frame.u);
  const side = Math.max(1, Math.min(256, Math.floor((2 * radius) / spacing)));
  const v3 = (a: readonly number[]) => `vec3<f32>(${a.join(", ")})`;
  const code = positionsWgsl(grid, side)
    .replace(
      "@link fn getVolumeValue(i: u32) -> f32;",
      "@group(0) @binding(0) var<storage, read> phi: array<f32>;\nfn getVolumeValue(i: u32) -> f32 { return phi[i]; }",
    )
    .replace(
      "@link fn getCenter() -> vec3<f32>;",
      `fn getCenter() -> vec3<f32> { return ${v3(frame.center)}; }`,
    )
    .replace(
      "@link fn getAxisU() -> vec3<f32>;",
      `fn getAxisU() -> vec3<f32> { return ${v3(frame.u)}; }`,
    )
    .replace(
      "@link fn getAxisV() -> vec3<f32>;",
      `fn getAxisV() -> vec3<f32> { return ${v3(frame.v)}; }`,
    )
    .replace(
      "@link fn getStyle() -> vec4<f32>;",
      `fn getStyle() -> vec4<f32> { return vec4<f32>(${scale}, ${cap}, 0.001, 3.0); }`,
    )
    .replace("@export fn", "fn") +
    `@group(0) @binding(1) var<storage, read_write> ends: array<vec4<f32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < arrayLength(&ends)) { ends[id.x] = getArrowPosition(id.x); }
}`;
  const n = side * side * 2;
  const out = device.createBuffer({
    size: n * 16,
    usage: 0x0080 | 0x0004,
  });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: {
      module: device.createShaderModule({ code }),
      entryPoint: "main",
    },
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: potentialBuffer! } },
        { binding: 1, resource: { buffer: out } },
      ],
    }),
  );
  pass.dispatchWorkgroups(Math.ceil(n / 64));
  pass.end();
  device.queue.submit([encoder.finish()]);
  const ends = await readBuffer(out, n * 16);
  out.destroy();
  return { side, ends };
};

probe.timeRecompute = async (phase) => {
  const before = probe.generation;
  const t0 = performance.now();
  probe.update({ phase });
  while (probe.generation === before) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await probe.device!.queue.onSubmittedWorkDone();
  return performance.now() - t0;
};

probe.load = async (url) => {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const data = await structureFromBcif(bytes);
  const { values } = templateCharges(data);
  chains.clear();
  const bounds = coordinateBounds(data)!;
  probe.center = bounds.center as [number, number, number];
  crambin = withAttributes(data, {
    partialCharge: {
      domain: "atom",
      kind: "scalar",
      values,
      provenance: "template:amber-pdb2pqr",
    },
  });
};

const phase = (name: string, failure: unknown = null): null => {
  probe.phase = name;
  probe.failure = failure === null ? null : String(failure);
  return null;
};

let current: State;

const Scene = ({ state }: { state: State }): LiveElement => {
  const field: EFieldProps = {
    ...state.physics,
    spacing: state.spacing,
    maxSamples: state.maxSamples,
  };
  switch (state.mode) {
    case "none":
      return null;
    case "random":
      return (
        <Structure data={RANDOM}>
          <EField {...field}>
            <VolumeProbe />
          </EField>
        </Structure>
      );
    case "sparse":
      return (
        <Structure data={SPARSE}>
          <EField {...field}>
            <VolumeProbe />
          </EField>
        </Structure>
      );
    case "altloc":
      return (
        <Structure data={ALTLOC}>
          <EField {...field}>
            <VolumeProbe />
          </EField>
        </Structure>
      );
    case "wobble":
      return (
        <Structure data={RANDOM}>
          <WobbleCoordinates phase={state.phase}>
            <EField {...field} padding={10}>
              <VolumeProbe />
            </EField>
          </WobbleCoordinates>
        </Structure>
      );
    case "trajectory":
      return (
        <Structure data={DIPOLE}>
          <Trajectory data={FRAMES} frame={state.frame}>
            <EField {...field} box={{ min: [-8, -5, -5], max: [8, 5, 5] }}>
              <VolumeProbe />
            </EField>
          </Trajectory>
        </Structure>
      );
    case "iso":
      return (
        <Structure data={DIPOLE}>
          <WobbleCoordinates phase={state.phase} amplitude={0.3}>
            <EField {...field}>
              <VolumeProbe />
              <Isosurface level={1} color={[0.2, 0.3, 1, 1]} />
              <Isosurface level={-1} color={[1, 0.2, 0.2, 1]} />
            </EField>
          </WobbleCoordinates>
        </Structure>
      );
    case "slice":
      return (
        <Structure data={DIPOLE}>
          <WobbleCoordinates phase={state.phase} amplitude={0.3}>
            <EField {...field}>
              <VolumeProbe />
              <VolumeSlice
                plane={{ axis: 2, index: state.planeIndex }}
                stops={[[0, [1, 0, 0, 1]], [0.5, [1, 1, 1, 1]], [1, [
                  0,
                  0,
                  1,
                  1,
                ]]]}
              />
            </EField>
          </WobbleCoordinates>
        </Structure>
      );
    case "crambin":
    case "surface":
      if (!crambin) return phase("no crambin");
      return (
        <Structure data={crambin}>
          <EField {...field}>
            <VolumeProbe />
            {state.mode === "surface"
              ? (
                <Surface
                  color={byPotential({ range: 5 })}
                  sampleOffset={state.sampleOffset}
                />
              )
              : null}
          </EField>
        </Structure>
      );
    case "select": {
      if (!crambin) return phase("no structure");
      const selection = chainSelection(state.chain);
      return (
        <Structure data={crambin}>
          <EField {...field} select={selection}>
            <VolumeProbe />
            <Surface
              select={selection}
              color={byPotential()}
              sampleOffset={state.sampleOffset}
            />
          </EField>
        </Structure>
      );
    }
    case "perf":
      // A 128³ grid (0.5 Å over 63.5 Å) around the cloud.
      return (
        <Structure data={PERF(state.perfAtoms)}>
          <WobbleCoordinates phase={state.phase} amplitude={0.1}>
            <EField
              {...state.physics}
              box={{ min: [-32, -32, -32], max: [31.5, 31.5, 31.5] }}
              spacing={0.5}
              maxPairs={2 ** 40}
            >
              <VolumeProbe />
            </EField>
          </WobbleCoordinates>
        </Structure>
      );
    case "lines":
      return (
        <Structure data={DIPOLE}>
          <EField
            {...field}
            model="vacuum"
            box={{ min: [-12, -12, -12], max: [12, 12, 12] }}
            spacing={0.25}
            maxSamples={200 ** 3}
          >
            <VolumeProbe />
            <FieldLines
              seeds={LINE_SEEDS}
              steps={160}
              step={0.1}
              maxPotential={1e4}
              colorRange={state.lineRange}
            />
          </EField>
        </Structure>
      );
    case "arrows":
      return (
        <Structure data={UNIT}>
          <EField
            {...field}
            model="vacuum"
            box={{ min: [-6, -6, -6], max: [6, 6, 6] }}
            spacing={0.5}
          >
            <VolumeProbe />
            <FieldArrows
              plane={{ axis: 2, index: state.planeIndex }}
              spacing={2}
              scale={state.arrowScale}
            />
          </EField>
        </Structure>
      );
  }
};

const App = (): LiveElement => {
  const [state, setState] = useState<State>({
    mode: "none",
    physics: {},
    phase: 0,
    frame: 0,
    spacing: 1,
    planeIndex: 12,
    lineRange: [0, 2],
    arrowScale: 1,
    sampleOffset: 1.4,
    chain: "A",
    perfAtoms: 5000,
    target: [0, 0, 0],
    radius: 40,
  });
  current = state;
  probe.update = (patch) => {
    probe.phase = "updating";
    setState((previous) => ({ ...previous, ...patch }));
  };
  probe.mounted = true;
  return (
    <OrbitCamera
      radius={state.radius}
      bearing={0.3}
      pitch={0.3}
      target={state.target}
    >
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

// Errors thrown while rendering a mode land here, not as page errors.
globalThis.addEventListener("error", (event) => {
  probe.failure = String(event.error ?? event.message);
});
render(<Root />);
