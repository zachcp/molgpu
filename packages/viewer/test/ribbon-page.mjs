// 0sj.6 browser proof: a real corpus structure (with a genuine helix)
// renders a ribbon, a color edit uploads no new geometry, and an empty
// selection renders nothing without error.
import { render, use, useState } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, AmbientLight, DirectionalLight, useDeviceContext } from '@use-gpu/workbench';
import { where, resolve } from '@molgpu/select';
import { coordinateBounds } from '@molgpu/table';
import { structureFromBcif } from '@molgpu/io';
import { Structure, Ribbon } from '../src/index.mjs';

const probe = window.__probe = { storage: [], storageBuffers: [], storageWrites: [], errors: [], mounted: false };
const storageInfo = new WeakMap();
const make = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function (desc) {
  const buffer = make.call(this, desc);
  if (desc.usage & GPUBufferUsage.STORAGE) {
    const info = { id: probe.storage.length, capacity: desc.size, label: desc.label ?? '' };
    probe.storage.push(info);
    probe.storageBuffers.push(buffer);
    storageInfo.set(buffer, info);
  }
  return buffer;
};
const write = GPUQueue.prototype.writeBuffer;
GPUQueue.prototype.writeBuffer = function (buffer, offset, data, dataOffset, size) {
  if (buffer.usage & GPUBufferUsage.STORAGE) {
    probe.storageWrites.push({ ...storageInfo.get(buffer), label: buffer.label, offset, bytes: size ?? data.byteLength });
  }
  return write.call(this, buffer, offset, data, dataOffset, size);
};
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = await request.apply(this, args);
  device.addEventListener('uncapturederror', (e) => probe.errors.push(e.error.message));
  return device;
};

const bytes = new Uint8Array(await (await fetch('/packages/io/test/fixtures/1crn.bcif')).arrayBuffer());
const data = await structureFromBcif(bytes);
const nothing = resolve(where('atom', 'none', () => false), data);
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));

const Scene = ({ mode, color }) => {
  const props = mode === 'empty' ? { select: nothing, color } : { color };
  return use(OrbitCamera, { radius: extent * 1.6, target: bounds.center, children:
    use(Pass, { lights: true, children: [
      use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
      use(DirectionalLight, { position: [1, 2, 1.5], color: [1, 1, 1], intensity: 1 }),
      use(Structure, { data, children: use(Ribbon, props) }),
    ] }) });
};

const App = () => {
  useDeviceContext();
  const [mode, setMode] = useState('ribbon');
  const [color, setColor] = useState([0.85, 0.55, 0.35, 1]);
  probe.setMode = setMode;
  probe.setColor = setColor;
  probe.mounted = true;
  return use(Scene, { mode, color });
};

render(use(WebGPU, {
  fallback: (e) => { probe.errors.push(String(e)); return null; },
  children: use(AutoCanvas, { selector: '#stage', samples: 1, backgroundColor: [0, 0, 0, 1], children: use(App, {}) }),
}));
