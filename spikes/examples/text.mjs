// Minimal repro for hj0.6: a single upstream <LabelLayer> in the standard
// FontLoader + SDFFontProvider + Pass setup. The glyphs SHAPE and RASTERIZE
// (window.__text below shows a resolved font stack, 5 glyphs, and a populated
// SDF atlas with non-zero glyph mappings) but nothing paints on screen — so the
// failure is isolated to the RawLabels on-screen draw, not font/shaping/atlas.
import { render, use, useOne } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, AmbientLight, DirectionalLight, FontLoader, SDFFontProvider, LabelLayer,
  useFontContext, useFontFamily, useFontText, useSDFFontContext } from '@use-gpu/workbench';

// Reports the shaper/atlas state to window.__text for the bead's investigation.
const Diagnose = () => {
  const rust = useFontContext();
  const stack = useFontFamily('sans', 400, 'normal');
  const { glyphs } = useFontText(stack, ['HELLO'], 96);
  const sdf = useSDFFontContext();
  useOne(() => {
    const info = { stack: [...stack], glyphCount: glyphs?.length ?? 'none', hasRust: !!rust, hasSdf: !!sdf };
    try { const g = sdf.getGlyph(stack[0], 0, 96); info.cachedGlyph = g ? { mapping: g.mapping, hasMetrics: !!g.glyph } : 'null'; } catch (e) { info.getGlyphError = String(e); }
    try { info.atlas = sdf.__debug?.atlas ? { w: sdf.__debug.atlas.width, h: sdf.__debug.atlas.height } : 'none'; } catch (e) { info.atlasErr = String(e); }
    window.__text = info;
  }, [rust, sdf, glyphs]);
  return null;
};

const Scene = () =>
  use(OrbitCamera, { radius: 8, target: [0, 0, 0], children:
    use(Pass, { lights: true, children: [
      use(AmbientLight, { intensity: 0.6 }),
      use(DirectionalLight, { direction: [-1, -2, -1.5] }),
      use(LabelLayer, { position: [0, 0, 0], text: 'HELLO', family: 'sans', size: 96, color: [1, 1, 1, 1] }),
      use(Diagnose, {}),
    ] }) });

render(use(WebGPU, {
  fallback: (e) => { document.getElementById('err').textContent = 'WebGPU: ' + (e?.message ?? e); return null; },
  children: use(FontLoader, { fonts: [{ family: 'sans', style: 'normal', weight: 400, src: './assets/font.ttf' }], children:
    use(AutoCanvas, { selector: '#stage', samples: 4, backgroundColor: [0.05, 0.06, 0.08, 1], children:
      use(SDFFontProvider, { children: use(Scene, {}) }) }) }),
}));
