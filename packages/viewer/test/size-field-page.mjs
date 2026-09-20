// Instrumented mount for the urn.5 derived-style-field invariant: changing the
// point `scale` must not re-upload the per-atom size column. We count STORAGE
// buffer allocations (RawData columns) so a scale change that only writes a
// uniform shows zero new storage buffers after warm-up.
import { render, use, useState } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, AmbientLight, DirectionalLight, useDeviceContext } from '@use-gpu/workbench';
import { ColumnSource } from '../src/internal/column-source.mjs';
import { WorldSpacePointLayer } from '../src/world-space-points.mjs';

const probe = window.__probe = { storage: 0, uniform: 0, errors: [], mounted: false };
const make = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function (desc) {
  if (desc.usage & GPUBufferUsage.STORAGE) probe.storage++;
  if (desc.usage & GPUBufferUsage.UNIFORM) probe.uniform++;
  return make.call(this, desc);
};
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = await request.apply(this, args);
  device.addEventListener('uncapturederror', (e) => probe.errors.push(e.error.message));
  return device;
};

const N = 216;
const positions = new Float32Array(N * 3);
const colors = new Float32Array(N * 4);
const radii = new Float32Array(N);
for (let i = 0; i < N; i++) {
  positions[i * 3] = (i % 18) - 9;
  positions[i * 3 + 1] = Math.floor(i / 18) - 6;
  positions[i * 3 + 2] = 0;
  colors.set([0.6, 0.72, 0.95, 1], i * 4);
  radii[i] = 0.6 + (i % 5) * 0.12;
}

const App = () => {
  useDeviceContext();
  const [scale, setScale] = useState(1);
  probe.setScale = (s) => setScale(s);
  probe.mounted = true;
  return use(ColumnSource, { data: positions, format: 'vec3<f32>', render: (pos) =>
    use(ColumnSource, { data: colors, format: 'vec4<f32>', render: (col) =>
      use(OrbitCamera, { radius: 34, bearing: 0.6, pitch: 0.35, target: [0, 0, 0], children:
        use(Pass, { lights: true, children: [
          use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
          use(DirectionalLight, { position: [1, 2, 1.5], color: [1, 1, 1], intensity: 1 }),
          use(WorldSpacePointLayer, { positions: pos, colors: col, radii, count: N, scale, shape: 'circle', shaded: true }),
        ] }) }) }) });
};

render(use(WebGPU, {
  fallback: (e) => { probe.errors.push(String(e)); return null; },
  children: use(AutoCanvas, { selector: '#stage', samples: 1, backgroundColor: [0, 0, 0, 1], children: use(App, {}) }),
}));
