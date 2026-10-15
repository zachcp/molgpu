# use.gpu-native transparency, world-unit sizing and interaction

Date: 2026-10-15. Status: **design proposal, awaiting counter-review**. No
implementation. Tracking bead: see `molgpu-sept-` design bead referencing this
file.

## Source of the advice

Steven Wittens (use.gpu author) reviewed the site demos and docs and made four
points:

1. Order-independent transparency needs layer `mode="oit"`, not
   `mode="transparent"`.
2. Points and lines that cast shadows need `depth={-1}` so their size is in
   world units; otherwise the shadow map and the visible view size them
   inconsistently.
3. Camera controls rebuilt on `useMouseState`/`useWheelState` cannot stop the
   browser from scrolling while zooming the widget. Use `useCanvasEvents` with
   classic `pointerDown`/`pointerMove`/`pointerUp`/`wheel` handlers and call
   `event.preventDefault()`. The built-in `OrbitControls` in `@use-gpu/interact`
   shows the pattern.
4. The built-in `<Pick>` component is better suited to mouse picking than our
   reimplementation. `useMouseState` exists mainly to hook simple shaders to the
   mouse, not for complex interactions.

## Verification against the pinned source (0.21.0-rc.4)

Evidence levels: **S** = source-reviewed in the installed pinned package, **R**
= reproduced, **U** = upstream author statement not yet independently checked.

| # | Claim                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Evidence                               | Where we fall short today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| - | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | `mode` selects the render component per pipeline; `forward-renderer.mjs` maps `solid`/`shaded` × `{opaque, transparent, oit}` and only `oit` reaches `OITSolidRender`/`OITShadedRender`. `transparent` goes to plain `SolidRender`/`ShadedRender`. `OITSolidRender` throws `"OIT mode used inside a pass without oit={true}"` without an OIT target.                                                                                                                                                | S                                      | `rendering/opacity.ts` `modeProps` only ever yields `"transparent"`. Every representation using it (spacefill, bonds, tube, ribbon, surface, annotations, unit-cell, isosurface, field-arrows/lines, volume-slice) therefore never feeds the OIT pass. The viewer README tells users to add `<Pass oit>` "so overlapping translucent geometry composites correctly" — under the current code that has no effect on our layers. The site enables `oit: true` on four demos for the same non-effect. 0vs.8's "constant/flat equivalence under OIT" acceptance compared two non-OIT draws. |
| 2 | `PointLayer`/`LineLayer` accept `depth`; `rendering/line-size.ts` documents `getWorldScale()` as absolute for `depth < 0`.                                                                                                                                                                                                                                                                                                                                                                          | S (line), U (point shadow consistency) | `WorldSpacePointLayer` uses `depth: 1` plus a CPU factor from the main view's uniforms (`pointSizeForRadius`, `useRepaint`). In the shadow pass the light's view differs, so this is exactly the inconsistency Wittens describes. `molgpu-sept-hr8` (in progress, unmerged commit `0b93545` on `codex/clipping-and-rendering-spikes`, written against 0.20.0) works around it by moving sizing into active-pass WGSL while keeping `depth: 1`. `tube.ts` and `bonds.ts` (when shadowed/shaded) already use `depth: -1`. `BallAndStick` documents "balls do not cast".                   |
| 3 | `@use-gpu/frame` exports `useCanvasEvents(id, callbacks)` and `useObjectEvents`. `@use-gpu/interact@0.21.0-rc.4` `OrbitControls` subscribes `pointerDown/Move/Up/wheel` via `useCanvasEvents(-id, …)` (catch-all, lowest priority), calls `preventDefault()` + `stopPropagation()`, uses pointer capture past a drag threshold, and exposes `radius/bearing/pitch/target` through a render prop with `version` to reseed. Default bindings: left = rotate, right or shift-left = pan, wheel = zoom. | S                                      | `site/src/demos/viewer.tsx` `OrbitControls` and `dynamics.tsx` `TugControls` read `useMouseState`/`useWheelState` in `useResource`. Nothing calls `preventDefault` on wheel, so page scroll leaks while zooming (source-reviewed; not yet reproduced in a browser). `dynamics.tsx` adds a raw `contextmenu` DOM listener to compensate for right-drag.                                                                                                                                                                                                                                  |
| 4 | `@use-gpu/interact` exports `<Pick>` with `onPointerOver/Out/Down/Up/Move(e, index)`, `capture`, `all`, and a render-prop `PickState`. It is built on `usePickingId` + `useCanvasEvents`.                                                                                                                                                                                                                                                                                                           | S                                      | `interaction/picking.ts` `usePicking` re-samples the picking buffer on every `useMouseState` change via `usePickingContext().samplePoint`, and derives the press edge itself. Our `PickingProvider` registry and `resolvePick` (id → structure, selection indices, operator) remain necessary: `<Pick>` yields `(id, index)`, not an atom.                                                                                                                                                                                                                                              |

Dependency note: `@use-gpu/interact` depends on `@use-gpu/frame`,
`@use-gpu/workbench` and `@use-gpu/plot` (the latter for `Gizmo`) and is
published only on the GitLab npm registry, like the rest of the pin. It is not
in our workspace today.

## Proposed design rules (to canonize after counter-review)

These would be added to `docs/DESIGN.md` (pillars 7 and 8) and summarized in
`AGENTS.md` "Composition and GPU Work":

- **R1 Translucency means OIT when the pass offers it.** A molecular
  representation that is translucent (explicit or automatic) draws with
  `mode: "oit"` when the enclosing pass has an OIT target, and `"transparent"`
  (sorted blend) otherwise. The decision lives in one viewer helper next to
  `modeProps`; users keep writing `opacity`/`mode` props and `<Pass oit>`.
  Explicit `mode` stays an override, now including `"oit"`.
- **R2 Molecular sizes are world units at the layer.** Any point or line whose
  size is an Ångström quantity uses the layer's native world-unit mode
  (`depth: -1`) instead of converting through camera uniforms. Screen-space
  sizing (`depth >= 0`) is reserved for annotations and UI that should not cast
  shadows. This removes per-camera CPU factors and makes shadow, picking and
  colour passes agree by construction.
- **R3 Interaction uses canvas events, not polled state.** Interactive controls
  (orbit, tug, measure, click-to-seek) subscribe through `useCanvasEvents` /
  `useObjectEvents`, consume what they handle with `preventDefault()` /
  `stopPropagation()`, and use pointer capture for drags. `useMouseState` /
  `useWheelState` are only for shaders that read the cursor.
- **R4 Upstream controls and `<Pick>` before our own.** Prefer
  `@use-gpu/interact` `OrbitControls` and `<Pick>` where they meet the
  requirement; keep molecular meaning (atom row, selection, operator, timeline
  beat) in our registry layer on top of `<Pick>`'s `(id, index)`. Record a
  concrete reason when we keep a custom control (as AGENTS.md already requires
  for raw WebGPU exceptions).

## Questions for the counter-review

1. **OIT detection.** Is reading the pass's OIT target from the viewer (via
   `usePassContext`/render context) the right mechanism, or should `oit` be an
   explicit molgpu context/prop? What do non-`solid`/`shaded` pipelines (e.g.
   `ui`, custom raw draws in bezbox/ribbon/surface/volume) do with `"oit"`, and
   which representations must stay `"transparent"`?
2. **`depth: -1` for spheres vs hr8.** Does `depth: -1` on `PointLayer`'s shaded
   sphere impostor preserve the ray-traced depth/normals that x0p/hr8 rely on,
   and does it make hr8's WGSL sizing unnecessary? Should hr8 be rebased onto
   this rule, superseded, or merged first? (The m0y near-plane bug is separate.)
3. **Dependency.** Add `@use-gpu/interact` (and transitively `@use-gpu/plot`) to
   the exact pin for the viewer package, the site only, or not at all — writing
   thin controls directly on `useCanvasEvents` instead? JSR consumer and
   `published-imports` implications.
4. **Controlled cameras.** `CurveOrbitControls` drives target/radius from the
   timeline every frame. Upstream `OrbitControls` reseeds only via `version`.
   Can the curve own target/radius while the user owns bearing/pitch/zoom, or do
   we need our own control on `useCanvasEvents`?
5. **Gesture conflicts.** Upstream orbit uses right-drag for pan; the dynamics
   demo uses right-drag on an atom to tug. Does `<Pick capture>` on the atom
   correctly pre-empt the `-id` catch-all orbit handler?
6. **Public API.** Should `usePicking` stay as a convenience built on `<Pick>`
   (same `{ hover, pick }` shape) or be replaced by a molecular `<Pick>`
   wrapper? `api.txt` and README impact.

## Proposed follow-ups (to file only after counter-review)

- F1 Route translucent representations to `"oit"` under `<Pass oit>`; fix README
  and site claims; add a browser check that the OIT pass actually receives draw
  calls and that overlapping translucent order changes nothing.
- F2 Adopt `depth: -1` for world-unit points/lines that may cast shadows;
  reconcile with hr8; colour/shadow silhouette comparison as acceptance.
- F3 Replace demo orbit controls with canvas-event controls that stop page
  scroll; browser check that wheel over the canvas does not scroll the page.
- F4 Rebuild `usePicking`/tug/measure on `<Pick>` (or `useObjectEvents`) while
  keeping `PickingProvider` resolution; drop the raw `contextmenu` listener if
  capture covers it.
- F5 Canonize R1–R4 in `docs/DESIGN.md` and `AGENTS.md`.

## Validation performed for this proposal

Source inspection only: installed `@use-gpu/workbench`, `@use-gpu/frame`,
`@use-gpu/wgsl` 0.21.0-rc.4 under `node_modules`, and the
`@use-gpu/interact-0.21.0-rc.4` tarball from the configured registry, read in a
scratch directory. No tests or browser suites were run; no failure has been
reproduced in a browser yet.

## Counter-review

An independent counter-review is in
[2026-10-15-use-gpu-native-interaction-counter-review.md](2026-10-15-use-gpu-native-interaction-counter-review.md).
It agrees with R1–R4 with changes, adds the OIT position-bounds prerequisite,
keeps hr8's shadow adapter alongside `depth: -1`, and recommends against adding
`@use-gpu/interact` as a dependency. Its corrections take precedence over this
proposal where they conflict.

## Owner decision (2026-10-15)

Always use use.gpu primitives. This overrides the counter-review's
recommendation against the dependency: add `@use-gpu/interact` at the exact
0.21.0-rc.4 pin and use its `OrbitControls` and `<Pick>`. Its undeclared imports
`@use-gpu/traits` and `@use-gpu/parse` (from `orbit-controls.mjs` and
`fps-controls.mjs`) and its dependency `@use-gpu/plot` are mapped explicitly at
the same pin. A custom control needs a recorded reason that upstream cannot meet
the requirement.

Follow-ups: F3 `molgpu-sept-wg5`, F2 folded into `molgpu-sept-hr8`, F1
`molgpu-sept-mzt`, F4 `molgpu-sept-ps8`, F5 `molgpu-sept-7kh`.
