// hj0.4 browser proof: a <Label> anchored to a selection's centroid and a
// <Distance> between two selections' centroids render in a real WebGPU scene
// (text via a FontLoader, the connector via a LineLayer) with no WebGPU errors,
// and re-anchor when the selection changes.
import { render, use, useState } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, FontLoader, SDFFontProvider, useDeviceContext } from '@use-gpu/workbench';
import { createStructure } from '@molgpu/table';
import { where, resolve } from '@molgpu/select';
import { Structure, Spacefill, Label, Distance, AmbientLight, DirectionalLight, centroid } from '../src/index.ts';

const probe = window.__probe = { storage: 0, textures: 0, pipelines: 0, errors: [], mounted: false, centroidA: null, distance: null };
const makeBuffer = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function (desc) {
  const buffer = makeBuffer.call(this, desc);
  if (desc.usage & GPUBufferUsage.STORAGE) probe.storage += 1;
  return buffer;
};
const makeTexture = GPUDevice.prototype.createTexture;
GPUDevice.prototype.createTexture = function (desc) { probe.textures += 1; return makeTexture.call(this, desc); };
for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
  const original = GPUDevice.prototype[name];
  GPUDevice.prototype[name] = function (...args) { probe.pipelines += 1; return original.apply(this, args); };
}
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = await request.apply(this, args);
  device.addEventListener('uncapturederror', (e) => probe.errors.push(e.error.message));
  return device;
};

// Two atom pairs, far apart: centroid A = (-3,1,0), centroid B = (3,1,0), 6 Å apart.
const data = createStructure({
  positions: Float32Array.from([-3,0,0, -3,2,0, 3,0,0, 3,2,0]),
  topology: {
    atoms: {
      count: 4, id: ['1', '2', '3', '4'], name: ['C1', 'C2', 'C3', 'C4'], altloc: ['', '', '', ''],
      residue: Uint32Array.of(0, 0, 1, 1), element: new Uint8Array([6, 6, 6, 6]),
      occupancy: new Float32Array(4).fill(1), bfactor: new Float32Array(4),
      radius: new Float32Array(4).fill(1.5),
    },
    residues: { count: 2, chain: Uint32Array.of(0, 0), labelSeq: Int32Array.of(1, 2), authSeq: ['1', '2'], insertionCode: ['', ''], comp: ['ALA', 'ALA'], polymer: ['protein', 'protein'] },
    chains: { count: 1, model: Int32Array.of(1), labelId: ['A'], authId: ['A'] },
    bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
    instances: { count: 1, chain: new Uint32Array(1), operatorId: ['1'], transform: Float64Array.of(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1) },
  },
});
const selA = resolve(where('atom', 'a', (d, i) => i < 2), data);   // rows 0,1
const selB = resolve(where('atom', 'b', (d, i) => i >= 2), data);  // rows 2,3
probe.centroidA = centroid(data, selA);
probe.distance = Math.hypot(...centroid(data, selA).map((v, i) => v - centroid(data, selB)[i]));

const Scene = ({ labelSel }) =>
  use(OrbitCamera, { radius: 20, target: [0, 1, 0], children:
    use(Pass, { lights: true, children: [
      use(AmbientLight, {}),
      use(DirectionalLight, {}),
      use(Structure, { data, children: [
        use(Spacefill, { scale: 0.5 }),
        use(Label, { select: labelSel, text: 'site', size: 24, color: [1, 1, 0, 1] }),
        use(Distance, { a: selA, b: selB, format: (d) => d.toFixed(0), size: 20 }),
      ] }),
    ] }) });

const App = () => {
  useDeviceContext();
  const [labelSel, setLabelSel] = useState(selA);
  probe.setLabel = (which) => setLabelSel(which === 'b' ? selB : selA);
  probe.mounted = true;
  return use(Scene, { labelSel });
};

// Text needs both the Rust shaper (FontLoader -> FontContext) and the glyph
// atlas (SDFFontProvider -> SDFFontContext, which owns a GPU texture, so it
// lives inside the canvas).
render(use(WebGPU, {
  fallback: (e) => { probe.errors.push(String(e)); return null; },
  children: use(FontLoader, { fonts: [{ family: 'sans', style: 'normal', weight: 400, src: '/spikes/examples/assets/font.ttf' }], children:
    use(AutoCanvas, { selector: '#stage', samples: 1, backgroundColor: [0, 0, 0, 1], children:
      use(SDFFontProvider, { children: use(App, {}) }) }) }),
}));
