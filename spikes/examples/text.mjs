// Minimal repro + diagnosis for hj0.6: a single upstream <LabelLayer> in the
// standard FontLoader + SDFFontProvider + Pass setup renders NOTHING, with zero
// errors. Instrumentation below drove the root cause (see the bead):
//
//   window.__text  — font stack resolves, 5 glyphs shape, SDF atlas populated.
//   window.__glyph — GlyphSource data is correct (count 5, real rectangles/uvs)
//                    and getAggregateSummary is correct (instanced:1, count:5,
//                    indexed:5).
//   window.__draws / window.__bundleDraws — RawLabels emits NO draw at all,
//                    neither into the render-pass encoder nor a render bundle.
//
// Conclusion: everything up to and including the aggregated draw inputs is
// correct; RawLabels' draw is simply never emitted in this @use-gpu 0.20.0
// environment. Upstream label/aggregate draw-emission issue, not a molgpu bug.
import { render, use, useOne } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, AmbientLight, DirectionalLight, FontLoader, SDFFontProvider, LabelLayer, GlyphSource, RAW_LABEL_SCHEMA,
  useFontContext, useFontFamily, useFontText, useSDFFontContext, useDeviceContext } from '@use-gpu/workbench';
import { getAggregateSummary } from '@use-gpu/core';

// Count GPU draws (pass encoder + render bundles) to prove the label never draws.
window.__draws = []; window.__bundleDraws = [];
const tap = (proto, sink) => {
  if (typeof proto === 'undefined') return;
  proto.__label = '';
  const sp = proto.setPipeline; proto.setPipeline = function (p) { this.__label = p.label ?? ''; return sp.call(this, p); };
  const d = proto.draw; proto.draw = function (v, i, ...r) { sink.push([this.__label, 'draw', v, i ?? 1]); return d.call(this, v, i, ...r); };
  const di = proto.drawIndexed; proto.drawIndexed = function (n, i, ...r) { sink.push([this.__label, 'drawIndexed', n, i ?? 1]); return di.call(this, n, i, ...r); };
  if (proto.drawIndirect) { const o = proto.drawIndirect; proto.drawIndirect = function (...r) { sink.push([this.__label, 'drawIndirect']); return o.apply(this, r); }; }
  if (proto.drawIndexedIndirect) { const o = proto.drawIndexedIndirect; proto.drawIndexedIndirect = function (...r) { sink.push([this.__label, 'drawIndexedIndirect']); return o.apply(this, r); }; }
};
tap(GPURenderPassEncoder?.prototype, window.__draws);
tap(typeof GPURenderBundleEncoder !== 'undefined' ? GPURenderBundleEncoder.prototype : undefined, window.__bundleDraws);

const Diagnose = () => {
  const rust = useFontContext();
  const stack = useFontFamily('sans', 400, 'normal');
  const { glyphs } = useFontText(stack, ['HELLO'], 96);
  const sdf = useSDFFontContext();
  window.__sdf = sdf; window.__device = useDeviceContext();
  useOne(() => {
    const info = { stack: [...stack], glyphCount: glyphs?.length ?? 'none', hasRust: !!rust, hasSdf: !!sdf };
    try { const g = sdf.getGlyph(stack[0], 0, 96); info.cachedGlyph = g ? { mapping: g.mapping } : 'null'; } catch (e) { info.getGlyphError = String(e); }
    window.__text = info;
  }, [rust, sdf, glyphs]);
  return null;
};

const GlyphProbe = () => use(GlyphSource, {
  family: 'sans', weight: 400, style: 'normal', strings: ['HELLO'], size: 96,
  render: (data) => {
    window.__glyph = data ? { count: data.count, summary: getAggregateSummary([{ count: data.count, attributes: data, archetype: 0 }]), schemaKeys: Object.keys(RAW_LABEL_SCHEMA) } : 'null-data';
    return null;
  },
});

const Scene = () =>
  use(OrbitCamera, { radius: 8, target: [0, 0, 0], children:
    use(Pass, { lights: true, children: [
      use(AmbientLight, { intensity: 0.6 }),
      use(DirectionalLight, { direction: [-1, -2, -1.5] }),
      use(LabelLayer, { position: [0, 0, 0], text: 'HELLO', family: 'sans', size: 96, color: [1, 1, 1, 1] }),
      use(Diagnose, {}),
      use(GlyphProbe, {}),
    ] }) });

render(use(WebGPU, {
  fallback: (e) => { document.getElementById('err').textContent = 'WebGPU: ' + (e?.message ?? e); return null; },
  children: use(FontLoader, { fonts: [{ family: 'sans', style: 'normal', weight: 400, src: './assets/font.ttf' }], children:
    use(AutoCanvas, { selector: '#stage', samples: 4, backgroundColor: [0.05, 0.06, 0.08, 1], children:
      use(SDFFontProvider, { children: use(Scene, {}) }) }) }),
}));
