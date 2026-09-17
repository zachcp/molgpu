# use.gpu layer examples

Minimal, verified examples of each use.gpu layer we expect `@molgpu/viewer` to
need. The point is learning the layer API, not building product — every file is
short enough to read in one screen.

```bash
cd spikes/examples && npm i
npx vite .          # http://localhost:5185
```

| Example | Layer | Shows |
|---|---|---|
| `?ex=points` | `PointLayer` | spacefill; 3 bound attribute sources |
| `?ex=lines` | `LineLayer` | bonds as discrete segments |
| `?ex=trace` | `LineLayer` | one continuous polyline (the cartoon path shape) |
| `?ex=faces` | `FaceLayer` | real triangle geometry from a mesh |
| `?ex=material` | `PBRMaterial` | material as a context provider; roughness ramp |
| `?ex=labels` | `LabelLayer` | SDF text anchored to 3D positions |

Plus two isolation harnesses kept because they document how the conventions were
found: `?ex=linemin` (`&seg=1,2,1,2`) and `?ex=facemin` (`&v=tri|both|flat`).

**Every example here was verified to render by screenshot.** That discipline is
not optional: `DualContourLayer` is present in the package and completely broken
(see `docs/findings/2026-09-15-s3-molecular-surface.md`), so presence is not
usability.

## Important: RawData component vs useRawSource hook

They are **not** interchangeable. A `LineLayer` given `segments` from the
`useRawSource` hook ignores the segment codes and draws cross-pair connectors;
the same array through the `RawData` **component** draws correctly. Identical
data, identical props. So: **any source a layer interprets structurally must come
from the component.** See `docs/findings/2026-09-17-rawdata-hook-vs-component.md`.

## The core pattern

Wrap each attribute array in `RawData` to get a `ShaderSource`, then bind the
sources to the layer. Nothing is materialised on the CPU per frame — this is
what makes style changes cheap (INVARIANT 4).

```js
use(RawData, { data: positions, format: 'vec3<f32>', render: (positions) =>
use(RawData, { data: sizes,     format: 'f32',       render: (sizes) =>
  use(PointLayer, { positions, sizes, count, shaded: true, depth: 1 })
})});
```

`harness.mjs` holds the whole bootstrap once: WebGPU device -> canvas -> camera
-> pass -> lights. Each example is just the element handed to it.

## Gotchas, all found the hard way

**`Pass` needs `lights: true`.** Light components otherwise warn
("Light used in a pass without lights enabled") and silently do nothing.

**`LineLayer` `segments` must be bound as `i32`.** The line vertex shader
declares `getSegment` as `i32`; binding `f32` fails WGSL validation
("return statement type must match its function return type, returned 'f32',
expected 'i32'") and draws nothing.

**Line segment codes: `1 = start, 3 = middle, 2 = end`.** (Corrected — an
earlier version of this file guessed wrong.) Every observation fits:
- discrete strokes (bonds): `[1,2]` repeated — start,end,start,end. Verified:
  6 points as `1,2,1,2,1,2` gives exactly 3 strokes.
- one continuous run (traces, tubes): `1,3,3,...,3,2`.
- `1,2,2,3` is start,end,end,middle — which is why it renders as two
  disconnected strokes, not the continuous line the naming suggests.

**Do NOT use the scalar `segment` prop for a continuous run when `shaded`.**
It draws, so it looks correct for flat lines — but with `shaded: true` and
`sides > 0` it extrudes every vertex pair as its own cone, giving a mess of
spikes. Bind per-vertex i32 segments instead. `join: 'round'` is also the only
join that does not leave points (`tangent` and `miter` both spike).

**`FaceLayer` needs `side: 'both'` for `makeSphereGeometry`.** Its winding is
back-facing by use.gpu's convention, so the default `side: 'front'` culls the
entire mesh — **a blank screen with no error at all**.

**`makeSphereGeometry` shape:** `vec4<f32>` positions and normals (**stride 4,
not 3**), `u16` indices, and `count` is the **index** count. At `detail:[24,48]`
that is 6912 indices over 1225 vertices. It is a **unit-diameter** sphere
(coordinates span -0.5..0.5). The u16 indices overflow past ~851 merged spheres.

**`FaceLayer` has no transform prop.** To place a mesh, bake the offset into the
geometry attributes (see `ex/material.mjs`).

**Materials are context providers, not props.** `PBRMaterial` wraps the layers
it applies to. Copy that pattern for appearance state generally.

**Text needs two providers and a real font file.** `FontLoader` (font data) and
`SDFFontProvider` (the glyph atlas). Missing the latter gives "Required context
'SDFFontContext' was used without a provider". `@use-gpu` ships **no** default
font — `assets/font.ttf` here is Roboto (Apache-2.0).

**`@use-gpu/glyph` must be in `optimizeDeps.exclude`.** It uses a Rust/wasm text
shaper and vite's dep optimizer breaks the wasm init
("Cannot read properties of undefined (reading 'userusttext_new')"). Meanwhile
the other `@use-gpu/*` packages must be in `optimizeDeps.include`, because their
ESM default-imports lodash CJS submodules. `@use-gpu/wgsl` ships precompiled
`.wgsl.js` with an export map, so it needs no loader — do not exclude it.

**`PointLayer` sizing:** `depth: 1` is world-space and perspective-correct,
`depth: 0` is pixels. At `depth: 1` the `sizes` value is not raw Angstrom — a
factor of ~296 applied here, which depends on fov and viewport and must be
**derived** in real code, not hardcoded.

## Process note

Two false alarms cost real time, both from the same cause: **the browser console
accumulates across navigations in a reused tab**, so errors from an earlier
example look like errors from the current one. Both `LineLayer` and the bonds
example were briefly misdiagnosed as broken upstream this way. When checking
whether something errors, load it in a **fresh tab**.
