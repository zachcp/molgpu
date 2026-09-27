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
import { all, resolve, where } from "@molgpu/select";
import type { StructureData } from "@molgpu/table";
import {
  Bonds,
  Molecule,
  Spacefill,
  Structure,
  useCoordinateBounds,
  useCoordinateFocus,
  useCoordinateSnapshot,
  useStructureResource,
} from "@molgpu/viewer";
import type { StructureLoader, StructureProps } from "@molgpu/viewer";
import {
  IdentityCoordinates,
  useCoordinates,
  useStructure,
} from "@molgpu/viewer/advanced";
import { OffsetCoordinates } from "./offset-coordinates.ts";
import { BondVertexProbe } from "./bond-vertex-probe.ts";
import { probe } from "./diagnostics.ts";
import type { Mode, Phase, State } from "./diagnostics.ts";

/** One synthetic chain of carbons centred on x, owned by @molgpu/table. */
const cluster = (
  x: number,
  radius: number,
  count = 3,
  bonded = false,
): StructureData =>
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
        count: bonded ? count - 1 : 0,
        a: bonded
          ? Uint32Array.from({ length: count - 1 }, (_, i) => i)
          : new Uint32Array(),
        b: bonded
          ? Uint32Array.from({ length: count - 1 }, (_, i) => i + 1)
          : new Uint32Array(),
        order: bonded ? new Uint8Array(count - 1).fill(1) : new Uint8Array(),
        source: bonded ? new Array(count - 1).fill("explicit") : [],
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
  bonded = cluster(-13, 1.8, 3, true),
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

const CoordinateProbe = (): LiveElement => {
  probe.coordinateSource = useCoordinates()?.source ?? null;
  return <Spacefill />;
};

const RootPositionProbe = (): LiveElement => {
  const { resource, sources } = useStructure();
  const read = (value: () => unknown): string => {
    try {
      value();
      return "ok";
    } catch (failure) {
      return String(failure);
    }
  };
  probe.rootPositionReads = {
    cpu: read(() => resource.data.positions),
    gpu: read(() => sources?.positions),
  };
  return null;
};

const SnapshotProbe = (): LiveElement => {
  const snapshot = useCoordinateSnapshot({ maxHz: 4 });
  probe.coordinateBounds = useCoordinateBounds();
  probe.selectedBounds = useCoordinateBounds(FIRST_TWO);
  probe.emptyBounds = useCoordinateBounds(NO_ATOMS);
  const focus = useCoordinateFocus(ALL_ATOMS);
  probe.coordinateFocus = focus &&
    { target: focus.target, radius: focus.radius };
  probe.coordinateSnapshot = snapshot
    ? {
      generation: snapshot.generation,
      revision: snapshot.data.revision.positions,
      positions: Array.from(snapshot.data.positions),
    }
    : null;
  return null;
};

const ALL_ATOMS = all("atom");
const FIRST_TWO = resolve(
  where("atom", "first-two", (_, row) => row < 2),
  bonded,
);
const NO_ATOMS = resolve(where("atom", "none", () => false), bonded);

const Scene = (
  { mode, src, offsetX }: { mode: Mode; src: string; offsetX: number },
): LiveElement => {
  if (mode === "preloaded") {
    return (
      <Structure data={left}>
        <RootPositionProbe />
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
  if (mode === "offset") {
    return (
      <Structure data={left}>
        <OffsetCoordinates offset={[offsetX, 0, 0]}>
          <IdentityCoordinates>
            <OffsetCoordinates offset={[-2, 1, 0]}>
              <RootPositionProbe />
              <CoordinateProbe />
            </OffsetCoordinates>
          </IdentityCoordinates>
        </OffsetCoordinates>
      </Structure>
    );
  }
  if (mode === "bonds") {
    return (
      <Structure data={bonded}>
        <OffsetCoordinates offset={[offsetX, 0, 0]}>
          <IdentityCoordinates>
            <OffsetCoordinates offset={[-2, 1, 0]}>
              <Bonds width={0.8} />
              <BondVertexProbe data={bonded} />
            </OffsetCoordinates>
          </IdentityCoordinates>
        </OffsetCoordinates>
      </Structure>
    );
  }
  if (mode === "snapshot") {
    return (
      <Structure data={bonded}>
        <OffsetCoordinates offset={[offsetX, 0, 0]}>
          <IdentityCoordinates>
            <OffsetCoordinates offset={[-2, 1, 0]}>
              <SnapshotProbe />
            </OffsetCoordinates>
          </IdentityCoordinates>
        </OffsetCoordinates>
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
    offsetX: 5,
  });
  try {
    useCoordinates();
    probe.missingCoordinatesError = null;
  } catch (failure) {
    probe.missingCoordinatesError = String(failure);
  }
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
              <Scene
                mode={state.mode}
                src={state.src}
                offsetX={state.offsetX}
              />
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
