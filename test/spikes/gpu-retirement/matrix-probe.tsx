// Retirement matrix: public providers with a separately suspended sibling.
import { React, render, unmount, useMemo, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
  RawFaces,
  useDeviceContext,
} from "@use-gpu/workbench";
import {
  createStructure,
  createTrajectory,
  type StructureData,
} from "@molgpu/table";
import { resolve, where } from "@molgpu/select";
import { attribute, bySecondaryStructure, categorical } from "@molgpu/fields";
import { structureFromBcif } from "@molgpu/io";
import {
  GpuDssp,
  NormalMode,
  PickingProvider,
  Spacefill,
  Structure,
  Superpose,
  Trajectory,
  Transform,
  Unwrap,
} from "@molgpu/viewer";
import {
  useCoordinateBounds,
  useCoordinateSnapshot,
} from "@molgpu/viewer/advanced";

void React;
const query = new URLSearchParams(location.search);
const kind = query.get("owner") ?? "transform";
const extraPasses = query.has("passes");
const count = Number(query.get("count") ?? 4);
const crambin = kind === "dssp"
  ? await structureFromBcif(
    new Uint8Array(
      await (await fetch("/packages/io/test/fixtures/1crn.bcif")).arrayBuffer(),
    ),
  )
  : null;
function atoms(
  n: number,
  positions = Float32Array.from(
    { length: n * 3 },
    (_, i) => {
      const row = Math.floor(i / 3);
      return [
        row % 100,
        Math.floor(row / 100) % 100,
        Math.floor(row / 10000),
      ][i % 3] + (row < 4 ? [0, row % 2, row % 3][i % 3] : 0);
    },
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

const shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1];
const box = Float32Array.of(10, 0, 0, 0, 10, 0, 0, 0, 10);
const colors = [
  categorical(attribute("element"), { 6: [1, 0, 0, 1] }, [0, 1, 0, 1]),
  categorical(attribute("bfactor"), { 0: [0, 0, 1, 1] }, [1, 1, 0, 1]),
];
const controls = {
  epoch: (_n: number) => {},
  palette: (_n: number) => {},
  visible: (_b: boolean) => {},
  tick: (_n: number) => {},
  fence: () => Promise.resolve(),
  unmount: () => {},
  snapshots: 0,
  bounds: 0,
  status: 0,
  readyEpoch: -1,
};
Object.assign(globalThis, { __scene: controls });
const Consumers = (
  { expected, epoch }: { expected: number; epoch: number },
) => {
  const snapshot = useCoordinateSnapshot({ maxHz: 60 });
  const bounds = useCoordinateBounds();
  if (snapshot) controls.snapshots++;
  if (bounds) controls.bounds++;
  if (
    snapshot?.data.topology.atoms.count === expected &&
    bounds?.count === expected
  ) controls.readyEpoch = epoch;
  return null;
};
const App = () => {
  const device = useDeviceContext();
  const [epoch, setEpoch] = useState(0);
  const [palette, setPalette] = useState(0);
  const [visible, setVisible] = useState(true);
  const [tick, setTick] = useState(0);
  const data = useMemo(
    () => crambin ?? atoms(count + (query.has("same-size") ? 0 : epoch % 2)),
    [epoch],
  );
  const n = data.topology.atoms.count;
  const trajectory = useMemo(
    () =>
      createTrajectory({
        atomCount: n - 1,
        atomMap: Array.from({ length: n - 1 }, (_, i) => n - i - 1),
        frames: [0, 1].map((k) => ({
          positions: Float32Array.from({ length: (n - 1) * 3 }, (_, i) =>
            i % 3 === 0 ? i / 3 + k : 0),
          box,
        })),
      }),
    [data],
  );
  const mode = useMemo(
    () => ({
      atomToNode: Uint32Array.from({ length: n }, (_, i) => i),
      vectors: new Float32Array(n * 3).fill(epoch ? 0.2 : 0.1),
      version: epoch,
    }),
    [data],
  );
  const selection = useMemo(
    () => resolve(where("atom", "visible-four", (_d, i) => i < 4), data),
    [data],
  );
  Object.assign(controls, {
    epoch: setEpoch,
    palette: setPalette,
    visible: setVisible,
    tick: setTick,
    fence: () => device.queue.onSubmittedWorkDone(),
  });
  const children = (
    <>
      <Spacefill
        pickable={extraPasses}
        shadow={extraPasses}
        select={selection}
        color={kind === "dssp" && !palette
          ? bySecondaryStructure()
          : colors[palette]}
        material={{ type: "basic" }}
      />
      <Consumers expected={n} epoch={epoch} />
    </>
  );
  const provider = kind === "trajectory"
    ? <Trajectory data={trajectory} frame={0.5}>{children}</Trajectory>
    : kind === "normal"
    ? <NormalMode mode={mode} amplitude={1} phase={1}>{children}</NormalMode>
    : kind === "superpose"
    ? (
      <Superpose to={data.positions} onStatus={() => controls.status++}>
        {children}
      </Superpose>
    )
    : kind === "unwrap"
    ? <Unwrap box={box} onStatus={() => controls.status++}>{children}</Unwrap>
    : kind === "dssp"
    ? (
      <GpuDssp
        model={epoch % 2 ? 1 : "first"}
        onStatus={() => controls.status++}
      >
        {children}
      </GpuDssp>
    )
    : kind === "root"
    ? children
    : (
      <Transform
        matrix={shift}
        select={epoch % 2 ? undefined : where("atom", "half", (_d, i) => i < 2)}
      >
        {children}
      </Transform>
    );
  return (
    <OrbitCamera radius={40} bearing={tick * 0.01}>
      <Pass lights picking={extraPasses} shadows={extraPasses}>
        <AmbientLight intensity={0.3} />
        <DirectionalLight
          direction={[-1, -2, -1.5]}
          shadowMap={extraPasses
            ? { resolution: 64, size: [40, 40], depth: [0, 100] }
            : undefined}
        />
        {visible ? <Structure data={data}>{provider}</Structure> : null}
        <RawFaces
          position={[0, 0, 0, 1]}
          count={3}
          shaded={palette > 0}
          side="both"
        />
      </Pass>
    </OrbitCamera>
  );
};
let root: ReturnType<typeof render> | null = render(
  <WebGPU fallback={null}>
    <PickingProvider>
      <AutoCanvas selector="#root" samples={1}>
        <App />
      </AutoCanvas>
    </PickingProvider>
  </WebGPU>,
);
controls.unmount = () => {
  if (root) unmount(root);
  root = null;
  Object.assign(controls, {
    epoch: (_n: number) => {},
    palette: (_n: number) => {},
    visible: (_b: boolean) => {},
    tick: (_n: number) => {},
    fence: () => Promise.resolve(),
  });
};
