// Example switcher. Each module in ex/ exports { title, camera?, body }.
import { mount } from './harness.mjs';

const EXAMPLES = {
  adapter:   () => import('./ex/adapter.mjs'),
  align:     () => import('./ex/align.mjs'),
  scene:     () => import('./ex/scene.mjs'),
  tube:      () => import('./ex/tube.mjs'),
  select:    () => import('./ex/select.mjs'),
  structure: () => import('./ex/structure.mjs'),
  points:   () => import('./ex/points.mjs'),
  lines:    () => import('./ex/lines.mjs'),
  trace:    () => import('./ex/trace.mjs'),
  faces:    () => import('./ex/faces.mjs'),
  material: () => import('./ex/material.mjs'),
  labels:   () => import('./ex/labels.mjs'),
  linemin:  () => import('./ex/linemin.mjs'),
  facemin:  () => import('./ex/facemin.mjs'),
};

const which = new URLSearchParams(location.search).get('ex') ?? 'points';
const load = EXAMPLES[which] ?? EXAMPLES.points;

const mod = await load();
document.getElementById('title').textContent = mod.title;
for (const a of document.querySelectorAll('nav a')) {
  if (a.dataset.ex === which) a.setAttribute('aria-current', 'page');
}
window.__example = which;
mount(mod.body(), mod.camera ?? {});
