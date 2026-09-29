/**
 * WebGPU harness for <Volume>, <Isosurface>, <VolumeSlice> and volumeSample
 * colouring. `deno task test:components` builds it with vite and drives every
 * mode from run-volume.mjs through `window.__volume`.
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
  createVolume,
  type StructureData,
  type VolumeData,
} from "@molgpu/table";
import {
  attribute,
  categorical,
  COLOR,
  colormap,
  type Field,
  joinAnnotation,
  volumeSample,
} from "@molgpu/fields";
import { resolve, type Selection, where } from "@molgpu/select";
import {
  Bonds,
  Isosurface,
  Spacefill,
  Structure,
  Surface,
  Volume,
  VolumeSlice,
} from "@molgpu/viewer";
import type { VolumeLoader } from "@molgpu/viewer";
import { useVolume } from "@molgpu/viewer/advanced";
import {
  enableInstrumentation,
  snapshotCounters,
} from "../../src/internal/instrumentation.ts";

void React;

enableInstrumentation();

// A sheared grid over x ∈ [-10, 10] whose value is the world x coordinate,
// plus a Gaussian blob for the isosurface.
const TRANSFORM = [1, 0, 0, 0, 0.15, 1, 0, 0, 0.1, 0, 1, 0, -10.5, -8, -6, 1];
function makeVolume(): VolumeData {
  const dims: [number, number, number] = [22, 16, 12];
  const values = new Float32Array(dims[0] * dims[1] * dims[2]);
  const m = TRANSFORM;
  for (let k = 0; k < dims[2]; k++) {
    for (let j = 0; j < dims[1]; j++) {
      for (let i = 0; i < dims[0]; i++) {
        const x = m[0] * i + m[4] * j + m[8] * k + m[12];
        values[i + dims[0] * (j + dims[1] * k)] = x;
      }
    }
  }
  return createVolume({ values, dims, transform: TRANSFORM });
}
function makeBlob(): VolumeData {
  const n = 24;
  const values = new Float32Array(n ** 3);
  const m = [0.6, 0.1, 0, 0, 0, 0.6, 0, 0, 0.1, 0, 0.6, 0, -7, -7, -7, 1];
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = m[0] * i + m[4] * j + m[8] * k + m[12];
        const y = m[1] * i + m[5] * j + m[9] * k + m[13];
        const z = m[2] * i + m[6] * j + m[10] * k + m[14];
        values[i + n * (j + n * k)] = 10 *
          Math.exp(-(x * x + y * y + z * z) / 12);
      }
    }
  }
  return createVolume({ values, dims: [n, n, n], transform: m });
}
const GRADIENT = makeVolume();
// The plan's first-gate ceiling: 256³ scalar samples, built only when used.
let big: VolumeData | null = null;
const BIG = () =>
  big ??= createVolume({
    values: new Float32Array(256 ** 3),
    dims: [256, 256, 256],
    transform: [
      0.1,
      0,
      0,
      0,
      0,
      0.1,
      0,
      0,
      0,
      0,
      0.1,
      0,
      -12.8,
      -12.8,
      -12.8,
      1,
    ],
  });
const BLOB = makeBlob();

function atoms(xs: number[], z = 0): StructureData {
  const count = xs.length;
  const positions = new Float32Array(count * 3);
  xs.forEach((x, i) => {
    positions[i * 3] = x;
    positions[i * 3 + 2] = z;
  });
  return createStructure({
    positions,
    topology: {
      atoms: {
        count,
        id: xs.map((_, i) => String(i + 1)),
        name: xs.map((_, i) => `C${i + 1}`),
        altloc: xs.map(() => ""),
        residue: new Uint32Array(count),
        element: new Uint8Array(count).fill(6),
        occupancy: new Float32Array(count).fill(1),
        bfactor: new Float32Array(count),
        radius: new Float32Array(count).fill(1.6),
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
// Blue (x = -8), red (x = 8), and one outside the grid (x = 16 → 0 → mid).
const COLOURED = atoms([-8, 8, 16]);
const FRONT = atoms([0], 8);
const BEHIND = atoms([4], -8);
const RED = [1, 0, 0, 1] as const, BLUE = [0, 0, 1, 1] as const;
const GREEN = [0, 1, 0, 1] as const;
const BY_X = colormap(volumeSample(GRADIENT), [[-10, BLUE], [10, RED]]);

// Two bonded residues: residue 1 at x ≈ -8 (blue under BY_X), residue 2 at
// x ≈ 8 (red). Explicit bonds 0–1 and 2–3.
function pairs(): StructureData {
  const xs = [-8.7, -7.3, 7.3, 8.7];
  const base = atoms(xs);
  const { topology } = base;
  return createStructure({
    positions: base.positions,
    topology: {
      ...topology,
      atoms: { ...topology.atoms, residue: Uint32Array.from([0, 0, 1, 1]) },
      residues: {
        count: 2,
        chain: new Uint32Array(2),
        labelSeq: new Int32Array([1, 2]),
        authSeq: ["1", "2"],
        insertionCode: ["", ""],
        comp: ["GLY", "GLY"],
        polymer: ["other", "other"],
      },
      bonds: {
        count: 2,
        a: Uint32Array.from([0, 2]),
        b: Uint32Array.from([1, 3]),
        order: Uint8Array.from([1, 1]),
        source: ["explicit", "explicit"],
      },
    },
  });
}
const PAIRS = pairs();
// Residue 2 only: subset rows exercise per-representation row indexing.
const SECOND: Selection = resolve(
  where("atom", "residue 2", (data, i) => data.topology.atoms.residue[i] === 1),
  PAIRS,
);
// The nearest <Volume>'s gradient, through an argument-free volumeSample().
const NEAREST = colormap(volumeSample(), [[-10, BLUE], [10, RED]]);
// Residue records joined by identity and lifted onto atoms.
const ANNOTATED = joinAnnotation(PAIRS, [
  { chainLabel: "A", labelSeq: 1, value: GREEN },
  { chainLabel: "A", labelSeq: 2, value: RED },
], { fields: ["chainLabel", "labelSeq"], type: COLOR });
// A built-in residue column read through each atom's residue. Residue 1
// alternates blue/green/blue across styles, so a stale frame cannot pass.
const LIFTED = categorical(
  attribute("labelSeq", { domain: "atom" }),
  { 1: BLUE, 2: RED },
  GREEN,
);
const STYLES: Record<FieldStyle, Field> = {
  nearest: NEAREST,
  annotation: ANNOTATED,
  lifted: LIFTED,
};
type FieldStyle = "nearest" | "annotation" | "lifted";

// Two models of one residue. Model 1 (left) has an alternate conformer: C2
// altloc A (occupancy 0.6, beside C1) and altloc B (0.4, above C1). Model 2
// sits on the right. The default view is model 1 with altloc A only.
function models(): StructureData {
  const base = atoms([-8, -6.6, -7.3, 6.6, 8]);
  const { topology } = base;
  const positions = Float32Array.from(base.positions);
  positions[2 * 3 + 1] = 7;
  return createStructure({
    positions,
    topology: {
      ...topology,
      atoms: {
        ...topology.atoms,
        name: ["C1", "C2", "C2", "C1", "C2"],
        altloc: ["", "A", "B", "", ""],
        occupancy: Float32Array.from([1, 0.6, 0.4, 1, 1]),
        residue: Uint32Array.from([0, 0, 0, 1, 1]),
      },
      residues: {
        count: 2,
        chain: Uint32Array.from([0, 1]),
        labelSeq: new Int32Array([1, 1]),
        authSeq: ["1", "1"],
        insertionCode: ["", ""],
        comp: ["GLY", "GLY"],
        polymer: ["other", "other"],
      },
      chains: {
        count: 2,
        model: Int32Array.from([1, 2]),
        labelId: ["A", "A"],
        authId: ["A", "A"],
      },
      bonds: {
        count: 3,
        a: Uint32Array.from([0, 0, 3]),
        b: Uint32Array.from([1, 2, 4]),
        order: Uint8Array.from([1, 1, 1]),
        source: ["explicit", "explicit", "explicit"],
      },
      instances: {
        count: 2,
        chain: Uint32Array.from([0, 1]),
        operatorId: ["identity", "identity"],
        transform: Float64Array.from([
          ...topology.instances.transform,
          ...topology.instances.transform,
        ]),
      },
    },
  });
}
const MODELS = models();
const modelOf = (data: StructureData, row: number): number =>
  data.topology.chains.model[
    data.topology.residues.chain[data.topology.atoms.residue[row]]
  ];
type View = "default" | "model2" | "all" | "empty";
const VIEWS: Record<View, Selection | null> = {
  default: null,
  model2: resolve(
    where("atom", "model 2", (d, i) => modelOf(d, i) === 2),
    MODELS,
  ),
  all: resolve(where("atom", "all", () => true), MODELS),
  empty: resolve(where("atom", "none", () => false), MODELS),
};
type FieldTarget = "spacefill" | "bonds" | "surface";

type Mode =
  | "none"
  | "volume"
  | "shared"
  | "iso"
  | "slice"
  | "depth"
  | "src"
  | "big"
  | "field"
  | "view";
interface State {
  mode: Mode;
  level: number | { sigma: number };
  color: [number, number, number, number];
  opacity: number;
  index: number;
  src: string;
  bearing: number;
  target: FieldTarget;
  style: FieldStyle;
  subset: boolean;
  view: View;
}

interface Probe {
  mounted: boolean;
  volume: VolumeData | null;
  source: StorageSource | null;
  phase: string;
  failure: string | null;
  device: GPUDevice | null;
  errors: string[];
  values: (which: "gradient" | "blob") => number[];
  counters: typeof snapshotCounters;
  update(patch: Partial<State>): void;
}
const probe: Probe = {
  mounted: false,
  volume: null,
  source: null,
  phase: "idle",
  failure: null,
  device: null,
  errors: [],
  values: (which) =>
    Array.from(which === "gradient" ? GRADIENT.values : BLOB.values),
  counters: snapshotCounters,
  update: () => {},
};
(globalThis as unknown as { __volume: Probe }).__volume = probe;

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

const VolumeProbe = (): null => {
  const { volume, source } = useVolume();
  probe.volume = volume;
  probe.source = source;
  probe.phase = "ready";
  return null;
};

const loader: VolumeLoader = async (src, cancelled) => {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`volume ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { volumeFromCcp4 } = await import("@molgpu/io");
  const volume = await volumeFromCcp4(bytes);
  return cancelled() ? null : volume;
};
const phase = (name: string, failure: unknown = null): null => {
  probe.phase = name;
  probe.failure = failure === null ? null : String(failure);
  return null;
};

const Scene = ({ state }: { state: State }): LiveElement => {
  switch (state.mode) {
    case "none":
      return null;
    case "volume":
      return (
        <Volume data={GRADIENT}>
          <VolumeProbe />
        </Volume>
      );
    case "shared":
      // The same VolumeData through <Volume> and a field: one GPU copy.
      return [
        <Volume key="volume" data={GRADIENT}>
          <VolumeProbe />
        </Volume>,
        <Structure key="structure" data={COLOURED}>
          <Spacefill color={BY_X} />
        </Structure>,
      ];
    case "iso":
      return (
        <Volume data={BLOB}>
          <Isosurface
            level={state.level}
            color={state.color}
            opacity={state.opacity}
          />
        </Volume>
      );
    case "slice":
      return [
        <Volume key="surface" data={BLOB}>
          <Isosurface level={2} color={[0.9, 0.9, 0.2, 1]} />
        </Volume>,
        <Volume key="slice" data={GRADIENT}>
          <VolumeSlice
            plane={{ axis: 0, index: state.index }}
            range={[-10, 10]}
            stops={[[0, BLUE], [1, RED]]}
          />
        </Volume>,
      ];
    case "depth":
      // A red atom in front of a z-plane slice and one behind it.
      return [
        <Volume key="slice" data={GRADIENT}>
          <VolumeSlice
            plane={{ normal: [0, 0, 1], point: [0, 0, 0] }}
            stops={[[0, [0.2, 0.9, 0.2, 1]], [1, [0.2, 0.9, 0.2, 1]]]}
          />
        </Volume>,
        <Structure key="front" data={FRONT}>
          <Spacefill color={[1, 0, 0, 1]} />
        </Structure>,
        <Structure key="behind" data={BEHIND}>
          <Spacefill color={[1, 0, 0, 1]} />
        </Structure>,
      ];
    case "field": {
      // A contextual field under the nearest <Volume>, applied by one
      // representation to all atoms or to residue 2.
      const color = STYLES[state.style];
      const select = state.subset ? SECOND : null;
      return (
        <Volume data={GRADIENT}>
          <Structure data={PAIRS}>
            {state.target === "spacefill"
              ? <Spacefill color={color} select={select} />
              : state.target === "bonds"
              ? <Bonds color={color} select={select} width={0.8} />
              : <Surface color={color} select={select} sampleOffset={0} />}
          </Structure>
        </Volume>
      );
    }
    case "view": {
      // One structure's default view, or an explicit selection override.
      const select = VIEWS[state.view];
      return (
        <Structure data={MODELS}>
          {state.target === "bonds"
            ? <Bonds color={RED} select={select} width={0.8} />
            : <Spacefill color={RED} select={select} />}
        </Structure>
      );
    }
    case "big":
      return (
        <Volume data={BIG()}>
          <VolumeProbe />
        </Volume>
      );
    case "src":
      return (
        <Volume
          src={state.src}
          loader={loader}
          loading={() => phase("loading")}
          error={(failure: unknown) => phase("error", failure)}
        >
          <VolumeProbe />
        </Volume>
      );
  }
};

const App = (): LiveElement => {
  const [state, setState] = useState<State>({
    mode: "none",
    level: 5,
    color: [0.3, 0.55, 0.95, 1],
    opacity: 1,
    index: 10,
    src: "",
    bearing: 0,
    target: "spacefill",
    style: "nearest",
    subset: false,
    view: "default",
  });
  probe.update = (patch) => setState((previous) => ({ ...previous, ...patch }));
  probe.mounted = true;
  return (
    <OrbitCamera
      radius={40}
      bearing={state.bearing}
      pitch={0}
      target={[0, 0, 0]}
    >
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
