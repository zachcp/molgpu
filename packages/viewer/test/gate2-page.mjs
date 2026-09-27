// Gate 2 proof mount: one selection + one colour field drive Spacefill, Bonds,
// and BallAndStick through <Structure>. Recolouring (swapping the colour field)
// must upload no new geometry/position columns — only the field's shader module
// changes. We count STORAGE allocations so a recolour shows zero.
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
import { resolve, where } from "@molgpu/select";
import { attribute, categorical } from "@molgpu/fields";
import {
  BallAndStick,
  Bonds,
  Spacefill,
  Structure,
  TimelineProvider,
  useCameraCurve,
} from "../src/index.ts";
import { createStructureResource } from "../src/advanced.ts";
import { createCameraCurve } from "../src/camera-curve.ts";

const probe = window.__probe = {
  storage: [],
  storageBuffers: [],
  storageWrites: [],
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
const write = GPUQueue.prototype.writeBuffer;
GPUQueue.prototype.writeBuffer = function (
  buffer,
  offset,
  data,
  dataOffset,
  size,
) {
  if (buffer.usage & GPUBufferUsage.STORAGE) {
    probe.storageWrites.push({
      ...storageInfo.get(buffer),
      label: buffer.label,
      offset,
      bytes: size ?? data.byteLength,
    });
  }
  return write.call(this, buffer, offset, data, dataOffset, size);
};
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = await request.apply(this, args);
  device.addEventListener(
    "uncapturederror",
    (e) => probe.errors.push(e.error.message),
  );
  return device;
};

// A small explicit-bond structure: C-N-O-S chain with 3 bonds.
const data = createStructure({
  positions: Float32Array.from([-3, 0, 0, -1, 0, 0, 1, 0, 0, 3, 0, 0]),
  topology: {
    atoms: {
      count: 4,
      id: ["1", "2", "3", "4"],
      name: ["C", "N", "O", "S"],
      altloc: ["", "", "", ""],
      residue: Uint32Array.from([0, 0, 1, 1]),
      element: Uint8Array.from([6, 7, 8, 16]),
      occupancy: Float32Array.from([1, 1, 1, 1]),
      bfactor: new Float32Array(4),
      radius: Float32Array.from([1.7, 1.55, 1.52, 1.8]),
    },
    residues: {
      count: 2,
      chain: Uint32Array.from([0, 0]),
      labelSeq: Int32Array.from([1, 2]),
      authSeq: ["1", "2"],
      insertionCode: ["", ""],
      comp: ["ALA", "CYS"],
      polymer: ["protein", "protein"],
    },
    chains: {
      count: 1,
      model: Int32Array.of(1),
      labelId: ["A"],
      authId: ["A"],
    },
    bonds: {
      count: 3,
      a: Uint32Array.from([0, 1, 2]),
      b: Uint32Array.from([1, 2, 3]),
      order: Uint8Array.from([1, 1, 1]),
      source: ["explicit", "explicit", "explicit"],
    },
    instances: {
      count: 1,
      chain: Uint32Array.of(0),
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
const selected = resolve(
  where("atom", "first three", (_data, i) => i < 3),
  data,
);
const oxygen = where(
  "atom",
  "oxygen",
  (table, i) => table.topology.atoms.element[i] === 8,
);
const focusResource = createStructureResource(data);
const cameraCurve = createCameraCurve([
  { time: 0, target: [0, 0, 0], radius: 14, bearing: 0.6, pitch: 0.35 },
  { time: 2, focus: oxygen, bearing: 1.1, pitch: 0.35 },
]);

const PALETTES = [
  categorical(attribute("element"), {
    6: [0.8, 0.8, 0.85, 1],
    7: [0.35, 0.5, 0.92, 1],
    8: [0.9, 0.36, 0.33, 1],
    16: [0.95, 0.8, 0.3, 1],
  }, [0.5, 0.5, 0.5, 1]),
  categorical(attribute("bfactor"), { 0: [0.2, 0.7, 0.4, 1] }, [
    0.9,
    0.2,
    0.6,
    1,
  ]),
];

const CameraScene = ({ palette, mode }) => {
  const camera = useCameraCurve(cameraCurve, focusResource);
  probe.camera = camera;
  return use(OrbitCamera, {
    ...camera,
    children: use(Pass, {
      lights: true,
      children: [
        use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
        use(DirectionalLight, {
          position: [1, 2, 1.5],
          color: [1, 1, 1],
          intensity: 1,
        }),
        // three consumers of one colour field: Spacefill, Bonds, and BallAndStick.
        use(Structure, {
          data,
          children: mode === "bonds"
            ? use(Bonds, { select: selected, width: 0.8 })
            : use(BallAndStick, {
              select: selected,
              ball: 0.35,
              stick: 0.3,
              color: PALETTES[palette],
            }),
        }),
      ],
    }),
  });
};

const App = () => {
  useDeviceContext();
  const [palette, setPalette] = useState(0);
  const [mode, setMode] = useState("gate2");
  const [time, setTime] = useState(0);
  probe.setPalette = setPalette;
  probe.setMode = setMode;
  probe.setTime = setTime;
  probe.mounted = true;
  return use(TimelineProvider, {
    time,
    children: use(CameraScene, { palette, mode }),
  });
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
