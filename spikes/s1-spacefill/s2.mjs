import { render, use, useMemo, useState } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, RawData, PointLayer, FaceLayer, GeometryData,
  makeSphereGeometry, AmbientLight, DirectionalLight } from '@use-gpu/workbench';
import { synthetic, toBuffers } from './atoms.mjs';
import { installGPUProbe } from './gpu-probe.mjs';
import { makeSampler } from './sample.mjs';

const probe = installGPUProbe();
const keys = [
  { time: 0, value: [1, 0.1, 0.1, 1] },
  { time: 1, value: [0.1, 0.2, 1, 1] },
  { time: 2, value: [0.1, 1, 0.2, 1] },
];
const sample = makeSampler(keys);
const stats = window.__s2 = { geometryBuilds: 0, positionBuilds: 0, colorBuilds: 0, sourceChanges: 0, t: null };
const sources = {};
// GeometryData exposes shader-backed attributes, not direct StorageSources.
// Walk their bound resources so the test observes the actual GPU buffers.
const boundBuffers = (value, seen = new Set(), out = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return out;
  seen.add(value);
  if (value instanceof GPUBuffer) out.add(value);
  else if (!ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
    for (const child of value instanceof Map ? value.values() : Object.values(value)) boundBuffers(child, seen, out);
  }
  return out;
};
const observe = (key, source) => {
  if (sources[key] && sources[key].buffer !== source.buffer) stats.sourceChanges++;
  sources[key] = source;
  return source;
};
stats.snapshot = () => ({ ...Object.fromEntries(Object.entries(stats).filter(([, v]) => typeof v !== 'function')),
  writes: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, probe.writes(s.buffer)])),
  errors: [...probe.errors], submissions: probe.submissions });
stats.sample = sample;
stats.samplerChecks = () => {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  if (!near(sample(-1), keys[0].value) || !near(sample(3), keys[2].value) ||
      !near(sample(1), keys[1].value) || !near(sample(0.5), [0.55, 0.15, 0.55, 1])) throw Error('Sampler mismatch');
  const forward = [0, 0.5, 1, 1.5, 2].map(sample);
  [2, 1.5, 1, 0.5, 0].forEach((t, i) => { if (!near(sample(t), forward[4-i])) throw Error('Direction dependence'); });
  for (const bad of [NaN, Infinity]) { let threw = false; try { sample(bad); } catch { threw = true; } if (!threw) throw Error('Nonfinite accepted'); }
  return true;
};

const Scene = () => {
  const [t, setT] = useState(0);
  stats.seek = setT;
  stats.t = t;
  document.querySelector('#time').value = String(t);
  const atoms = useMemo(() => { stats.positionBuilds++; return toBuffers(synthetic(10000)); }, []);
  const sizes = useMemo(() => Float32Array.from(atoms.radius, r => r * 296), [atoms]);
  // A real cached mesh witnesses geometry memoization, in addition to impostors.
  const mesh = useMemo(() => { stats.geometryBuilds++; return makeSphereGeometry({ detail: [12, 24] }); }, []);
  const color = sample(t);
  const colors = useMemo(() => {
    stats.colorBuilds++;
    const out = new Float32Array(atoms.count * 4);
    for (let i = 0; i < atoms.count; i++) out.set(color, i * 4);
    return out;
  }, [t, atoms]);
  return use(OrbitCamera, { radius: atoms.extent * 1.7, bearing: 0.6, pitch: 0.35, children:
    use(Pass, { lights: true, children: [
      use(AmbientLight, { intensity: 0.4 }),
      use(DirectionalLight, { position: [1, 2, 1.5], intensity: 1 }),
      use(RawData, { data: atoms.positions, format: 'vec3<f32>', render: p =>
        use(RawData, { data: sizes, format: 'f32', render: s =>
          use(RawData, { data: colors, format: 'vec4<f32>', render: c =>
            use(PointLayer, { positions: observe('positions', p), sizes: observe('sizes', s),
              colors: observe('colors', c), count: atoms.count, shaded: true, depth: 1, shape: 'circle' }) }) }) }),
      use(GeometryData, { ...mesh, render: geo => {
        for (const [name, source] of Object.entries(geo.attributes)) {
          const buffers = [...boundBuffers(source)];
          if (!buffers.length) throw Error(`No buffer found for mesh ${name}`);
          buffers.forEach((buffer, i) => observe(`mesh:${name}:${i}`, { buffer }));
        }
        return use(FaceLayer, { mesh: geo, color, shaded: true, side: 'both' });
      } }),
    ] }) });
};
document.querySelector('#time').addEventListener('input', e => stats.seek?.(+e.target.value));
render(use(WebGPU, { fallback: e => { probe.errors.push(String(e)); return null; }, children:
  use(AutoCanvas, { selector: '#root', samples: 1, backgroundColor: [0.08, 0.09, 0.11, 1], children: use(Scene) }) }));
