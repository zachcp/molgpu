// Gate 2 proof mount: one selection + one colour field drive Spacefill, Bonds,
// and BallAndStick through <Structure>. Recolouring (swapping the colour field)
// must upload no new geometry/position columns — only the field's shader module
// changes. We count STORAGE allocations so a recolour shows zero.
import { render, use, useState } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, AmbientLight, DirectionalLight, useDeviceContext } from '@use-gpu/workbench';
import { createStructure } from '@molgpu/table';
import { attribute, categorical } from '@molgpu/fields';
import { Structure, Spacefill, Bonds, BallAndStick } from '../src/index.mjs';

const probe = window.__probe = { storage: 0, errors: [], mounted: false };
const make = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function (desc) {
  if (desc.usage & GPUBufferUsage.STORAGE) probe.storage++;
  return make.call(this, desc);
};
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = await request.apply(this, args);
  device.addEventListener('uncapturederror', (e) => probe.errors.push(e.error.message));
  return device;
};

// A small explicit-bond structure: C-N-O-S chain with 3 bonds.
const data = createStructure({
  positions: Float32Array.from([-3, 0, 0, -1, 0, 0, 1, 0, 0, 3, 0, 0]),
  topology: {
    atoms: {
      count: 4, id: ['1', '2', '3', '4'], name: ['C', 'N', 'O', 'S'], altloc: ['', '', '', ''],
      residue: Uint32Array.from([0, 0, 1, 1]), element: Uint8Array.from([6, 7, 8, 16]),
      occupancy: Float32Array.from([1, 1, 1, 1]), bfactor: new Float32Array(4), radius: Float32Array.from([1.7, 1.55, 1.52, 1.8]),
    },
    residues: { count: 2, chain: Uint32Array.from([0, 0]), labelSeq: Int32Array.from([1, 2]), authSeq: ['1', '2'], insertionCode: ['', ''], comp: ['ALA', 'CYS'], polymer: ['protein', 'protein'] },
    chains: { count: 1, model: Int32Array.of(1), labelId: ['A'], authId: ['A'] },
    bonds: { count: 3, a: Uint32Array.from([0, 1, 2]), b: Uint32Array.from([1, 2, 3]), order: Uint8Array.from([1, 1, 1]), source: ['explicit', 'explicit', 'explicit'] },
    instances: { count: 1, chain: Uint32Array.of(0), operatorId: ['1'], transform: Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1) },
  },
});

const PALETTES = [
  categorical(attribute('element'), { 6: [0.8, 0.8, 0.85, 1], 7: [0.35, 0.5, 0.92, 1], 8: [0.9, 0.36, 0.33, 1], 16: [0.95, 0.8, 0.3, 1] }, [0.5, 0.5, 0.5, 1]),
  categorical(attribute('element'), { 6: [0.2, 0.7, 0.4, 1], 7: [0.9, 0.2, 0.6, 1], 8: [0.2, 0.7, 0.4, 1], 16: [0.9, 0.2, 0.6, 1] }, [0.5, 0.5, 0.5, 1]),
];

const App = () => {
  useDeviceContext();
  const [palette, setPalette] = useState(0);
  probe.setPalette = (p) => setPalette(p);
  probe.mounted = true;
  return use(OrbitCamera, { radius: 14, bearing: 0.6, pitch: 0.35, target: [0, 0, 0], children:
    use(Pass, { lights: true, children: [
      use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
      use(DirectionalLight, { position: [1, 2, 1.5], color: [1, 1, 1], intensity: 1 }),
      // three consumers of one colour field: Spacefill, Bonds, and BallAndStick.
      use(Structure, { data, children: use(BallAndStick, { ball: 0.35, stick: 0.3, color: PALETTES[palette] }) }),
    ] }) });
};

render(use(WebGPU, {
  fallback: (e) => { probe.errors.push(String(e)); return null; },
  children: use(AutoCanvas, { selector: '#stage', samples: 1, backgroundColor: [0, 0, 0, 1], children: use(App, {}) }),
}));
