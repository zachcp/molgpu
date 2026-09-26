# molgpu examples gallery

One browsable page for every `@molgpu/viewer` representation and the stories
built on them. Each `?ex=` entry is a module in `ex/` exporting
`{ title, camera?, body }`, mounted by `harness.mjs`; representation examples
add a toolbar of variants (`lib/variants.mjs`, also selectable as `&v=<name>`).

```bash
cd spikes/examples && npm i
npx vite .          # http://localhost:5185
```

Package docs: [table](../../packages/table/README.md) ·
[select](../../packages/select/README.md) · [fields](../../packages/fields/README.md) ·
[io](../../packages/io/README.md) · [geo](../../packages/geo/README.md) ·
[timeline](../../packages/timeline/README.md) · [viewer](../../packages/viewer/README.md)

| Example | Shows | Variants |
|---|---|---|
| `?ex=scene` | the composed crambin figure: tube fold, ball-and-stick site, spacefill callouts | `&site=`, `&shell=`, `&tube=` |
| `?ex=select` | Gate 2: one selection + one colour field driving `<Spacefill>`/`<BallAndStick>` | all · sulfur · cys · near · shell |
| `?ex=lighting` | one sphere under a world-fixed key light — drag to see the lit side move | — |
| `?ex=timeline` | Gate 3: a slider scrubs three named beats (colour field + camera focus) | slider |
| `?ex=bonds` | `<Bonds>`: sticks from bond topology, split into element colours | element · flat · cys only |
| `?ex=tube` | `<Tube>`: GPU-extruded backbone; a gapped selection ends the run | thin · thick · gapped |
| `?ex=ribbon` | `<Ribbon>`: secondary-structure cartoon (real 1CRN BinaryCIF, for its helices) | smooth · coarse · with tube |
| `?ex=surface` | `<Surface>`: solvent-excluded molecular surface | opaque · no probe · glass |
| `figure.html` | Phase 5 showcase: PBR + SSAO/outline/OIT, picking + click-to-seek, `<Label>`/`<Distance>` | — |

`figure.html` is standalone rather than a `?ex=` entry: it needs the viewer's
own `<Pass>` (postprocessing), a `<PickingProvider>` and the font stack, which
the shared harness's fixed `Pass` + lights cannot host.

`deno task test:examples` (from the repo root) drives the gallery in Chrome
WebGPU: the scene's reactive-render contract, the lighting orbit, the timeline
scrub, and **every representation variant painting the molecule** (and
differing from its siblings). `deno task test:examples:figure` smoke-tests the
figure. The focused regression harnesses in `packages/viewer/test`
(`run-tube.mjs`, `run-ribbon.mjs`, `run-surface.mjs`, `run-gate2.mjs`, …) stay:
they check invariants a picture cannot, such as a style edit uploading zero new
GPU buffers.

## Historical layer notes

The notes below come from the earlier per-layer spike gallery (`?ex=points`,
`lines`, `trace`, `faces`, `material`, `labels`, `adapter`, `linemin`,
`facemin`), since deleted (molgpu-sept-s15). They still document how the
use.gpu layer conventions were found.

**Every example must be verified to render by screenshot.** That discipline is
not optional: `DualContourLayer` is present in the package and completely broken
(see `docs/findings/2026-09-15-s3-molecular-surface.md`), so presence is not
usability.

## Important: RawData component vs useRawSource hook

They are **not** interchangeable, but the reason is narrower than first recorded.

**Corrected 2026-09-17-b.** The original rule here said `segments` through the
hook was the problem. It is not: `segments` is `i32` and works through either
path. The broken column is **`positions`**, because `useRawSource` uploads
`array.buffer` verbatim while `RawData` pads for GPU layout — and `vec3<f32>` is
the one format that needs padding (`UNIFORM_ARRAY_DIMS['vec3<f32>']` is `3.5`,
i.e. 3 floats on the CPU, 4 slots on the GPU). Through the hook the shader reads
a 16-byte stride from a 12-byte-packed buffer, so every position after the first
is wrong, which is what produced the "cross-pair connectors".

**Rule: never put a `vec3<f32>` column through `useRawSource`.** Use the
`RawData` component (or `ColumnSource`, which wraps it).

See it directly: `?ex=adapter&rep=bonds` vs `?ex=adapter&rep=bonds&src=hook` —
identical data and props, only the positions source differs. Isolated further in
`packages/viewer/test/` (`hook-segments` renders correctly, `hook-all` does not).
`docs/findings/2026-09-17-rawdata-hook-vs-component.md` still carries the old
framing and needs updating.

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

**A singular `position` is a `vec4`, so pass `[x, y, z, 1]`.** `LabelLayer`
(and `PointLayer` etc.) bind a lone `position` prop as a `vec4<f32>` constant;
a bare `[x, y, z]` gets `w = 0`, which projects to infinity, so the glyphs
land off-screen — **a blank label with no error at all**, while the atlas,
shaping and draw call all look healthy. `<Label>`/`<Distance>` in
`@molgpu/viewer` pad their anchors for you. Also note the text prop is
`label`/`labels`, not `text` — an unknown prop just draws zero glyphs.

**`@use-gpu/glyph` must be in `optimizeDeps.exclude`.** It uses a Rust/wasm text
shaper and vite's dep optimizer breaks the wasm init
("Cannot read properties of undefined (reading 'userusttext_new')"). Meanwhile
the other `@use-gpu/*` packages must be in `optimizeDeps.include`, because their
ESM default-imports lodash CJS submodules. `@use-gpu/wgsl` ships precompiled
`.wgsl.js` with an export map, so it needs no loader — do not exclude it.

**`PointLayer` sizing:** `depth: 1` is world-space and perspective-correct,
`depth: 0` is pixels. `WorldSpacePointLayer` accepts physical radii in Ångström
and derives PointLayer's camera-normalized diameter from the live view uniforms;
it responds to viewport, DPR, FOV, focus, and perspective/orthographic changes.

## Process note

Two false alarms cost real time, both from the same cause: **the browser console
accumulates across navigations in a reused tab**, so errors from an earlier
example look like errors from the current one. Both `LineLayer` and the bonds
example were briefly misdiagnosed as broken upstream this way. When checking
whether something errors, load it in a **fresh tab**.
