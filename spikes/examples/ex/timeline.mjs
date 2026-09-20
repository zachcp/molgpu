// Gate 3: one controlled seconds value drives a molecule field and camera.
// Drag the slider in either direction; no snapshot-local or wall clock exists.
import { use, useState } from '@use-gpu/live';
import { OrbitCamera } from '@use-gpu/workbench';
import { coordinateBounds } from '@molgpu/table';
import { where, resolve, toAtoms } from '@molgpu/select';
import { colormap, curve } from '@molgpu/fields';
import { createTimeline } from '@molgpu/timeline';
import { Structure, Spacefill, BallAndStick, TimelineProvider, createStructureResource,
  createCameraCurve, useCameraCurve } from '@molgpu/viewer';
import { crambinStructure } from '../lib/crambin-structure.mjs';

export const title = 'Global timeline — Gate 3';

const data = crambinStructure();
const resource = createStructureResource(data);
const bounds = coordinateBounds(data);
const extent = Math.max(...bounds.max.map((v, i) => v - bounds.min[i]));
const beats = createTimeline([
  { name: 'overview', time: 0 },
  { name: 'colour', time: 2 },
  { name: 'focus', time: 4 },
]);
const firstResidue = where('residue', 'first residue', (_data, row) => row === 0);
const selected = toAtoms(resolve(firstResidue, data), data);

const cameraCurve = createCameraCurve([
  { time: beats.time('overview'), target: bounds.center, radius: extent * 1.9, bearing: 0.6, pitch: 0.35, ease: 'hold' },
  { time: beats.time('colour'), target: bounds.center, radius: extent * 1.9, bearing: 0.6, pitch: 0.35 },
  { time: beats.time('focus'), focus: firstResidue, bearing: 1.2, pitch: 0.25 },
]);
const color = colormap(curve([
  [beats.time('overview'), 0],
  [beats.time('colour'), 1],
  [beats.time('focus'), 1],
]), [[0, [0.21, 0.45, 0.82, 1]], [1, [0.91, 0.39, 0.23, 1]]]);

let setTime = null;
const display = (time) => {
  const readout = document.getElementById('timeline-readout');
  const slider = document.getElementById('timeline-slider');
  if (slider) slider.value = String(time);
  const beat = [...beats.beats].reverse().find((b) => time >= b.time)?.name ?? 'overview';
  if (readout) readout.textContent = `${time.toFixed(2)} s · ${beat}`;
};

const CameraPose = ({ children }) => {
  const pose = useCameraCurve(cameraCurve, resource, { atomRadiusScale: 0.35 });
  window.__timeline.pose = pose;
  return use(OrbitCamera, { ...pose, children });
};

export const cameraComponent = ({ children }) => {
  const [time, update] = useState(0);
  setTime = update;
  window.__timeline = { time, setTime: update, beats: beats.beats };
  display(time);
  return use(TimelineProvider, { time, children: use(CameraPose, { children }) });
};

export function body() {
  const bar = document.getElementById('toolbar');
  bar.innerHTML = `<label for="timeline-slider">Scrub</label>
    <input id="timeline-slider" type="range" min="0" max="4" step="0.01" value="0" aria-label="Timeline time in seconds">
    <output id="timeline-readout" for="timeline-slider">0.00 s · overview</output>`;
  bar.querySelector('#timeline-slider').addEventListener('input', (event) => setTime?.(Number(event.target.value)));
  return use(Structure, { data, children: [
    use(Spacefill, { scale: 0.35, color }),
    use(BallAndStick, { select: selected, ball: 0.4, stick: 0.24 }),
  ] });
}
