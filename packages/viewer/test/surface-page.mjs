// 0sj.3 browser proof: a real corpus structure renders a molecular surface,
// a probe radius/resolution edit rebuilds geometry, a color/opacity edit
// does not, and an empty selection renders nothing without error.
import { render, use, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
  useDeviceContext,
} from "@use-gpu/workbench";
import { resolve, where } from "@molgpu/select";
import { byElement } from "@molgpu/fields";
import { coordinateBounds } from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import { Structure, Surface } from "../src/index.ts";

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

const bytes = new Uint8Array(
  await (await fetch("/packages/io/test/fixtures/1crn.bcif")).arrayBuffer(),
);
const data = await structureFromBcif(bytes);
const nothing = resolve(where("atom", "none", () => false), data);
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));

// The edited state lives BELOW a stable <Pass>, as in a real app, so a style
// edit must repaint on its own (molgpu-sept-jrr).
const SurfaceProbe = () => {
  const [mode, setMode] = useState("surface");
  const [probeRadius, setProbeRadius] = useState(1.4);
  const [resolution, setResolution] = useState(1.0);
  const [color, setColor] = useState([0.75, 0.75, 0.8, 1]);
  probe.setMode = setMode;
  probe.setProbeRadius = setProbeRadius;
  probe.setResolution = setResolution;
  probe.setColor = setColor;
  probe.setElementColor = () => setColor(byElement());
  probe.mounted = true;
  const props = mode === "empty"
    ? { select: nothing, probeRadius, resolution, color }
    : { probeRadius, resolution, color };
  return use(Structure, { data, children: use(Surface, props) });
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
        use(SurfaceProbe, {}),
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
