// Example loader. Each module in ex/ exports { title, camera?, body }.
//
// The old per-layer gallery was deleted: those spikes tripped a per-frame
// PickingTarget readback-buffer realloc loop (visible thrash on real GPUs; see
// molgpu-sept-s15) and are being replaced with the new component format. The
// composed `scene` is the one that stayed clean and is kept as the reference.
import { mount } from './harness.mjs';

const EXAMPLES = {
  scene: () => import('./ex/scene.mjs'),
  select: () => import('./ex/select.mjs'),
  lighting: () => import('./ex/lighting.mjs'),
  timeline: () => import('./ex/timeline.mjs'),
  bonds: () => import('./ex/bonds.mjs'),
  tube: () => import('./ex/tube.mjs'),
  ribbon: () => import('./ex/ribbon.mjs'),
  surface: () => import('./ex/surface.mjs'),
};

const which = new URLSearchParams(location.search).get('ex') ?? 'scene';
const load = EXAMPLES[which] ?? EXAMPLES.scene;

const mod = await load();
document.getElementById('title').textContent = mod.title;
for (const a of document.querySelectorAll('nav a')) {
  if (a.dataset.ex === which) a.setAttribute('aria-current', 'page');
}
window.__example = EXAMPLES[which] ? which : 'scene';
mount(mod.body(), { ...mod.camera, cameraComponent: mod.cameraComponent, pass: mod.pass });
