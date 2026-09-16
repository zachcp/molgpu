// Isolation + control. ?layer=point renders a PointLayer in the identical harness,
// to distinguish "DualContourLayer is broken" from "our use.gpu setup is wrong".
// ?method=quadratic switches the contour fit.
import { render, use } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, RawData, DualContourLayer, PointLayer } from '@use-gpu/workbench';

const hud = (s) => { document.getElementById('hud').textContent = s; };
const qs = new URLSearchParams(location.search);
const LAYER = qs.get('layer') ?? 'contour';
const METHOD = qs.get('method') ?? 'linear';
const XF = qs.get('xf');   // xf=null -> pass an explicit null transform, testing the @optional fallback

const N = 48, R = 0.35;
const values = new Float32Array(N * N * N);
for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const [u, v, w] = [x / (N - 1) - 0.5, y / (N - 1) - 0.5, z / (N - 1) - 0.5];
  values[x + N * (y + N * z)] = R - Math.hypot(u, v, w);   // positive inside
}

// Control geometry: points on the same sphere, so a correct render looks comparable.
const P = 2000, pts = new Float32Array(P * 3);
for (let i = 0; i < P; i++) {
  const phi = Math.acos(1 - 2 * (i + 0.5) / P), th = Math.PI * (1 + Math.sqrt(5)) * i;
  pts[i*3] = R*Math.sin(phi)*Math.cos(th); pts[i*3+1] = R*Math.sin(phi)*Math.sin(th); pts[i*3+2] = R*Math.cos(phi);
}

hud(`layer=${LAYER}  method=${METHOD}\nanalytic sphere, isolevel 0, ${N}^3`);

const body =
  LAYER === 'point'
    ? use(RawData, { data: pts, format: 'vec3<f32>', render: (src) =>
        use(PointLayer, { positions: src, count: P, size: 8, color: [0.6,0.85,0.7,1], shape: 'circle' }) })
    : use(RawData, { data: values, format: 'f32', render: (src) =>
        use(DualContourLayer, {
          values: src, size: [N,N,N],
          range: [[-0.5,0.5],[-0.5,0.5],[-0.5,0.5]],
          level: 0, method: METHOD, color: [0.6,0.75,0.95,1],
          ...(XF === 'null' ? { transform: { transform: null, differential: null } } : {}),
        }) });

render(use(WebGPU, {
  fallback: (e) => { hud('WebGPU unavailable: ' + (e?.message ?? e)); return null; },
  children: use(AutoCanvas, {
    selector: '#root', samples: 1, backgroundColor: [0.08,0.09,0.11,1],
    children: use(OrbitCamera, {
      bearing: 0.6, pitch: 0.4, radius: 2.5, target: [0,0,0],
      children: use(Pass, { children: body }),
    }),
  }),
}));
