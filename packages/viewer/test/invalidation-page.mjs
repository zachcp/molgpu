// X2 invalidation/resource audit page (driven by run-invalidation.mjs).
//
// The runner sets a JSON scene state { mounted, dataKey, time, reps: [{ kind,
// props }] }. Prop values are interned by their JSON, so a value the runner
// leaves unchanged keeps its object identity across updates: only the edited
// prop is new, exactly as in an app that edits one prop. String tokens name
// non-JSON values (selections, colour fields).
//
// Components are imported from their own modules (not ../src/index.mjs) and
// the counters from the internal instrumentation module, which is not public.
import { render, use, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  FontLoader,
  OrbitCamera,
  Pass,
  SDFFontProvider,
  useDeviceContext,
} from "@use-gpu/workbench";
import {
  attributeColumn,
  bondTopology,
  coordinateBounds,
  createStructure,
  ssKind,
  withAttributes,
  withPositions,
} from "@molgpu/table";
import { resolve, where } from "@molgpu/select";
import { byElement, colormap, curve } from "@molgpu/fields";
import { structureFromBcif } from "@molgpu/io";
import { Structure } from "../src/structure.ts";
import { Spacefill } from "../src/spacefill.ts";
import { Bonds } from "../src/bonds.ts";
import { BallAndStick } from "../src/ball-and-stick.ts";
import { Tube } from "../src/tube.ts";
import { Ribbon } from "../src/ribbon.ts";
import { Surface } from "../src/surface.ts";
import { Distance, Label } from "../src/annotations.ts";
import { TimelineProvider } from "../src/timeline-context.ts";
import {
  deviceBufferOrigins,
  enableInstrumentation,
  instrumentDevice,
  resetCounters,
  snapshotCounters,
} from "../src/internal/instrumentation.ts";

enableInstrumentation();
const probe = window.__inv = { errors: [], mounted: false, renders: 0 };
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = instrumentDevice(await request.apply(this, args));
  device.addEventListener(
    "uncapturederror",
    (e) => probe.errors.push(e.error.message),
  );
  return device;
};

// 1crn (crambin, 327 atoms, one chain with helices and a sheet). The base
// dataset carries EXPLICIT bonds (table's inference, frozen as explicit), so a
// coordinate edit has no connectivity-dependent topology work to do.
const bytes = new Uint8Array(
  await (await fetch("/packages/io/test/fixtures/1crn.bcif")).arrayBuffer(),
);
const raw = await structureFromBcif(bytes);
const withBonds = (data, keep) => {
  const inferred = bondTopology(raw);
  const rows = [...Array(inferred.count).keys()].filter(keep);
  // createStructure keeps only topology; carry io's derived columns across.
  return withAttributes(
    createStructure({
      positions: data.positions,
      topology: {
        ...data.topology,
        bonds: {
          count: rows.length,
          a: Uint32Array.from(rows, (r) => inferred.a[r]),
          b: Uint32Array.from(rows, (r) => inferred.b[r]),
          order: new Uint8Array(rows.length).fill(1),
          source: rows.map(() => "explicit"),
        },
      },
    }),
    data.attributes ?? {},
  );
};
const base = withBonds(raw, () => true);
const moved = withPositions(
  base,
  base.positions.map((v, i) => v + (i % 3 === 0 ? 0.25 : -0.1)),
);
// Connectivity change: a new topology (every other bond dropped), same atoms.
const rebonded = withBonds(raw, (r) => r % 2 === 0);
// Inferred connectivity (no explicit bonds): bonds follow coordinates. A small
// nudge keeps every bond; pulling atom 0 far away breaks its bonds, so the
// endpoint rows (and the attribute columns gathered for them) must change.
const inferred = createStructure({
  positions: raw.positions,
  topology: {
    ...raw.topology,
    bonds: {
      count: 0,
      a: new Uint32Array(),
      b: new Uint32Array(),
      order: new Uint8Array(),
      source: [],
    },
  },
});
const nudged = withPositions(inferred, inferred.positions.map((v) => v + 0.01));
const pulled = withPositions(
  inferred,
  inferred.positions.map((v, i) => i < 3 ? v + 50 : v),
);
// Attribute edits: a new StructureData with base's topology and positions.
// `charged` adds an unrelated column; `ssSame` rewrites ssCode without moving
// its cartoon projection (coil -> T, H -> G); `ssCoil` makes everything coil.
const ss = attributeColumn(base, "ssCode").values;
const ssColumn = (values) => ({
  ssCode: {
    domain: "residue",
    kind: "code",
    provenance: "computed:test",
    values,
  },
});
const charged = withAttributes(base, {
  "user:test": {
    domain: "atom",
    kind: "scalar",
    provenance: "user",
    values: new Float32Array(base.topology.atoms.count),
  },
});
const ssSame = withAttributes(
  base,
  ssColumn(Uint8Array.from(ss, (c) => c === 0 ? 6 : c === 1 ? 4 : c)),
);
if (!ss.some((c) => ssKind(c) !== "coil")) throw new Error("1crn has no SS");
const ssCoil = withAttributes(base, ssColumn(new Uint8Array(ss.length)));
const DATA = {
  base,
  moved,
  rebonded,
  inferred,
  nudged,
  pulled,
  charged,
  ssSame,
  ssCoil,
};

// Selections resolve per dataset identity; `moved` shares base's identity.
const residueRange = (label, lo, hi) =>
  where("atom", label, (d, i) => {
    const r = d.topology.atoms.residue[i];
    return r >= lo && r < hi && !d.topology.atoms.altloc[i];
  });
const QUERIES = {
  A: residueRange("A", 0, 20),
  B: residueRange("B", 10, 40),
  C: residueRange("C", 30, 46),
};
const selections = new Map();
const selectionFor = (key, data) => {
  const id = `${key}@${data === rebonded ? "rebonded" : "base"}`;
  if (!selections.has(id)) selections.set(id, resolve(QUERIES[key], data));
  return selections.get(id);
};
// Churn selections: many distinct residue windows.
for (let k = 0; k < 64; k++) {
  QUERIES[`W${k}`] = residueRange(`W${k}`, k % 40, (k % 40) + 1 + (k % 7));
}

// Colour fields: two distinct instances of the same element field (a field
// swap that reads the same columns), and a clock-driven field (curve:t).
const FIELDS = {
  "field:element": byElement(),
  "field:element2": byElement(),
  "field:clock": colormap(curve([[0, 0], [1, 1]]), [[0, [0.2, 0.4, 0.9, 1]], [
    1,
    [0.9, 0.3, 0.2, 1],
  ]]),
};

const interned = new Map();
const intern = (value) => {
  if (value === null || typeof value !== "object") return value;
  const key = JSON.stringify(value);
  if (!interned.has(key)) interned.set(key, value);
  return interned.get(key);
};
const resolveProps = (props, data) =>
  Object.fromEntries(
    Object.entries(props).map(([name, value]) => {
      if (
        (name === "select" || name === "a" || name === "b") &&
        typeof value === "string"
      ) return [name, selectionFor(value, data)];
      if (typeof value === "string" && value in FIELDS) {
        return [name, FIELDS[value]];
      }
      return [name, intern(value)];
    }),
  );

const KINDS = {
  spacefill: Spacefill,
  bonds: Bonds,
  ballAndStick: BallAndStick,
  tube: Tube,
  ribbon: Ribbon,
  surface: Surface,
  label: Label,
  distance: Distance,
};

const bounds = coordinateBounds(base);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));

const Scene = () => {
  const [state, setState] = useState({
    mounted: false,
    dataKey: "base",
    time: 0,
    reps: [],
  });
  probe.set = (next) => setState(next);
  probe.mounted = true;
  probe.renders += 1;
  const data = DATA[state.dataKey];
  const children = state.reps.map(({ kind, props }) =>
    use(KINDS[kind], resolveProps(props, data))
  );
  return use(TimelineProvider, {
    time: state.time,
    children: state.mounted ? use(Structure, { data, children }) : null,
  });
};

const App = () => {
  useDeviceContext();
  return use(OrbitCamera, {
    radius: extent * 1.6,
    target: bounds.center,
    children: use(Pass, {
      lights: true,
      children: [
        use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
        use(DirectionalLight, {
          position: [1, 2, 1.5],
          color: [1, 1, 1],
          intensity: 1,
        }),
        use(Scene, {}),
      ],
    }),
  });
};

probe.reset = () => resetCounters();
probe.snapshot = () => ({ ...snapshotCounters(), errors: [...probe.errors] });
probe.origins = () => deviceBufferOrigins();

render(use(WebGPU, {
  fallback: (e) => {
    probe.errors.push(String(e));
    return null;
  },
  children: use(FontLoader, {
    fonts: [{
      family: "sans",
      style: "normal",
      weight: 400,
      src: "/site/assets/font.ttf",
    }],
    children: use(AutoCanvas, {
      selector: "#stage",
      samples: 1,
      backgroundColor: [0, 0, 0, 1],
      children: use(SDFFontProvider, { children: use(App, {}) }),
    }),
  }),
}));
