# Counter-review: use.gpu-native transparency, world-unit sizing and interaction

Date: 2026-10-15. Reviews
[2026-10-15-use-gpu-native-interaction-review.md](2026-10-15-use-gpu-native-interaction-review.md)
(bead `molgpu-sept-dnh`). Review only: no source changes.

Evidence labels: **S** = source-reviewed in the installed pinned 0.21.0-rc.4
packages (or the extracted `@use-gpu/interact@0.21.0-rc.4` tarball), **R** =
reproduced, **U** = upstream-author claim not independently checked. The only
thing run was `deno test -A packages/viewer/test/opacity.test.ts` (4 passed). It
pins today's `"transparent"` output and proves nothing about OIT. No browser
suite was run, so nothing here is **R** in a browser.

## Summary

The four upstream points hold up in the source, but the proposal understates how
much work two of them need:

1. **OIT needs position bounds, and most molgpu draws have none.** `OITPass`
   computes a tight near/far range from the `bounds` of every `oit` call. It
   uses that range to weight each fragment. Our live coordinate streams, GPU
   surface meshes and `indexed()` shader-wrapped positions carry no `.bounds`.
   Switching `modeProps` to `"oit"` alone would produce a `console.warn` for
   each boundless call on every frame. If every OIT call lacks bounds, the range
   becomes `NaN` (S). F1 has to include a bounds plan.
2. **`depth: -1` does not supersede hr8.** It replaces hr8's _sizing_ half,
   which is simpler and agrees across passes by construction. rc.4 still sends a
   shadow-casting shaded `PointLayer` down the flat masked-quad shadow path. It
   bypasses the ray-traced surface, so hr8's `ShadowRender` variant adapter is
   still required (S).
3. **Interaction semantics are partly misdescribed.** A `-id` handler is a
   catch-all that runs only when nothing holds capture. Its priority comes from
   tree position: dispatch runs in reverse tree order, so descendants go first.
   It is not "lowest priority" by itself. Upstream `OrbitControls` reseeds when
   its `radius`/`target`/`bearing`/`pitch` props _change_ (`useDerivedState`
   tracks the initial value's identity), not only through `version`. And
   `<Pick capture>` captures on every button, which breaks the dynamics demo's
   "left = orbit, right on atom = tug" split if used as-is (S).

## 1. Evidence table, row by row

### Row 1: mode → render component (verified, with additions)

- `queue/draw-call.mjs` yields `{ [mode]: { draw, bounds } }`. Passes read
  `calls['opaque']`, `calls['transparent']`, `calls['oit']` (S).
- `pass/variants.mjs` resolves
  `components.renders[renderer]?.[mode] ??
  components.modes[mode]`.
  `forward-renderer.mjs` and `deferred-renderer.mjs` both map `solid`/`shaded` ×
  `{opaque, transparent, oit}`. In both, only `oit` reaches
  `OITSolidRender`/`OITShadedRender`. Deferred maps `transparent` to the
  _forward_ `SolidRender`/`ShadedRender`, not the deferred ones (S).
- `ColorPass` draws `opaque`, then `transparent` sorted back to front **per draw
  call by `bounds`** (`drawToPass(..., -1)`). A call with no bounds gets depth
  `true` and is not sorted. The proposal's "sorted blend" fallback is therefore
  not sorted for our boundless draws today (S).
- `OITPass` only reads `calls['oit']`. So under `<Pass oit>`, `transparent`
  draws never reach it. The README and site `oit: true` claims are confirmed to
  have no effect on molgpu layers (S).
- **Missed by the proposal: bounds.** `OITPass` builds a box from each `oit`
  call's `bounds`. With no bounds it warns "OIT cannot be applied to an object
  without position bounds." inside the per-frame lambda. It then sets
  `viewNearFar` from that box. `getOITSample` weights by
  `relativeZ = (|z| -
  near)/(far - near)`.
  - An empty box gives `center = NaN`, so `near`/`far = NaN`.
  - Mixed bounded and unbounded calls give a range that excludes the unbounded
    ones, which distorts their weights.
  - `RawQuads`/`RawLines`/`RawFaces` take bounds only from
    `props.positions.bounds` (or `mesh.bounds`). Our `RawData`-backed CPU
    columns have them. `coordinates.source`, GPU surface `StorageSource`s and
    `indexed(...)` wrappers do not (S).
- **Missed: no OIT for `ui`.** `ui` has no `oit` entry. `getRender` returns
  `undefined`, so `useDraw` emits nothing, or only the picking variant when
  other variants are active. An explicit `mode: "oit"` on a label or
  SDF-rectangle draw would silently disappear (S). Today none of our
  representations route `modeProps` into a `ui` layer: annotations apply it to
  lines only.
- **Correction: no custom raw draws.** Ribbon, surface, isosurface and
  volume-slice all use `FaceLayer`. No molgpu source calls `useDraw`/`drawCall`
  or a custom renderer. The only `ui` draws are labels, and Ramachandran is a 2D
  overlay hard-coded to `"transparent"` (S). The question about raw draws
  ("ribbon/surface/bezbox/volume") does not apply.
- **Missed: translucent draws never cast shadows.** Shadow and normal variants
  are added only for `mode === 'opaque' && HAS_SHADOW`. Picking is added for any
  mode, so `oit` draws stay pickable (S).
- **Missed: blend state.** `usePipelineOptions` sets fragment blend state only
  for `opaque`/`transparent`. For `oit` it leaves blend to the OIT target's
  render context. `transparent` keeps the context's default depth write (S).
- 0vs.8's "constant/flat equivalence under OIT" compared two non-OIT draws.
  `run-postprocess.mjs` only checks pipeline and texture counts, which `OITPass`
  allocates whether or not any `oit` call exists (S).

### Row 2: depth and point size (verified; consequence corrected)

From `instance/vertex/quad.wgsl` and `use/view.wgsl` (sourcesContent in the
`.js.map`):

- `PointLayer` builds rectangles as `±0.5 × size`, so **`size` is a diameter**
  (S).
- `getWorldScale(w, depth)` returns `1.0` for `depth < 0`.
  `getScreenScale(w, depth<0) = 1/(viewWorldScale.x · w)`.
  - In `OrbitCamera` with dolly 1, `viewWorldScale.x = 2·tan(fov/2)/height`.
  - In the shadow passes it is the shadow unit (world per texel).
  - So with `depth: -1`, both the solid and shaded quads have a half-extent of
    `size/2` _world units_ in the color, picking and shadow views (S).
- At `depth: 1`, `w` cancels within a view, which is why the current CPU factor
  works in the main view. The factor is computed from the main view's
  `viewWorldScale`/`viewPixelRatio`, so it is wrong in the shadow view. That
  matches upstream point 2 (S for the mechanism; the visible symptom was
  measured by hr8 on 0.20.0).
- The shaded sphere impostor still works under `depth: -1`.
  `getQuadVertexShaded` carries `worldTangent = (center, size)`, and
  `traceSphereQuad`/`getRaytraceSurface` ray-trace from it. Nothing in that path
  depends on the depth mode except the size. `size` includes the half-pixel edge
  bleed converted to world units, which was already true at `depth: 1`. This is
  S only; still verify silhouettes in a browser.
- What `depth: -1` does **not** fix: `ShadowRender` (rc.4,
  `render/forward/shadow.mjs`) picks `renderVirtualShaded` +
  `renderFragmentDepthShaded` only when `!getFragment && getSurface`. `RawQuads`
  passes the material's `getFragment` (every shaded material context has one)
  and a _solid_ `getVertexDepth` when `shadow` is set. A shadowed shaded point
  therefore still casts a flat masked disc at the sphere centre's depth, not
  ray-traced sphere depth. That is the branch hr8's `SphereShadowRender` adapter
  fixes. It is unchanged from 0.20.0 to rc.4 (S).
- Prior caveat: `docs/findings/2026-09-17-selections-and-cartoon.md` saw a
  `LineLayer` at `depth: -1` with `width >= ~3` render nothing (0.20.0). The
  2026-09-20 contract finding later established `depth: -1` lines as reliable.
  Atom diameters (~3–4 Å) fall in the range that caveat named, so check points
  explicitly.
- Bonds use `depth: -1` only when shaded or shadowed. Unshaded bonds use the
  default (screen-space). R2 as worded would change unshaded bond width
  semantics; see R2 below.

### Row 3: canvas events (verified, with corrections)

From `frame/mjs/providers/event-provider.mjs` and
`frame/mjs/event/dom-events.mjs`:

- `useCanvasEvents(id, callbacks)`:
  - With an `id`, it wraps each callback as `{id, callback}`. Without one, the
    callbacks are plain handlers.
  - The provider annotates every event with `pickId`/`pickIndex`, sampled from
    the picking buffer (`webgpu` `DOMEvents` passes
    `usePickingContext().samplePoint`).
  - It then dispatches **in reverse tree order**:
    - a handler whose `id === e.pickId` always runs;
    - a handler with `id < 0` runs only when nothing holds capture;
    - a plain handler runs only when nothing holds capture;
    - `e.propagationStopped` breaks the loop.

  Capture state is re-read for each handler, so a descendant that calls
  `beginCapture` + `stopPropagation` pre-empts ancestors in the same dispatch
  (S).
- `-id` is a "catch-all for any id while nobody holds capture". Upstream
  `OrbitControls` is effectively lowest priority because it yields its handlers
  _before_ its children, and dispatch runs in reverse order. Priority comes from
  tree position, not the sign (S).
- Wheel: `el.addEventListener('wheel', f, { capture: !!capture })`, with no
  `passive` flag, on the canvas element. Browsers default to `passive: true`
  only for window/document/body, so `e.preventDefault()` from a wheel handler is
  honoured (S).
- `useMouseState`/`useWheelState` really cannot prevent scroll.
  `EventStateProvider` copies the event into Live state. Consumers run in a
  later render, after the native event has finished dispatch. The smallest fix
  is a plain `useCanvasEvents(null, { wheel: e => e.preventDefault() })` next to
  the existing control (S). Page scroll leaking during zoom has not been
  reproduced in a browser.
- `AutoCanvas` (`events` and `picking` both default true) mounts `PickingTarget`
  and `DOMEvents` with `pickPoint`. The site's AutoCanvas wiring therefore
  already supports `useCanvasEvents`/`useObjectEvents`/`<Pick>` (S).
- Two things `DOMEvents` already does:
  - It calls `element.setPointerCapture` on **every** `pointerdown`. R3's "use
    pointer capture for drags" therefore means use.gpu's pick-id capture
    (`usePointerCapture().beginCapture`), which routes events and is a different
    mechanism from DOM capture.
  - It subscribes `contextMenu` → `preventDefault` on the canvas. The raw
    `contextmenu` listener in `dynamics.tsx` is already redundant, whether or
    not capture is used (S).
- `site/src/styles.css` already sets `touch-action: none`. This matters because
  `EventProvider` only prevents `touchmove` once capture is held, after the drag
  threshold (S).

### Row 4: `<Pick>` (verified, with additions)

- `<Pick>` accepts **`id`**. Without one it allocates its own through
  `usePickingId`. Our `Pickable` already allocates from the same `EventContext`
  allocator, so `<Pick id={pickableId}>` or `useCanvasEvents(pickableId, …)`
  attaches to existing ids without a second id space (S).
- `capture` calls `beginCapture(e)` + `stopPropagation()` on _every_
  `pointerDown`, whatever the button (S). See question 5.
- `usePicking` re-samples `samplePoint` even though the provider already put
  `pickId`/`pickIndex` on the event. That is redundant but cheap. The real
  defect is semantics: no capture, no `stopPropagation`, and a press edge
  derived from polled state. In the measure demo a left click picks _and_ starts
  an orbit rotate (S).

### Dependency note (corrected)

- `@use-gpu/interact` declares frame, workbench and plot as dependencies. It
  also imports `@use-gpu/traits/live` and `@use-gpu/parse` without declaring
  them. Those are present transitively, but `node_modules/.deno` already holds
  both `traits@0.21.0-rc.3` and `rc.4`.
- `index.mjs` re-exports `Gizmo`, which statically imports `@use-gpu/plot`, so
  any root import pulls in plot.
- There is no `exports` map. A narrower deep import such as
  `@use-gpu/interact/mjs/handlers/pick.mjs` would be possible, but it hard-codes
  layout paths.
- Recent work had to special-case the Math ESM entry (commit `9ac0926`). Expect
  similar entry and JSR-consumer work for each new use.gpu package (S).

## 2. Open questions

1. **OIT detection.** `usePassContext` is exported from `@use-gpu/workbench`.
   `Renderer` provides `PassContext` (`targets.oit` set when `<Pass oit>`) to
   all children, so a representation can read it directly. That is the right
   mechanism: the application keeps owning the pass, and there is no parallel
   molgpu flag to keep in sync.
   - Give the helper a hook form (e.g. `useDrawMode(mode, alpha)`). `modeProps`
     stays a pure function so it can still be unit-tested.
   - Clamp an explicit `"oit"` to `"transparent"` outside an OIT pass, or throw
     a molgpu error. Upstream throws from inside a render component.
   - Never apply the helper to `ui` layers (labels) or to the 2D Ramachandran
     overlay.
   - An app-level alternative is
     `<Pass components={{ renders: { solid: {
     transparent: OITSolidRender }, … } }}>`,
     which needs no molgpu changes. But `OITSolidRender`/`OITShadedRender` are
     not exported from `render/index.mjs`, so it would need deep imports. Not
     recommended.
   - **Blocking prerequisite:** every `oit` draw needs `positions.bounds`.
     Candidates are CPU `StructureBounds` (with padding for radii) or
     `useCoordinateBounds`, which is asynchronous and must name its generation.
     Attach them to the source object passed to the layer. Sources wrapped with
     `indexed()` lose `.bounds`, so attach after wrapping or carry bounds
     separately. Bounds must also follow live coordinates, or the near/far range
     will lag.
2. **`depth: -1` vs hr8.** It preserves the ray-traced depth and normals (S). It
   makes hr8's `getWorldScale(1,1)` sizing shader, the CPU factor and
   `useRepaint` unnecessary. It does **not** make hr8's shadow-variant adapter
   unnecessary. Recommendation:
   - Rebase hr8 from 0.20.0 to rc.4.
   - In that rebase, replace its sizing half with `depth: -1` and
     `getSize = 2 · radius · scale`.
   - Keep `SphereShadowRender`.
   - Re-run `run-sphere-shadow.mjs` as the acceptance check.

   This is complementary to hr8, not a supersession. m0y stays separate.
3. **Dependency.** Do not add `@use-gpu/interact` to the viewer package. Its
   value to us is about 60 lines (`Pick`) plus about 150 (`OrbitControls`), and
   it costs plot, an undeclared traits/parse coupling, ESM-entry and
   JSR-consumer work. Our controls need behaviour it lacks anyway (questions 4
   and 5). Write thin controls on `useCanvasEvents` in the viewer or site,
   citing upstream (MIT) as the pattern. Revisit for the site only if a standard
   orbit demo is wanted as an "idiomatic use.gpu" example.
4. **Controlled cameras.** Upstream reseeds each of radius/bearing/pitch/target
   whenever its prop _value identity_ changes, not only on `version`. A curve
   driving `target`/`radius` every frame would reset user zoom whenever the
   curve radius moves. Our control composes zoom as a multiplier on the curve
   radius, which upstream cannot express. Keep a custom control on
   `useCanvasEvents` and record that as the concrete R4 reason (S).
5. **Gesture conflicts.** `<Pick capture>` on an atom does pre-empt the ancestor
   `-id` orbit. It runs first in reverse tree order, captures, and stops
   propagation. Later moves and ups go only to the captured id (S). But it
   captures on **every** button. With Spacefill covering most of the canvas, a
   left drag starting on an atom would then never orbit. Upstream's default
   right-drag pan would also collide with tug. Use a handler on the `Pickable`
   id that captures and stops propagation only for `e.button === 'right'`, and
   disable or rebind pan.

   For click-to-pick and measure, act on `pointerUp` when `gestureX/Y` is below
   a threshold, so that dragging to orbit does not also pick.
6. **Public API.** Keep `usePicking` with the same `{ hover, pick }` shape and
   options. Reimplement it as a catch-all `useCanvasEvents` subscriber that
   reads `e.pickId`/`e.pickIndex` and resolves through the registry. This
   removes re-sampling and polling, and `api.txt` stays unchanged.
   - Hover will then pause while another control holds capture (e.g. mid-orbit).
     Document that.
   - A separate molecular `Pick` wrapper (render prop over the `Pickable` id)
     can be added later, as an additive advanced export, if per-representation
     handlers are needed (tug).

## 3. Verdicts

| Item | Verdict                          | Notes                                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1   | **Agree with changes**           | Detect through `usePassContext().targets.oit`. Every `oit` draw must carry position bounds, or it is not OIT-eligible. Clamp or validate an explicit `"oit"` outside an OIT pass. Exclude `ui`/2D layers. Add `"oit"` to `DrawMode` (api.txt, README). Weighted blended OIT is order-independent but approximate, so drop "composites correctly" wording.         |
| R2   | **Agree with changes**           | Scope to _molecular geometry_. Ångström-sized shaded or shadowed points and lines use `depth: -1`. Unshaded bonds currently use screen-space width on purpose. Shadow consistency also needs the hr8 variant adapter for impostor spheres, and translucent draws never cast. "Picking agrees by construction" was already true, since picking uses the main view. |
| R3   | **Agree with changes**           | Specify use.gpu pick-id capture, not DOM capture (already automatic). State priority as tree order. Act on pointer-up with a gesture threshold to separate click from drag. Capture only for the bound button. `useMouseState` remains acceptable for passive readouts, not only shaders.                                                                         |
| R4   | **Agree with changes**           | "Prefer upstream _patterns_." Do not add `@use-gpu/interact` as a dependency (question 3). Reasons to keep custom controls are already concrete (questions 4 and 5).                                                                                                                                                                                              |
| F1   | **Agree with changes; re-scope** | Start with a browser repro: OIT call count, warning spam, NaN near/far. Then add bounds plumbing, routing and the README/site/`opacity.test.ts` updates. Acceptance: OIT pass receives N calls, no warnings, output independent of draw order, plus a pixel comparison against a sorted reference for one surface.                                                |
| F2   | **Agree; fold into hr8**         | Reuse hr8 rather than filing a new issue. Re-run `run-sphere-shadow.mjs`. Verify large-diameter points at `depth: -1` (the old LineLayer caveat).                                                                                                                                                                                                                 |
| F3   | **Agree; do first**              | Cheapest fix with a visible effect. A one-line wheel `preventDefault` stops the leak before any control rewrite. A browser check (wheel over the canvas leaves `scrollY` unchanged) is easy. Consider scroll trapping on a docs page with many embeds, e.g. zoom only when focused or with a modifier.                                                            |
| F4   | **Agree with changes**           | Build on `useCanvasEvents` with the `Pickable` id. `<Pick>` is optional. The raw `contextmenu` listener can be dropped now, since `DOMEvents` already blocks it.                                                                                                                                                                                                  |
| F5   | **Agree, but last**              | Canonize after F1 and F3 evidence. R1 is not yet true by construction while bounds are missing.                                                                                                                                                                                                                                                                   |

## 4. Recommended ordering

1. F3: wheel `preventDefault`, plus a browser scroll check.
2. hr8 rebase onto rc.4, with `depth: -1` sizing folded in (F2).
3. F1 spike: reproduce OIT routing and bounds behaviour, then implement.
4. F4: controls and picking on canvas events.
5. F5: canonize.
