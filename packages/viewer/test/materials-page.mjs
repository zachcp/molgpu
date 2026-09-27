// hj0.1 browser proof: a representation wrapped in each @molgpu/viewer material
// draws under the viewer's own light wrappers with no WebGPU errors; switching
// material type at runtime compiles a new render pipeline (so the material
// really reaches the shaded layer) without rebuilding geometry buffers.
import { render, use, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
  useDeviceContext,
} from "@use-gpu/workbench";
import { createStructure } from "@molgpu/table";
import { Spacefill, Structure } from "../src/index.ts";

const probe = globalThis.__probe = {
  storage: [],
  storageBuffers: [],
  pipelines: 0,
  errors: [],
  mounted: false,
};
const storageInfo = new WeakMap();
const make = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function (desc) {
  const buffer = make.call(this, desc);
  if (desc.usage & GPUBufferUsage.STORAGE) {
    const info = {
      id: probe.storage.length,
      capacity: desc.size,
      label: desc.label ?? "",
    };
    probe.storage.push(info);
    probe.storageBuffers.push(buffer);
    storageInfo.set(buffer, info);
  }
  return buffer;
};
// A material change is a shader/surface change: it rebuilds the render pipeline
// but not the geometry. Count both flavours use.gpu might call.
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

// A small carbon cluster — enough atoms to draw shaded spheres.
const atomCount = 4;
const data = createStructure({
  positions: Float32Array.from([-3, 0, 0, -1, 0, 0, 1, 0, 0, 3, 0, 0]),
  topology: {
    atoms: {
      count: atomCount,
      id: Array.from({ length: atomCount }, (_, i) => String(i + 1)),
      name: Array.from({ length: atomCount }, (_, i) => `C${i + 1}`),
      altloc: new Array(atomCount).fill(""),
      residue: new Uint32Array(atomCount),
      element: new Uint8Array(atomCount).fill(6),
      occupancy: new Float32Array(atomCount).fill(1),
      bfactor: new Float32Array(atomCount),
      radius: new Float32Array(atomCount).fill(1.7),
    },
    residues: {
      count: 1,
      chain: new Uint32Array(1),
      labelSeq: Int32Array.of(1),
      authSeq: ["1"],
      insertionCode: [""],
      comp: ["UNL"],
      polymer: ["other"],
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

// The `material` prop, one per named case. `none` leaves it undefined so the
// layer uses the ambient default material.
const MATERIALS = {
  none: undefined,
  pbr: { metalness: 0, roughness: 0.6 },
  metal: { type: "pbr", metalness: 1, roughness: 0.2 },
  basic: { type: "basic" },
  normal: { type: "normal" },
  // The escape-hatch wrapper form: a plain function receiving the element.
  wrapper: (children) => children,
};

const Scene = ({ material }) =>
  use(OrbitCamera, {
    radius: 20,
    target: [0, 0, 0],
    children: use(Pass, {
      lights: true,
      children: [
        use(AmbientLight, { intensity: 0.3 }),
        use(DirectionalLight, { direction: [-1, -2, -1.5], intensity: 1 }),
        use(Structure, {
          data,
          children: use(Spacefill, { material, scale: 1 }),
        }),
      ],
    }),
  });

const App = () => {
  useDeviceContext();
  const [name, setName] = useState("pbr");
  probe.setMaterial = setName;
  probe.mounted = true;
  return use(Scene, { material: MATERIALS[name] });
};

render(use(WebGPU, {
  fallback: (e) => {
    probe.errors.push(String(e));
    return null;
  },
  children: use(AutoCanvas, {
    selector: "#stage",
    samples: 1,
    backgroundColor: [0, 0, 0, 1],
    children: use(App, {}),
  }),
}));
