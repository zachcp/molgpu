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
import { colormap, volumeSample } from "@molgpu/fields";
import {
  Isosurface,
  Spacefill,
  Structure,
  Volume,
  VolumeSlice,
} from "@molgpu/viewer";
import type { VolumeLoader } from "@molgpu/viewer";
import { useVolume } from "@molgpu/viewer/advanced";
import {
  enableInstrumentation,
  snapshotCounters,
} from "../../src/internal/instrumentation.ts";

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
const BY_X = colormap(volumeSample(GRADIENT), [[-10, BLUE], [10, RED]]);

type Mode =
  | "none"
  | "volume"
  | "shared"
  | "iso"
  | "slice"
  | "depth"
  | "src"
  | "big";
interface State {
  mode: Mode;
  level: number | { sigma: number };
  color: [number, number, number, number];
  opacity: number;
  index: number;
  src: string;
  bearing: number;
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
        <Volume data={GRADIENT}>
          <VolumeProbe />
        </Volume>,
        <Structure data={COLOURED}>
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
        <Volume data={BLOB}>
          <Isosurface level={2} color={[0.9, 0.9, 0.2, 1]} />
        </Volume>,
        <Volume data={GRADIENT}>
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
        <Volume data={GRADIENT}>
          <VolumeSlice
            plane={{ normal: [0, 0, 1], point: [0, 0, 0] }}
            stops={[[0, [0.2, 0.9, 0.2, 1]], [1, [0.2, 0.9, 0.2, 1]]]}
          />
        </Volume>,
        <Structure data={FRONT}>
          <Spacefill color={[1, 0, 0, 1]} />
        </Structure>,
        <Structure data={BEHIND}>
          <Spacefill color={[1, 0, 0, 1]} />
        </Structure>,
      ];
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
