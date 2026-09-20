// S1: decide the spacefill path and get real frame timings.
//
//   ?mode=point   PointLayer impostor sprites (the path Mol* uses at scale)
//   ?mode=mesh    merged real sphere geometry via FaceLayer (comparison baseline)
//   ?n=100000     atom count (synthetic cloud); ?s=1tqn uses a real structure
//   ?depth=1      PointLayer depth prop, to find which value gives world-space size
//   ?probe=1      a few large intersecting spheres, to judge impostor depth correctness
//   ?shaded=0     disable shading
import { render, use } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import {
  OrbitCamera, Pass, RawData, PointLayer, FaceLayer, GeometryData,
  AmbientLight, DirectionalLight, makeSphereGeometry, useAnimationFrame, useTimeContext,
} from '@use-gpu/workbench';
import { synthetic, loadReal, toBuffers } from './atoms.mjs';
import { startBench } from './bench.mjs';
import { installGPUProbe } from './gpu-probe.mjs';
installGPUProbe();

const hud = (s) => { document.getElementById('hud').textContent = s; };
const qs = new URLSearchParams(location.search);
const MODE   = qs.get('mode') ?? 'point';
const N      = parseInt(qs.get('n') ?? '100000', 10);
const STRUCT = qs.get('s');
const DEPTH  = qs.get('depth') != null ? parseFloat(qs.get('depth')) : 1;
const PROBE  = qs.get('probe') === '1';
const SHADED = qs.get('shaded') !== '0';
const SIZE   = parseFloat(qs.get('size') ?? '1');
const RAD    = qs.get('r') != null ? parseFloat(qs.get('r')) : null;   // camera radius override, to test zoom-invariance

window.__prep = {};
const _t = () => performance.now();
window.__ready = false;
window.__err = null;
addEventListener('error', (e) => { window.__err = String(e.message); });

let atoms;
if (PROBE) {
  // 4 big overlapping spheres. With true impostors + fragDepth the intersections
  // read as sphere-sphere curves; with flat sprites they read as straight disc edges.
  atoms = toBuffers({
    x: Float32Array.from([0, 6, 3, 3]), y: Float32Array.from([0, 0, 5, 2]),
    z: Float32Array.from([0, 0, 0, 5]), radius: Float32Array.from([5, 5, 5, 5]),
    count: 4, extent: 22,
  });
} else if (STRUCT) {
  atoms = toBuffers(await loadReal(STRUCT));
} else {
  const a0 = _t();
  const raw = synthetic(N);
  window.__prep.synthMs = +(_t() - a0).toFixed(1);
  const b0 = _t();
  atoms = toBuffers(raw);
  window.__prep.buffersMs = +(_t() - b0).toFixed(1);
}

// `makeSphereGeometry` is exported from workbench; verify rather than assume.
const haveSphere = typeof makeSphereGeometry === 'function';
if (haveSphere) {
  const g = makeSphereGeometry({ detail: [6, 10] });
  window.__sphere = {
    count: g.count, topology: g.topology, formats: g.formats,
    attrLens: Object.fromEntries(Object.entries(g.attributes).map(([k, v]) => [k, v?.length])),
    stridePerVert: Object.fromEntries(Object.entries(g.attributes).map(([k, v]) => [k, v && g.count ? v.length / g.count : null])),
  };
}

// Merged-mesh baseline: one big buffer of real sphere geometry, which is what a
// naive (non-impostor) spacefill does. Deliberately capped — it is O(atoms x verts).
let merged = null, mergedNote = '';
if (MODE === 'mesh') {
  if (!haveSphere) { mergedNote = 'makeSphereGeometry MISSING'; }
  else {
    const CAP = 20000;
    const n = Math.min(atoms.count, CAP);
    if (n < atoms.count) mergedNote = `capped ${n}/${atoms.count}`;
    const m0 = _t();
    const base = makeSphereGeometry({ detail: [6, 10] });
    const bp = base.attributes.positions, bn = base.attributes.normals;
    const bi = base.attributes.indices;
    const vpr = bp.length / 4;                      // verts per sphere
    const positions = new Float32Array(n * vpr * 4);
    const normals   = new Float32Array(n * vpr * 4);
    const indices   = bi ? new Uint32Array(n * bi.length) : null;
    for (let a = 0; a < n; a++) {
      const r = atoms.radius[a] * SIZE * 2;
      const [ox, oy, oz] = [atoms.positions[a*3], atoms.positions[a*3+1], atoms.positions[a*3+2]];
      for (let v = 0; v < vpr; v++) {
        const s = (a * vpr + v) * 4, b = v * 4;
        positions[s]   = bp[b]   * r + ox;
        positions[s+1] = bp[b+1] * r + oy;
        positions[s+2] = bp[b+2] * r + oz;
        positions[s+3] = 1;
        if (bn) { normals[s] = bn[b]; normals[s+1] = bn[b+1]; normals[s+2] = bn[b+2]; }
      }
      if (indices) for (let k = 0; k < bi.length; k++) indices[a * bi.length + k] = bi[k] + a * vpr;
    }
    merged = { positions, normals, indices, verts: n * vpr, tris: indices ? indices.length/3 : 0 };
    window.__prep.meshBuildMs = +(_t() - m0).toFixed(1);
    window.__prep.meshBytes = positions.byteLength + normals.byteLength + (indices?indices.byteLength:0);
    window.__prep.vertsPerSphere = vpr;
  }
}

// PointLayer wants per-point sizes. Impostor radius is in the same units the layer
// interprets; `depth` decides whether that is pixels or world units.
const sizes = Float32Array.from(atoms.radius, (r) => r * SIZE * 4);
window.__prep.pointBytes = atoms.positions.byteLength + sizes.byteLength;
window.__prep.count = atoms.count;

const label = `${MODE} n=${PROBE ? 4 : atoms.count}`;
hud([
  `mode=${MODE}  ${PROBE ? 'PROBE' : `n=${atoms.count}`}${STRUCT ? ` (${STRUCT})` : ''}`,
  `depth=${DEPTH} shaded=${SHADED} size=${SIZE} camR=${RAD ?? (atoms.extent*1.7).toFixed(1)}`,
  merged ? `merged mesh: ${merged.verts} verts, ${merged.tris} tris ${mergedNote}` : mergedNote,
  `makeSphereGeometry: ${haveSphere}`,
  `benchmarking…`,
].filter(Boolean).join('\n'));

if (!PROBE) startBench({ label });

const body =
  MODE === 'mesh'
    ? (merged
        ? use(GeometryData, {
            count: merged.indices?.length ?? merged.verts,
            topology: 'triangle-list',
            attributes: { positions: merged.positions, normals: merged.normals, ...(merged.indices ? { indices: merged.indices } : {}) },
            formats: { positions: 'vec4<f32>', normals: 'vec4<f32>', ...(merged.indices ? { indices: 'u32' } : {}) },
            render: (geo) => use(FaceLayer, { mesh: geo, side: 'both', color: [0.62,0.76,0.93,1], shaded: SHADED }),
          })
        : null)
    : use(RawData, {
        data: atoms.positions, format: 'vec3<f32>',
        render: (pos) => use(RawData, {
          data: sizes, format: 'f32',
          render: (siz) => use(PointLayer, {
            positions: pos, sizes: siz, count: atoms.count,
            color: [0.62,0.76,0.93,1], shape: 'circle',
            shaded: SHADED, depth: DEPTH,
          }),
        }),
      });

// Camera motion forces actual scene rendering throughout the benchmark.
const BenchmarkCamera = ({ children }) => {
  useAnimationFrame();
  const { elapsed } = useTimeContext();
  return use(OrbitCamera, {
    bearing: 0.6 + elapsed * 0.0001, pitch: 0.35,
    radius: RAD ?? atoms.extent * 1.7, target: [0, 0, 0], children,
  });
};

render(use(WebGPU, {
  fallback: (e) => { window.__err = String(e?.message ?? e); hud('WebGPU unavailable: ' + (e?.message ?? e)); return null; },
  children: use(AutoCanvas, {
    selector: '#root', samples: 1, backgroundColor: [0.08,0.09,0.11,1],
    children: use(PROBE ? OrbitCamera : BenchmarkCamera, {
      bearing: 0.6, pitch: 0.35, radius: RAD ?? atoms.extent * 1.7, target: [0,0,0],
      children: use(Pass, {
        lights: true,
        children: [
          use(AmbientLight, { color: [1,1,1], intensity: 0.25 }),
          use(DirectionalLight, { position: [1,2,1.5], color: [1,1,1], intensity: 1.0 }),
          body,
        ].filter(Boolean),
      }),
    }),
  }),
}));
window.__ready = true;
