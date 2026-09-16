// Self-contained S1 demo: what PointLayer impostors actually do.
// No fetch, no data files — crambin is inlined. Controls reload with query params,
// which avoids any live remount complexity.
import { render, use } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, RawData, PointLayer, AmbientLight, DirectionalLight } from '@use-gpu/workbench';
import { XYZ, EL, VDW } from './crambin.mjs';

const qs = new URLSearchParams(location.search);
const SCENE  = qs.get('scene') ?? 'crambin';
const SHADED = qs.get('shaded') !== '0';
const DEPTH  = qs.get('depth') != null ? parseFloat(qs.get('depth')) : 1;
const SIZEK  = parseFloat(qs.get('size') ?? '1');

// ---- atom sources -------------------------------------------------------
function crambin() {
  const n = EL.length;
  const positions = new Float32Array(n * 3), radius = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    positions[i*3] = XYZ[i*3] / 100; positions[i*3+1] = XYZ[i*3+1] / 100; positions[i*3+2] = XYZ[i*3+2] / 100;
    radius[i] = VDW[EL[i]];
  }
  return { positions, radius, count: n, extent: 30, label: '1CRN crambin' };
}
function synthetic(count) {
  let s = 1; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const R = Math.cbrt((count * 12) / (4/3 * Math.PI));   // ~protein interior density
  const positions = new Float32Array(count * 3), radius = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = R * Math.cbrt(rnd()), th = 2*Math.PI*rnd(), ph = Math.acos(2*rnd()-1);
    positions[i*3] = r*Math.sin(ph)*Math.cos(th);
    positions[i*3+1] = r*Math.sin(ph)*Math.sin(th);
    positions[i*3+2] = r*Math.cos(ph);
    radius[i] = VDW[(rnd()*VDW.length)|0];
  }
  return { positions, radius, count, extent: R*2, label: `${count.toLocaleString()} synthetic atoms` };
}
function probe() {
  // Four deliberately overlapping spheres. Curved intersection seams prove
  // per-fragment depth; flat billboards would hard-occlude with circular edges.
  return {
    positions: Float32Array.from([0,0,0, 6,0,0, 3,5,0, 3,2,5]),
    radius: Float32Array.from([5,5,5,5]), count: 4, extent: 24,
    label: '4 overlapping spheres — impostor proof',
  };
}

const atoms =
  SCENE === 'probe'   ? probe() :
  SCENE === 'crambin' ? crambin() :
  synthetic(parseInt(SCENE, 10) || 10000);

// At depth:1 `sizes` is world-space but not raw Angstrom — this ~296 factor
// depends on fov and viewport. A real implementation must DERIVE it; see the
// S1 finding. Hardcoded here only because this demo's camera is fixed.
const K = 296;
const sizes = Float32Array.from(atoms.radius, (r) => r * SIZEK * (DEPTH === 1 ? K : 4));
const bytes = atoms.positions.byteLength + sizes.byteLength;

document.getElementById('meta').textContent =
  `${atoms.label}  ·  ${atoms.count.toLocaleString()} points  ·  ` +
  `${(bytes/1048576).toFixed(2)} MB  ·  ${(bytes/atoms.count).toFixed(0)} B/atom`;

// reflect current state into the controls
for (const el of document.querySelectorAll('[data-q]')) {
  const [k, v] = el.dataset.q.split('=');
  const cur = qs.get(k) ?? (k === 'scene' ? 'crambin' : k === 'depth' ? '1' : k === 'shaded' ? '1' : '');
  if (cur === v) el.setAttribute('aria-pressed', 'true');
  el.addEventListener('click', () => {
    const p = new URLSearchParams(location.search);
    p.set(k, v); location.search = p.toString();
  });
}

render(use(WebGPU, {
  fallback: (e) => {
    document.getElementById('fallback').hidden = false;
    document.getElementById('why').textContent = String(e?.message ?? e);
    return null;
  },
  children: use(AutoCanvas, {
    selector: '#stage', samples: 4, backgroundColor: [0.055, 0.062, 0.078, 1],
    children: use(OrbitCamera, {
      bearing: 0.6, pitch: 0.35, radius: atoms.extent * 1.7, target: [0,0,0],
      children: use(Pass, {
        lights: true,
        children: [
          use(AmbientLight, { color: [1,1,1], intensity: 0.28 }),
          use(DirectionalLight, { position: [1,2,1.5], color: [1,1,1], intensity: 1.0 }),
          use(RawData, {
            data: atoms.positions, format: 'vec3<f32>',
            render: (pos) => use(RawData, {
              data: sizes, format: 'f32',
              render: (siz) => use(PointLayer, {
                positions: pos, sizes: siz, count: atoms.count,
                color: [0.62, 0.76, 0.93, 1], shape: 'circle',
                shaded: SHADED, depth: DEPTH,
              }),
            }),
          }),
        ],
      }),
    }),
  }),
}));
