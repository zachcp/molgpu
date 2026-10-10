// hj0.4 browser proof: a <Label> anchored to a selection's centroid and a
// <Distance> between two selections' centroids render in a real WebGPU scene
// (text via a FontLoader, the connector via a LineLayer) with no WebGPU errors,
// and re-anchor when the selection changes.
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
import { createStructure } from "@molgpu/table";
import { resolve, where } from "@molgpu/select";
import { Distance, Label, Spacefill, Structure } from "../src/index.ts";
import { centroidOf } from "../src/representations/centroid.ts";

const probe = globalThis.__probe = {
  storage: 0,
  textures: 0,
  pipelines: 0,
  errors: [],
  mounted: false,
  centroidA: null,
  distance: null,
};
const makeBuffer = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function (desc) {
  const buffer = makeBuffer.call(this, desc);
  if (desc.usage & GPUBufferUsage.STORAGE) probe.storage += 1;
  return buffer;
};
const makeTexture = GPUDevice.prototype.createTexture;
GPUDevice.prototype.createTexture = function (desc) {
  probe.textures += 1;
  return makeTexture.call(this, desc);
};
for (const name of ["createRenderPipeline", "createRenderPipelineAsync"]) {
  const original = GPUDevice.prototype[name];
  GPUDevice.prototype[name] = function (...args) {
    probe.pipelines += 1;
    return original.apply(this, args);
  };
}
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = await request.apply(this, args);
  device.addEventListener(
    "uncapturederror",
    (e) => probe.errors.push(e.error.message),
  );
  return device;
};

// Two atom pairs, far apart: centroid A = (-3,1,0), centroid B = (3,1,0), 6 Å apart.
const data = createStructure({
  positions: Float32Array.from([-3, 0, 0, -3, 2, 0, 3, 0, 0, 3, 2, 0]),
  topology: {
    atoms: {
      count: 4,
      id: ["1", "2", "3", "4"],
      name: ["C1", "C2", "C3", "C4"],
      altloc: ["", "", "", ""],
      residue: Uint32Array.of(0, 0, 1, 1),
      element: new Uint8Array([6, 6, 6, 6]),
      occupancy: new Float32Array(4).fill(1),
      bfactor: new Float32Array(4),
      radius: new Float32Array(4).fill(1.5),
    },
    residues: {
      count: 2,
      chain: Uint32Array.of(0, 0),
      labelSeq: Int32Array.of(1, 2),
      authSeq: ["1", "2"],
      insertionCode: ["", ""],
      comp: ["ALA", "ALA"],
      polymer: ["protein", "protein"],
    },
    chains: {
      count: 1,
      model: Int32Array.of(1),
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
      operatorId: ["1"],
      transform: Float64Array.of(
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
      ),
    },
  },
});
const selA = where("atom", "a", (_d, i) => i < 2); // rows 0,1
const selB = where("atom", "b", (_d, i) => i >= 2); // rows 2,3
probe.centroidA = centroidOf(data, resolve(selA, data).indices);
probe.distance = Math.hypot(
  ...centroidOf(data, resolve(selA, data).indices).map((v, i) =>
    v - centroidOf(data, resolve(selB, data).indices)[i]
  ),
);

// ?assembly: a second copy 6 Å along +x (molgpu-sept-fch.5), so the label
// on selection A (x = -3) also draws at x = +3.
const params = new URLSearchParams(location.search);
// ?assembly-split: chain A = rows 0-1, chain B = rows 2-3; operator 2 copies
// chain B only, 12 Å along -x, so a label on A draws once and one on B twice.
const split = params.has("assembly-split")
  ? createStructure({
    positions: data.positions,
    topology: {
      ...data.topology,
      residues: { ...data.topology.residues, chain: Uint32Array.of(0, 1) },
      chains: {
        count: 2,
        model: Int32Array.of(1, 1),
        labelId: ["A", "B"],
        authId: ["A", "B"],
      },
      instances: {
        count: 3,
        chain: Uint32Array.of(0, 1, 1),
        operatorId: ["1", "1", "2"],
        transform: Float64Array.from([
          ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -12, 0, 0, 1],
        ]),
      },
    },
  })
  : null;
const shown = split ?? (params.has("assembly")
  ? createStructure({
    positions: data.positions,
    topology: {
      ...data.topology,
      instances: {
        count: 2,
        chain: Uint32Array.of(0, 0),
        operatorId: ["1", "2"],
        transform: Float64Array.from([
          ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 6, 0, 0, 1],
        ]),
      },
    },
  })
  : data);

const Scene = ({ labelSel }) =>
  use(OrbitCamera, {
    radius: 20,
    target: [0, 1, 0],
    children: use(Pass, {
      lights: true,
      children: [
        use(AmbientLight, { intensity: 0.3 }),
        use(DirectionalLight, { direction: [-1, -2, -1.5], intensity: 1 }),
        use(Structure, {
          data: shown,
          children: [
            use(Spacefill, { scale: 0.5 }),
            use(Label, {
              select: labelSel,
              text: "site",
              size: 24,
              color: [1, 1, 0, 1],
            }),
            use(Distance, {
              a: selA,
              b: selB,
              format: (d) => d.toFixed(0),
              size: 20,
            }),
          ],
        }),
      ],
    }),
  });

const App = () => {
  useDeviceContext();
  const [labelSel, setLabelSel] = useState(selA);
  probe.setLabel = (which) => setLabelSel(which === "b" ? selB : selA);
  probe.mounted = true;
  return use(Scene, { labelSel });
};

// Text needs both the Rust shaper (FontLoader -> FontContext) and the glyph
// atlas (SDFFontProvider -> SDFFontContext, which owns a GPU texture, so it
// lives inside the canvas).
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
