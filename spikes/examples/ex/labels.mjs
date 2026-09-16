// LabelLayer — flat text anchored to 3D positions.
//
// Text needs TWO providers above the layer, plus a real font file:
//   FontLoader       loads the font data (@use-gpu ships no default font)
//   SDFFontProvider  owns the signed-distance-field glyph atlas
// Without SDFFontProvider you get "Required context 'SDFFontContext' was used
// without a provider".
//
// Build note: @use-gpu/glyph uses a Rust/wasm text shaper, and vite's dep
// optimizer breaks its wasm init. It must be in optimizeDeps.exclude.
import { use } from '@use-gpu/live';
import { RawData, FontLoader, SDFFontProvider, LabelLayer } from '@use-gpu/workbench';

export const title = 'LabelLayer — text';
export const camera = { radius: 20 };

const FONTS = [{ family: 'Roboto', weight: 400, style: 'normal', src: './assets/font.ttf' }];

export function body() {
  const positions = Float32Array.from([-6, 0, 0,  0, 4, 0,  6, 0, 0]);
  const labels = ['CYS-3', 'THR-1', 'ILE-7'];

  return use(FontLoader, { fonts: FONTS, children:
    use(SDFFontProvider, { children:
      use(RawData, { data: positions, format: 'vec3<f32>', render: (posSrc) =>
        use(LabelLayer, {
          positions: posSrc, labels, count: labels.length,
          family: 'Roboto', weight: 400,
          size: 32, depth: 0, color: [0.92, 0.94, 0.98, 1],
        }),
      }),
    }),
  });
}
