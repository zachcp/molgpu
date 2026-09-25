// X2 invalidation/resource audit page (driven by run-invalidation.mjs).
//
// The runner sets a JSON scene state { mounted, dataKey, time, reps: [{ kind,
// props }] }. Prop values are interned by their JSON, so a value the runner
// leaves unchanged keeps its object identity across updates: only the edited
// prop is new, exactly as in an app that edits one prop. String tokens name
// non-JSON values (selections, colour fields).
//
// Components are imported from their own modules (not ../src/index.mjs) and
// the counters from the internal instrumentation module, which is not public.
import { render, use, useState } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, AmbientLight, DirectionalLight, FontLoader, SDFFontProvider, useDeviceContext } from '@use-gpu/workbench';
import { bondTopology, coordinateBounds, createStructure, withPositions } from '@molgpu/table';
import { where, resolve } from '@molgpu/select';
import { byElement, colormap, curve } from '@molgpu/fields';
import { structureFromBcif } from '@molgpu/io';
import { Structure } from '../src/structure.mjs';
import { Spacefill } from '../src/spacefill.mjs';
import { Bonds } from '../src/bonds.mjs';
import { BallAndStick } from '../src/ball-and-stick.mjs';
import { Tube } from '../src/tube.mjs';
import { Ribbon } from '../src/ribbon.mjs';
import { Surface } from '../src/surface.mjs';
import { Label, Distance } from '../src/annotations.mjs';
import { TimelineProvider } from '../src/timeline-context.mjs';
import {
  enableInstrumentation, instrumentDevice, resetCounters, snapshotCounters, deviceBufferOrigins,
} from '../src/internal/instrumentation.mjs';

enableInstrumentation();
const probe = window.__inv = { errors: [], mounted: false, renders: 0 };
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function (...args) {
  const device = instrumentDevice(await request.apply(this, args));
  device.addEventListener('uncapturederror', (e) => probe.errors.push(e.error.message));
  return device;
};

// 1crn (crambin, 327 atoms, one chain with helices and a sheet). The base
// dataset carries EXPLICIT bonds (table's inference, frozen as explicit), so a
// coordinate edit has no connectivity-dependent topology work to do.
const bytes = new Uint8Array(await (await fetch('/packages/io/test/fixtures/1crn.bcif')).arrayBuffer());
const raw = await structureFromBcif(bytes);
const withBonds = (data, keep) => {
  const inferred = bondTopology(raw);
  const rows = [...Array(inferred.count).keys()].filter(keep);
  return createStructure({ positions: data.positions, topology: { ...data.topology, bonds: {
    count: rows.length, a: Uint32Array.from(rows, (r) => inferred.a[r]), b: Uint32Array.from(rows, (r) => inferred.b[r]),
    order: new Uint8Array(rows.length).fill(1), source: rows.map(() => 'explicit'),
  } } });
};
const base = withBonds(raw, () => true);
const moved = withPositions(base, base.positions.map((v, i) => v + (i % 3 === 0 ? 0.25 : -0.1)));
// Connectivity change: a new topology (every other bond dropped), same atoms.
const rebonded = withBonds(raw, (r) => r % 2 === 0);
const DATA = { base, moved, rebonded };

// Selections resolve per dataset identity; `moved` shares base's identity.
const residueRange = (label, lo, hi) => where('atom', label, (d, i) => {
  const r = d.topology.atoms.residue[i];
  return r >= lo && r < hi && !d.topology.atoms.altloc[i];
});
const QUERIES = { A: residueRange('A', 0, 20), B: residueRange('B', 10, 40), C: residueRange('C', 30, 46) };
const selections = new Map();
const selectionFor = (key, data) => {
  const id = `${key}@${data === rebonded ? 'rebonded' : 'base'}`;
  if (!selections.has(id)) selections.set(id, resolve(QUERIES[key], data));
  return selections.get(id);
};
// Churn selections: many distinct residue windows.
for (let k = 0; k < 64; k++) QUERIES[`W${k}`] = residueRange(`W${k}`, k % 40, (k % 40) + 1 + (k % 7));

// Colour fields: two distinct instances of the same element field (a field
// swap that reads the same columns), and a clock-driven field (curve:t).
const FIELDS = {
  'field:element': byElement(),
  'field:element2': byElement(),
  'field:clock': colormap(curve([[0, 0], [1, 1]]), [[0, [0.2, 0.4, 0.9, 1]], [1, [0.9, 0.3, 0.2, 1]]]),
};

const interned = new Map();
const intern = (value) => {
  if (value === null || typeof value !== 'object') return value;
  const key = JSON.stringify(value);
  if (!interned.has(key)) interned.set(key, value);
  return interned.get(key);
};
const resolveProps = (props, data) => Object.fromEntries(Object.entries(props).map(([name, value]) => {
  if ((name === 'select' || name === 'a' || name === 'b') && typeof value === 'string') return [name, selectionFor(value, data)];
  if (typeof value === 'string' && value in FIELDS) return [name, FIELDS[value]];
  return [name, intern(value)];
}));

const KINDS = { spacefill: Spacefill, bonds: Bonds, ballAndStick: BallAndStick, tube: Tube, ribbon: Ribbon, surface: Surface, label: Label, distance: Distance };

const bounds = coordinateBounds(base);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));

const Scene = () => {
  const [state, setState] = useState({ mounted: false, dataKey: 'base', time: 0, reps: [] });
  probe.set = (next) => setState(next);
  probe.mounted = true;
  probe.renders += 1;
  const data = DATA[state.dataKey];
  const children = state.reps.map(({ kind, props }) => use(KINDS[kind], resolveProps(props, data)));
  return use(TimelineProvider, { time: state.time, children:
    state.mounted ? use(Structure, { data, children }) : null });
};

const App = () => {
  useDeviceContext();
  return use(OrbitCamera, { radius: extent * 1.6, target: bounds.center, children:
    use(Pass, { lights: true, children: [
      use(AmbientLight, { color: [1, 1, 1], intensity: 0.3 }),
      use(DirectionalLight, { position: [1, 2, 1.5], color: [1, 1, 1], intensity: 1 }),
      use(Scene, {}),
    ] }) });
};

probe.reset = () => resetCounters();
probe.snapshot = () => ({ ...snapshotCounters(), errors: [...probe.errors] });
probe.origins = () => deviceBufferOrigins();

render(use(WebGPU, {
  fallback: (e) => { probe.errors.push(String(e)); return null; },
  children: use(FontLoader, { fonts: [{ family: 'sans', style: 'normal', weight: 400, src: '/spikes/examples/assets/font.ttf' }], children:
    use(AutoCanvas, { selector: '#stage', samples: 1, backgroundColor: [0, 0, 0, 1], children:
      use(SDFFontProvider, { children: use(App, {}) }) }) }),
}));
