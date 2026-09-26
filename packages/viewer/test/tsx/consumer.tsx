/**
 * The typed consumer fixture: a real .tsx application that composes
 * <Molecule>/<Structure>/<Spacefill> inside one caller-owned use.gpu scene,
 * with no canvas or device of its own beyond the <AutoCanvas> it mounts.
 *
 * `deno task typecheck:components` compiles it; `deno task test:components` builds it with
 * vite and drives every state below in Chrome. The `probe` wiring is the test
 * control surface, imported from ./diagnostics.ts so this file keeps consumer
 * shape: state in, Live elements out.
 */
import { React, render, useOne, useState } from "@use-gpu/live";
import type { LiveElement } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
} from "@use-gpu/workbench";
import { createStructure } from "@molgpu/table";
import type { StructureData } from "@molgpu/table";
import {
  Molecule,
  Spacefill,
  Structure,
  useStructureResource,
} from "@molgpu/viewer";
import type { StructureLoader, StructureProps } from "@molgpu/viewer";
import { probe } from "./diagnostics.ts";
import type { Mode, Phase, State } from "./diagnostics.ts";

/** One synthetic chain of carbons centred on x, owned by @molgpu/table. */
const cluster = (x: number, radius: number, count = 3): StructureData =>
  createStructure({
    positions: Float32Array.from(
      { length: count * 3 },
      (_, i) => i % 3 === 0 ? x + (Math.floor(i / 3) - (count - 1) / 2) * 3 : 0,
    ),
    topology: {
      atoms: {
        count,
        id: Array.from({ length: count }, (_, i) => String(i + 1)),
        name: Array.from({ length: count }, (_, i) => `C${i + 1}`),
        altloc: new Array(count).fill(""),
        residue: new Uint32Array(count),
        element: new Uint8Array(count).fill(6),
        occupancy: new Float32Array(count).fill(1),
        bfactor: new Float32Array(count),
        radius: new Float32Array(count).fill(radius),
      },
      residues: {
        count: 1,
        chain: new Uint32Array(1),
        labelSeq: new Int32Array([1]),
        authSeq: ["1"],
        insertionCode: [""],
        comp: ["GLY"],
        polymer: ["protein"],
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
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
        ]),
      },
    },
  });

const emptyStructure = (): StructureData =>
  createStructure({
    positions: new Float32Array(),
    topology: {
      atoms: {
        count: 0,
        id: [],
        name: [],
        altloc: [],
        residue: new Uint32Array(),
        element: new Uint8Array(),
        occupancy: new Float32Array(),
        bfactor: new Float32Array(),
        radius: new Float32Array(),
      },
      residues: {
        count: 0,
        chain: new Uint32Array(),
        labelSeq: new Int32Array(),
        authSeq: [],
        insertionCode: [],
        comp: [],
        polymer: [],
      },
      chains: { count: 0, model: new Int32Array(), labelId: [], authId: [] },
      bonds: {
        count: 0,
        a: new Uint32Array(),
        b: new Uint32Array(),
        order: new Uint8Array(),
        source: [],
      },
      instances: {
        count: 0,
        chain: new Uint32Array(),
        operatorId: [],
        transform: new Float64Array(),
      },
    },
  });

const left = cluster(-13, 1.8),
  right = cluster(7, 3.2),
  blank = emptyStructure();

/** Hands each in-flight request to the test instead of resolving it. */
const controlledLoader: StructureLoader = (src, cancelled) =>
  new Promise<StructureData | null>((settle) => {
    probe.pending.push({ src, cancelled, settle });
  });

probe.settle = (index, which) => {
  const request = probe.pending[index];
  if (!request) throw new Error(`No pending load at ${index}`);
  const cancelled = request.cancelled();
  // Mirror the default loader: a cancelled request must resolve to null.
  request.settle(
    cancelled
      ? null
      : which === "right"
      ? right
      : which === "left"
      ? left
      : null,
  );
  return cancelled;
};

probe.invalid = () =>
  ([
    { data: left, src: "/1crn.bcif" },
    {},
    { src: 42 },
    { src: "/1crn.bcif", loader: "nope" },
  ] as unknown[] as StructureProps[]).map((props) => {
    try {
      (Structure as (p: StructureProps) => unknown)(props);
      return "accepted";
    } catch (failure) {
      return String(failure);
    }
  });

const report = (next: Phase, failure: unknown = null): null => {
  // Keep the transitions, not just the resting state: a fast load would
  // otherwise make the loading prop unobservable from the test.
  if (probe.phase !== next) probe.history.push(next);
  probe.phase = next;
  probe.failure = failure === null ? null : String(failure);
  return null;
};

/** Reports readiness from inside the loaded subtree, then draws it. */
const Ready = (): LiveElement => {
  probe.atoms = useStructureResource().data.topology.atoms.count;
  return [report("ready"), <Spacefill />];
};

const Scene = ({ mode, src }: { mode: Mode; src: string }): LiveElement => {
  if (mode === "preloaded") {
    return (
      <Structure data={left}>
        <Spacefill />
      </Structure>
    );
  }
  if (mode === "empty") {
    return (
      <Structure data={blank}>
        <Spacefill />
      </Structure>
    );
  }
  // Two sibling structures. Each <Spacefill> must read its own nearest
  // <Structure>, so the clusters differ in radius as well as in position.
  if (mode === "siblings") {
    return [
      <Structure data={left}>
        <Spacefill />
      </Structure>,
      <Structure data={right}>
        <Spacefill />
      </Structure>,
    ];
  }
  return mode === "controlled"
    ? (
      <Structure
        src={src}
        loader={controlledLoader}
        loading={() => report("loading")}
        error={(f: unknown) => report("error", f)}
      >
        <Ready />
      </Structure>
    )
    : (
      <Structure
        src={src}
        loading={() => report("loading")}
        error={(f: unknown) => report("error", f)}
      >
        <Ready />
      </Structure>
    );
};

const App = (): LiveElement => {
  const [state, setState] = useState<State>({
    mode: "preloaded",
    src: "",
    mounted: true,
  });
  probe.update = (patch) => setState((previous) => ({ ...previous, ...patch }));
  probe.mounted = true;
  // 1CRN's own centre, so the loaded protein is framed rather than clipped.
  const protein = useOne<[number, number, number]>(() => [10.59, 10.21, 6.08]);
  const remote = state.mode === "remote" || state.mode === "missing" ||
    state.mode === "controlled";
  return (
    // bearing 0 keeps both sibling structures the same distance from the
    // camera, so their on-screen sizes compare their radii and nothing else.
    <OrbitCamera
      radius={remote ? 58 : 46}
      bearing={0}
      pitch={0.25}
      target={state.mode === "remote" ? protein : [0, 0, 0]}
    >
      <Pass lights={true}>
        <AmbientLight color={[1, 1, 1]} intensity={0.4} />
        <DirectionalLight
          position={[1, 2, 1.5]}
          color={[1, 1, 1]}
          intensity={1}
        />
        {state.mounted
          ? (
            <Molecule>
              <Scene mode={state.mode} src={state.src} />
            </Molecule>
          )
          : null}
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
