// Spike page: renders @molgpu/viewer (JSR-shaped TS) through a Deno browser bundle.
import { render, use, type LiveElement } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, AmbientLight, DirectionalLight } from '@use-gpu/workbench';
import { createStructure } from '@molgpu/table';
import { Points, Structure } from '@molgpu/viewer';

type Probe = { errors: string[]; mounted: boolean; stages: string[] };
const probe: Probe = { errors: [], mounted: false, stages: [] };
(globalThis as unknown as { __probe: Probe }).__probe = probe;
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, ...args: Parameters<GPUAdapter['requestDevice']>) {
  probe.stages.push('requestDevice');
  const device = await request.apply(this, args);
  probe.stages.push('device');
  device.addEventListener('uncapturederror', (e) => probe.errors.push((e as GPUUncapturedErrorEvent).error.message));
  return device;
};

// A 12 x 9 grid of atoms, each its own residue in one chain.
const N = 108;
const positions = new Float32Array(N * 3);
for (let i = 0; i < N; i++) { positions[i * 3] = (i % 12) - 5.5; positions[i * 3 + 1] = Math.floor(i / 12) - 4; }
const strings = (f: (i: number) => string) => Array.from({ length: N }, (_, i) => f(i));
const data = createStructure({
  positions,
  topology: {
    atoms: { count: N, id: strings(i => `${i + 1}`), name: strings(() => 'CA'), altloc: strings(() => ''),
      residue: Uint32Array.from({ length: N }, (_, i) => i), element: new Uint8Array(N).fill(6),
      occupancy: new Float32Array(N).fill(1), bfactor: new Float32Array(N),
      radius: Float32Array.from({ length: N }, (_, i) => 0.3 + (i % 4) * 0.08) },
    residues: { count: N, chain: new Uint32Array(N), labelSeq: Int32Array.from({ length: N }, (_, i) => i + 1),
      authSeq: strings(i => `${i + 1}`), insertionCode: strings(() => ''), comp: strings(() => 'GLY'), polymer: strings(() => 'protein') as 'protein'[] },
    chains: { count: 1, model: Int32Array.of(1), labelId: ['A'], authId: ['A'] },
    bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
    instances: { count: 0, chain: new Uint32Array(), operatorId: [], transform: new Float64Array() },
  },
});

const App = (): LiveElement => {
  probe.mounted = true;
  return use(OrbitCamera, { radius: 16, bearing: 0, pitch: 0, target: [0, 0, 0], children:
    use(Pass, { lights: true, children: [
      use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
      use(DirectionalLight, { position: [1, 2, 1.5], color: [1, 1, 1], intensity: 1 }),
      use(Structure as never, { data, children: use(Points as never, { color: [0.95, 0.55, 0.2, 1] }) }),
    ] }) });
};

const Stage = ({ name, children }: { name: string; children?: LiveElement }): LiveElement => { probe.stages.push(name); return children ?? null; };

render(use(Stage, { name: 'root', children: use(WebGPU, {
  fallback: (e: unknown) => { probe.errors.push(String(e)); return null; },
  children: use(Stage, { name: 'webgpu', children: use(AutoCanvas, { selector: '#stage', samples: 1, backgroundColor: [0, 0, 0, 1],
    children: use(Stage, { name: 'canvas', children: use(App, {}) }) }) }),
}) }));
