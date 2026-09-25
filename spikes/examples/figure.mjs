// The Phase 5 figure: every appearance/interaction piece composed on one real
// structure (crambin / 1CRN), through the @molgpu/viewer components.
//
//   - PBR materials + lights (ambient / directional / dome) .... hj0.1
//   - SSAO + outline + OIT postprocessing on <Pass> ............ hj0.2
//   - a pickable representation with a hover tooltip and
//     click-to-seek-a-beat on the timeline ................... hj0.3
//   - a centroid-anchored <Label> and a <Distance> ............ hj0.4
//
// This is a standalone page, not a gallery <harness.mount> example: the shared
// harness owns a fixed <Pass>+lights, but this needs the viewer's own <Pass>
// (for ssao/outline/oit), a <PickingProvider>, and the font stack
// (<FontLoader> + <SDFFontProvider>) around everything.
import { render, use, useState } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, FontLoader, SDFFontProvider, useDeviceContext } from '@use-gpu/workbench';
import { coordinateBounds } from '@molgpu/table';
import { where, resolve, element } from '@molgpu/select';
import { createTimeline } from '@molgpu/timeline';
import {
  Structure, Ribbon, Surface, Spacefill,
  Pass, AmbientLight, DirectionalLight, DomeLight,
  PickingProvider, usePicking, tooltipFields,
  Label, Distance,
  TimelineProvider, createStructureResource, createCameraCurve, useCameraCurve,
} from '@molgpu/viewer';
import { attribute } from '@molgpu/fields';
import { crambinStructure } from './lib/crambin-structure.mjs';

const data = crambinStructure();
const resource = createStructureResource(data);
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
const lastResidue = data.topology.residues.count - 1;

// Selections (values that compose): the interactive site is the sulfurs; the
// distance spans the first residue to the last.
const sulfurs = resolve(element(16), data);
const firstRes = resolve(where('atom', 'first-res', (d, i) => d.topology.atoms.residue[i] === 0), data);
const lastRes = resolve(where('atom', 'last-res', (d, i) => d.topology.atoms.residue[i] === lastResidue), data);

// Three beats; clicking an atom seeks to 'focus', which tightens the camera
// onto the sulfurs.
const beats = createTimeline([
  { name: 'overview', time: 0 },
  { name: 'inspect', time: 2 },
  { name: 'focus', time: 4 },
]);
const cameraCurve = createCameraCurve([
  { time: beats.time('overview'), target: bounds.center, radius: extent * 2.0, bearing: 0.6, pitch: 0.35, ease: 'hold' },
  { time: beats.time('inspect'), target: bounds.center, radius: extent * 1.7, bearing: 1.1, pitch: 0.3 },
  { time: beats.time('focus'), focus: element(16), bearing: 1.6, pitch: 0.25 },
]);

// Tooltip content: a couple of @molgpu/fields values, plus the plain-string
// identifiers read straight from the table (names are not numeric fields).
const tipFields = { 'Z': attribute('element'), 'B-factor': attribute('bfactor') };
const identify = (atom) => {
  const r = data.topology.atoms.residue[atom];
  return `${data.topology.residues.comp[r]} ${data.topology.residues.authSeq[r]} · ${data.topology.atoms.name[atom]}`;
};

let seekTo = null;
const setReadout = (hit) => {
  const el = document.getElementById('hover');
  if (!el) return;
  if (!hit) { el.textContent = 'hover an atom of the sulfur sites'; return; }
  const t = tooltipFields(tipFields, data, hit.atom);
  el.textContent = `${identify(hit.atom)}  ·  Z=${t.Z}  ·  B=${t['B-factor'].toFixed(1)}   (click to focus)`;
};

const Readout = () => {
  usePicking({ onHover: setReadout, onPick: (hit) => { if (hit) seekTo?.(beats.time('focus')); } });
  return null;
};

const CameraPose = ({ children }) => {
  const pose = useCameraCurve(cameraCurve, resource, { atomRadiusScale: 0.5 });
  return use(OrbitCamera, { ...pose, children });
};

const Figure = () => {
  useDeviceContext();
  const [time, setTime] = useState(0);
  seekTo = setTime;
  window.__figure = { time, beats: beats.beats };
  const slider = document.getElementById('scrub');
  const readout = document.getElementById('beat');
  if (slider) slider.value = String(time);
  if (readout) {
    const beat = [...beats.beats].reverse().find((b) => time >= b.time)?.name ?? 'overview';
    readout.textContent = `${time.toFixed(2)} s · ${beat}`;
  }

  return use(TimelineProvider, { time, children: use(CameraPose, { children:
    // hj0.2 — SSAO (gentle, so crevices read without going black), a
    // silhouette-only outline, and OIT for the translucent surface.
    use(Pass, { ssao: 0.35, outline: { outer: 1.5, inner: 0, color: [0.02, 0.03, 0.05, 0.6] }, oit: true, picking: true, lights: true, children: [
      // hj0.1 — key/fill lights plus a soft environment dome.
      use(AmbientLight, { intensity: 0.35 }),
      use(DirectionalLight, { intensity: 1.1 }),
      use(DomeLight, { intensity: 0.55 }),
      use(Structure, { data, children: [
        // The fold, matte PBR.
        use(Ribbon, { material: { metalness: 0.0, roughness: 0.5 }, color: [0.86, 0.55, 0.35, 1] }),
        // A faint glassy solvent surface — the OIT case; kept very transparent
        // and smooth so it haloes the fold rather than hiding it.
        use(Surface, { resolution: 0.5, color: [0.55, 0.72, 0.98, 1], opacity: 0.12, material: { metalness: 0.0, roughness: 0.25 } }),
        // The interactive sulfur sites: pickable, glossy, outlined (hj0.3).
        use(Spacefill, { select: sulfurs, scale: 0.6, color: [0.98, 0.82, 0.2, 1], material: { metalness: 0.5, roughness: 0.3 }, pickable: true }),
        // Centroid-anchored annotations (hj0.4): the S–S label at the sulfur
        // centroid (lifted clear of the distance readout) and a distance across
        // the fold. zBias keeps the text from sinking into the surface.
        use(Label, { select: sulfurs, text: 'S–S core', family: 'sans', size: 28, detail: 48, color: [1, 1, 0.8, 1], zBias: 8, offset: [0, 36] }),
        use(Distance, { a: firstRes, b: lastRes, family: 'sans', size: 20, detail: 36, color: [0.7, 0.9, 1, 1], zBias: 8 }),
      ] }),
      use(Readout, {}),
    ] }) }) });
};

render(use(WebGPU, {
  fallback: (e) => { document.getElementById('err').textContent = 'WebGPU: ' + (e?.message ?? e); return null; },
  children: use(FontLoader, { fonts: [{ family: 'sans', style: 'normal', weight: 400, src: './assets/font.ttf' }], children:
    use(AutoCanvas, { selector: '#stage', samples: 4, backgroundColor: [0.05, 0.06, 0.075, 1], children:
      use(SDFFontProvider, { children:
        use(PickingProvider, { children: use(Figure, {}) }) }) }) }),
}));

// Toolbar wiring.
const slider = document.getElementById('scrub');
if (slider) slider.addEventListener('input', (e) => seekTo?.(Number(e.target.value)));
