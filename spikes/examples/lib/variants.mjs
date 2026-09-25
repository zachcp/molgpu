// A toolbar of named variants for a gallery example: one button per key in
// `variants` (each a () => element), the current one marked aria-current.
// `?v=<key>` picks the starting variant. Same pattern as ex/select.mjs, shared
// so single-knob representation examples stay a screen long.
//
// Each variant is keyed, so switching remounts it rather than editing props in
// place. Variants are distinct scenes, so that is the honest model — and it
// sidesteps molgpu-sept-jrr: a style-only prop edit (e.g. <Tube radius>)
// under a stable <Pass> updates the draw's uniforms but schedules no redraw.
import { use, keyed, useState } from '@use-gpu/live';

let setCurrent = null;

const Variant = ({ render }) => render();

const sync = (which) => {
  for (const btn of document.querySelectorAll('#toolbar button')) {
    btn.setAttribute('aria-current', String(btn.dataset.v === which));
  }
};

const VariantView = ({ variants, initial }) => {
  const [which, set] = useState(initial);
  setCurrent = set;
  sync(which);
  window.__variant = which;
  // Keys only reconcile within an array; a lone keyed child is matched by position.
  return [keyed(Variant, which, { render: variants[which] })];
};

export function withVariants(variants) {
  const keys = Object.keys(variants);
  const asked = new URLSearchParams(location.search).get('v');
  const initial = keys.includes(asked) ? asked : keys[0];
  const bar = document.getElementById('toolbar');
  bar.innerHTML = '';
  for (const key of keys) {
    const btn = document.createElement('button');
    btn.textContent = key;
    btn.dataset.v = key;
    btn.addEventListener('click', () => setCurrent?.(key));
    bar.appendChild(btn);
  }
  return use(VariantView, { variants, initial });
}
