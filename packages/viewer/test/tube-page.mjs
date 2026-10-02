// 0sj.5 browser proof: two chains render as two separate tube strips (never
// bridged across the chain break), an empty selection renders nothing
// without error, and a width/color edit uploads no new geometry buffers.
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
import { byChain, bySeq } from "@molgpu/fields";
import { Ribbon, Structure, Surface, Tube } from "../src/index.ts";

const probe = globalThis.__probe = {
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

// Two 4-residue protein chains, far apart: a chain break with no shared labelSeq run.
const atomCount = 8;
const data = createStructure({
  positions: Float32Array.from([
    -6,
    0,
    0,
    -5,
    1,
    0,
    -4,
    0,
    0,
    -3,
    1,
    0,
    3,
    0,
    0,
    4,
    1,
    0,
    5,
    0,
    0,
    6,
    1,
    0,
  ]),
  topology: {
    atoms: {
      count: atomCount,
      id: Array.from({ length: atomCount }, (_, i) => String(i + 1)),
      name: new Array(atomCount).fill("CA"),
      altloc: new Array(atomCount).fill(""),
      residue: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7]),
      element: new Uint8Array(atomCount).fill(6),
      occupancy: new Float32Array(atomCount).fill(1),
      bfactor: new Float32Array(atomCount),
    },
    residues: {
      count: 8,
      chain: Uint32Array.from([0, 0, 0, 0, 1, 1, 1, 1]),
      labelSeq: Int32Array.from([1, 2, 3, 4, 1, 2, 3, 4]),
      authSeq: ["1", "2", "3", "4", "1", "2", "3", "4"],
      insertionCode: new Array(8).fill(""),
      comp: new Array(8).fill("ALA"),
      polymer: new Array(8).fill("protein"),
    },
    chains: {
      count: 2,
      model: Int32Array.of(1, 1),
      labelId: ["A", "B"],
      authId: ["A", "B"],
    },
    bonds: {
      count: 0,
      a: new Uint32Array(),
      b: new Uint32Array(),
      order: new Uint8Array(),
      source: [],
    },
    instances: {
      count: 2,
      chain: Uint32Array.of(0, 1),
      operatorId: ["1", "2"],
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
const nothing = resolve(where("atom", "none", () => false), data);

// The edited state lives BELOW a stable <Pass>, as in a real app: a style edit
// The same chains with a second assembly copy 5 Å along +y (fch.4): its
// geometry is built once and drawn under both operators.
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const UP = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 5, 0, 1];
const assembled = createStructure({
  positions: data.positions,
  topology: {
    ...data.topology,
    instances: {
      count: 4,
      chain: Uint32Array.of(0, 1, 0, 1),
      operatorId: ["1", "1", "2", "2"],
      transform: Float64Array.from([...I, ...I, ...UP, ...UP]),
    },
  },
});

// must repaint on its own, not because the whole pass happened to re-render
// (molgpu-sept-jrr — holding it above the Pass masked a missing repaint).
const TubeProbe = () => {
  const [mode, setMode] = useState("multi");
  const [kind, setKind] = useState("tube");
  probe.setKind = setKind;
  const [radius, setRadius] = useState(0.3);
  const [color, setColor] = useState([0.45, 0.78, 0.95, 1]);
  probe.setMode = setMode;
  probe.setRadius = setRadius;
  probe.setColor = setColor;
  probe.setField = (name) => setColor({ chain: byChain(), seq: bySeq() }[name]);
  probe.mounted = true;
  const props = mode === "empty"
    ? { select: nothing, radius, color }
    : { radius, color };
  return use(Structure, {
    data: mode === "assembly" ? assembled : data,
    children: kind === "ribbon"
      ? use(Ribbon, { color: props.color })
      : kind === "surface"
      ? use(Surface, { color: props.color, resolution: 0.6 })
      : use(Tube, props),
  });
};

const App = () => {
  useDeviceContext();
  return use(OrbitCamera, {
    radius: 16,
    target: [0, 0.5, 0],
    children: use(Pass, {
      lights: true,
      children: [
        use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
        use(DirectionalLight, {
          position: [1, 2, 1.5],
          color: [1, 1, 1],
          intensity: 1,
        }),
        use(TubeProbe, {}),
      ],
    }),
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
