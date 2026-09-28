import { render, use } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
  useDeviceContext,
} from "@use-gpu/workbench";
import {
  activeAtoms,
  secondaryStructureTrace,
  traceTable,
} from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import { Ribbon, Structure } from "../src/index.ts";
import { Viewer } from "molstar/lib/apps/viewer/app.js";

const id = new URLSearchParams(location.search).get("id") ?? "1crn";
const bytes = new Uint8Array(
  await (await fetch(`/packages/io/test/fixtures/${id}.bcif`)).arrayBuffer(),
);
const data = await structureFromBcif(bytes);
const selection = activeAtoms(data);
const trace = traceTable(data, selection);
// For NMR ensembles the table stores every model. Frame the selected trace,
// which is the first model that both viewers actually draw.
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < trace.guide.length; i++) {
  const axis = i % 3;
  min[axis] = Math.min(min[axis], trace.guide[i]);
  max[axis] = Math.max(max[axis], trace.guide[i]);
}
const bounds = { min, max, center: min.map((v, i) => (v + max[i]) / 2) };
const extent = Math.max(...max.map((v, i) => v - min[i]));
const ss = secondaryStructureTrace(data, selection, trace);
const cartoon = globalThis.__cartoonCompare = {
  id,
  atoms: data.positions.length / 3,
  residues: trace.residue.length,
  runs: trace.runs.length - 1,
  secondaryStructure: {
    helix: ss.kind.filter((kind) => kind === "helix").length,
    sheet: ss.kind.filter((kind) => kind === "sheet").length,
    coil: ss.kind.filter((kind) => kind === "coil").length,
  },
  errors: [],
  ready: false,
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
        use(Structure, {
          data,
          children: use(Ribbon, { color: [0.86, 0.55, 0.35, 1] }),
        }),
      ],
    }),
  });
};

const model = render(use(WebGPU, {
  fallback: (error) => {
    cartoon.errors.push(String(error));
    return null;
  },
  children: use(AutoCanvas, {
    selector: "#molgpu",
    samples: 1,
    backgroundColor: [0.06, 0.09, 0.13, 1],
    children: use(App, {}),
  }),
}));

try {
  const viewer = await Viewer.create("molstar", {
    layoutIsExpanded: false,
    layoutShowControls: false,
    layoutShowSequence: false,
    layoutShowLog: false,
    layoutShowLeftPanel: false,
    viewportBackgroundColor: "#0f1722",
    illumination: false,
  });
  await viewer.loadStructureFromData(bytes, "mmcif", { dataLabel: id });
  cartoon.molstarRepresentations = [...viewer.plugin.state.data.cells.values()]
    .flatMap((cell) => {
      const type = cell.params?.values?.type?.name;
      return type ? [{ label: cell.obj?.label, type }] : [];
    });
  // The viewer preset auto-focuses in its own orientation. Compare the same
  // structure from the same world-space view as our OrbitCamera instead.
  const camera = viewer.plugin.canvas3d.camera;
  camera.setState({
    ...camera.getSnapshot(),
    mode: "perspective",
    fov: Math.PI / 3,
    target: [...bounds.center],
    position: [
      bounds.center[0],
      bounds.center[1],
      bounds.center[2] + extent * 1.6,
    ],
    up: [0, 1, 0],
  }, 0);
  cartoon.camera = { target: bounds.center, radius: extent * 1.6 };
  cartoon.ready = true;
} catch (error) {
  cartoon.errors.push(String(error));
  throw error;
}
