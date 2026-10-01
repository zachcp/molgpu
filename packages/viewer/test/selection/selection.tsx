import {
  type LC,
  provide,
  React,
  render,
  use,
  useMemo,
  useResource,
  useState,
} from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  OrbitCamera,
  Pass,
  useDeviceContext,
} from "@use-gpu/workbench";
import {
  all,
  allConformers,
  allModels,
  and,
  attribute,
  comp,
  model,
  resolve,
  type SelectionQuery,
  where,
  within,
} from "@molgpu/select";
import { createTrajectory, withAttributes, withPositions } from "@molgpu/table";
import {
  Distance,
  EField,
  Label,
  type SelectionStatus,
  Spacefill,
  Structure,
  Superpose,
  Transform,
  Unwrap,
  useCoordinateFocus,
} from "@molgpu/viewer";
import { useCoordinates, useStructureResource } from "@molgpu/viewer/advanced";
import { AttributesContext } from "../../src/attributes-context.ts";
import { AttributeSnapshotContext } from "../../src/attribute-snapshot-context.ts";
import { CoordinateSnapshotContext } from "../../src/coordinate-snapshot.ts";
import { selectionData } from "../fixtures/selection-data.ts";
import { TestAttributeProducer } from "../tsx/test-attribute-producer.ts";
import { useSelectionInput } from "../../src/internal/use-selection-input.ts";
import { AcceptanceScene } from "../tsx/ordinary-jsx-spike.tsx";
import { structureFromBcif } from "@molgpu/io";
void React;

const data = selectionData();
const other = selectionData();
const resized = selectionData(true);
const foreign = resolve(all(), other);
const fixed = resolve(all(), data);
const stale = { ...fixed, deps: { ...fixed.deps, topology: -1 } };
const queries: Record<string, SelectionQuery> = {
  default: all(),
  model2: model(2),
  all: and(allModels(), allConformers()),
  empty: where("atom", "intentional-empty", () => false, ["topology"]),
  bad: where("atom", "throws", () => {
    throw new Error("predicate exploded");
  }, ["topology"]),
  position: where("atom", "moved", (d, row) => d.positions[row * 3] > 50, [
    "positions",
  ]),
  attr: attribute("gpu:a", (value) => value >= 1 && value <= 2),
  combined: within(2, attribute("gpu:a", (value) => value === 2)),
  opaque: where("atom", "opaque", () => true, ["attributes"]),
  site: within(1, comp(["HEM"])),
};
interface State {
  mode: string;
  mounted: boolean;
  coordinates: boolean;
  attributes: boolean;
  generation: number;
  publication: number;
  source: number;
  replacement: boolean;
  warn: boolean;
  acceptance: boolean;
  real: boolean;
  phase: number;
  resize: boolean;
}
const initial: State = {
  mode: "default",
  mounted: true,
  coordinates: false,
  attributes: false,
  generation: 1,
  publication: 1,
  source: 0,
  replacement: false,
  warn: false,
  acceptance: false,
  real: false,
  phase: 0,
  resize: false,
};
const probe = {
  statuses: {} as Record<string, SelectionStatus>,
  events: [] as { name: string; status: SelectionStatus }[],
  subscriptions: { coordinates: 0, a: 0, b: 0 },
  warnings: [] as string[],
  errors: [] as string[],
  focus: null as unknown,
  rows: [] as number[],
  hold: false,
  maps: [] as (() => Promise<void>)[],
  release: async () => {},
  drain: async () => {},
  set: (_patch: Partial<State>) => {},
};
Object.assign(globalThis, { __selection: probe });
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  probe.warnings.push(args.map(String).join(" "));
  warn(...args);
};
const record = (name: string) => (status: SelectionStatus) => {
  probe.statuses[name] = status;
  probe.events.push({ name, status });
};
const callbacks = Object.fromEntries(
  [
    "main",
    "sibling",
    "nested",
    "transform",
    "superpose",
    "center",
    "field",
    "label",
    "distance",
    "focus",
    "acceptance",
    "real",
  ].map((name) => [name, record(name)]),
);
const Focus: LC<{ input: SelectionQuery }> = ({ input }) => {
  probe.focus = useCoordinateFocus(input, {
    onSelectionStatus: callbacks.focus,
  });
  return null;
};

const Controlled: LC<{ state: State }> = ({ state }) => {
  const root = useStructureResource();
  const upstream = useCoordinates()!;
  const device = useDeviceContext();
  const size = root.data.topology.atoms.count;
  const buffers = useMemo(
    () =>
      [0, 1, 2].map(() =>
        device.createBuffer({
          size: Math.max(32, size * 12),
          usage: 0x80 | 0x04,
        })
      ),
    [root, state.source],
  );
  useResource((dispose) =>
    dispose(() => {
      for (const buffer of buffers) buffer.destroy();
    }), [buffers]);
  const layout = useMemo(() => ({}), [root, state.source]);
  const subscribe = useMemo(() => ({
    coordinates: () => {
      probe.subscriptions.coordinates++;
      return () => {
        probe.subscriptions.coordinates--;
      };
    },
    a: () => {
      probe.subscriptions.a++;
      return () => {
        probe.subscriptions.a--;
      };
    },
    b: () => {
      probe.subscriptions.b++;
      return () => {
        probe.subscriptions.b--;
      };
    },
  }), []);
  const positions = useMemo(() => {
    const moved = new Float32Array(root.data.positions);
    for (let row = 0; row < root.data.topology.atoms.count; row++) {
      moved[row * 3] += 100;
    }
    return withPositions(root.data, moved);
  }, [root, state.publication]);
  const columnData = useMemo(() =>
    withAttributes(root.data, {
      "gpu:a": {
        domain: "atom",
        kind: "scalar",
        provenance: "gpu:test",
        values: Float32Array.from({ length: size }, (_, row) => row),
      },
      "gpu:b": {
        domain: "atom",
        kind: "scalar",
        provenance: "gpu:test",
        values: new Float32Array(size),
      },
    }), [root, state.publication]);
  const token = (buffer: GPUBuffer) => ({
    owner: root,
    buffer,
    bytes: size * 4,
    layout,
    generation: state.generation,
  });
  const coordinateContext = {
    token: { ...token(buffers[0]), bytes: size * 12 },
    snapshot: state.coordinates
      ? { data: positions, generation: state.publication, resource: root }
      : null,
    subscribe: subscribe.coordinates,
  };
  const attributes = {
    "gpu:a": {
      domain: "atom" as const,
      kind: "scalar" as const,
      provenance: "gpu:test" as const,
      generation: state.generation,
      source: { ...upstream.source, buffer: buffers[1], length: size },
    },
    "gpu:b": {
      domain: "atom" as const,
      kind: "scalar" as const,
      provenance: "gpu:test" as const,
      generation: state.generation,
      source: { ...upstream.source, buffer: buffers[2], length: size },
    },
  };
  const snapshots = {
    "gpu:a": {
      token: token(buffers[1]),
      snapshot: state.attributes
        ? { data: columnData, generation: state.publication }
        : null,
      subscribe: subscribe.a,
    },
    "gpu:b": {
      token: token(buffers[2]),
      snapshot: state.attributes
        ? { data: columnData, generation: state.publication }
        : null,
      subscribe: subscribe.b,
    },
  };
  const input = state.mode === "fixed"
    ? fixed
    : state.mode === "foreign"
    ? foreign
    : state.mode === "stale"
    ? stale
    : queries[state.mode];
  const diagnostics = {
    onSelectionStatus: callbacks.main,
    warnEmptySelection: state.warn,
  };
  return provide(
    CoordinateSnapshotContext,
    coordinateContext,
    provide(
      AttributesContext,
      attributes,
      provide(AttributeSnapshotContext, snapshots, [
        use(Spacefill, { select: input, ...diagnostics }),
        use(Spacefill, {
          select: allQuery,
          onSelectionStatus: callbacks.sibling,
          scale: 0.1,
        }),
        use(Transform, {
          matrix: identity,
          select: input,
          onSelectionStatus: callbacks.transform,
          children: null,
        }),
        use(Superpose, {
          to: root.data.positions,
          select: input,
          onSelectionStatus: callbacks.superpose,
          children: null,
        }),
        use(Unwrap, {
          box: [20, 0, 0, 0, 20, 0, 0, 0, 20],
          center: input,
          onSelectionStatus: callbacks.center,
          children: null,
        }),
        // Empty/failed labels and EField gate before needing fonts or charges.
        state.mode === "empty" || state.mode === "bad"
          ? [
            use(Label, { select: input, onSelectionStatus: callbacks.label }),
            use(Distance, {
              a: input,
              b: input,
              onSelectionStatus: callbacks.distance,
            }),
            use(EField, { select: input, onSelectionStatus: callbacks.field }),
          ]
          : null,
        use(Focus, { input: queries[state.mode] ?? allQuery }),
        use(Structure, {
          data: other,
          children: use(Spacefill, {
            select: allQuery,
            onSelectionStatus: callbacks.nested,
            scale: 0.1,
          }),
        }),
      ]),
    ),
  );
};
const allQuery = all();
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const loaded = structureFromBcif("/packages/io/test/fixtures/1crn.bcif").then(
  (d) =>
    withAttributes(d, {
      partialCharge: {
        domain: "atom",
        kind: "scalar",
        provenance: "user",
        values: new Float32Array(d.topology.atoms.count).fill(0.01),
      },
    }),
);
const loader = () => loaded;
const trajectoryLoader = async () => {
  const d = await loaded;
  return createTrajectory({
    atomCount: d.topology.atoms.count,
    frames: [{ positions: d.positions }],
  });
};
const shifted = [...identity];
shifted[12] = 100;
const Rows: LC = () => {
  const result = useSelectionInput(queries.combined, "GPU rows");
  probe.rows = result.status === "ready" ? [...result.selection.indices] : [];
  return null;
};
const actualMap = GPUBuffer.prototype.mapAsync;
GPUBuffer.prototype.mapAsync = function (mode, offset, size) {
  if (
    probe.hold &&
    (this.label === "molgpu:coords:snapshot" ||
      this.label === "molgpu:attr:snapshot:gpu:a")
  ) {
    return new Promise<void>((resolve, reject) =>
      probe.maps.push(() => {
        return actualMap.call(this, mode, offset, size).then(resolve, reject);
      })
    );
  }
  return actualMap.call(this, mode, offset, size);
};
probe.release = async () => {
  const held = probe.maps.splice(0);
  await Promise.all(held.map((map) => map()));
};

const App: LC = () => {
  const device = useDeviceContext();
  probe.drain = () => device.queue.onSubmittedWorkDone();
  useResource(() => {
    device.addEventListener(
      "uncapturederror",
      (event) => probe.errors.push(event.error.message),
    );
  }, [device]);
  const [state, setState] = useState(initial);
  probe.set = (patch) => setState((previous) => ({ ...previous, ...patch }));
  return use(OrbitCamera, {
    radius: 30,
    children: use(Pass, {
      lights: true,
      children: [
        use(AmbientLight, { intensity: 1 }),
        state.mounted
          ? use(Structure, {
            data: state.resize ? resized : state.replacement ? other : data,
            children: use(Controlled, { state }),
          })
          : null,
        state.real
          ? use(Structure, {
            data: state.resize ? resized : data,
            children: use(Transform, {
              matrix: shifted,
              children: use(TestAttributeProducer, {
                phase: state.phase,
                name: "gpu:a",
                children: [
                  use(Spacefill, {
                    select: queries.combined,
                    onSelectionStatus: callbacks.real,
                  }),
                  use(Rows, {}),
                ],
              }),
            }),
          })
          : null,
        state.acceptance
          ? use(AcceptanceScene, {
            src: "fixture.bcif",
            trajectorySrc: "fixture.dcd",
            loader,
            trajectoryLoader,
            frame: 0,
            onSelectionStatus: callbacks.acceptance,
          })
          : null,
      ],
    }),
  });
};
render(
  <WebGPU
    fallback={(error: Error) => {
      probe.errors.push(error.message);
      return null;
    }}
  >
    <AutoCanvas selector="#canvas" samples={1}>
      <App />
    </AutoCanvas>
  </WebGPU>,
);
