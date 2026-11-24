# use.gpu simplification pass

Date: 2026-11-24. Baseline: `origin/main` `802842d`. Branch:
`simplify/use-gpu-primitives`, one commit per item. Pinned use.gpu: `0.21.0`.
The Beads database was not available in the review orb, so no issues were filed;
`molgpu-sept-mzt` (OIT routing) is the one existing issue this work addresses.

The review compared viewer code against the installed use.gpu source. The raw
compute and readback paths keep their recorded reasons
([native compute audit](2026-10-02-native-compute-audit.md),
[ordered kernels](2026-10-04-superpose-ordered-kernels.md)); 0.21.0 does not
remove them: `Readback` still has no source token, `useReadbackStorage` drops a
copy when its slots are mapped, and `ComputeBuffer` never destroys.

## Items 1–4: replace hand-rolled mechanics with use.gpu

| # | Change                                                                                                                                                 | Evidence                                                                                                                                                  |
| - | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 | Bonds use `LineLayer segment: 1`; per-vertex atom rows are derived in WGSL from the endpoint column. The default/explicit colour switch is style-only. | `run-gate2`, `run-invalidation` (switch now `styleOnly`), `run-components`; Gate 2 canvases pixel-identical to main.                                      |
| 2 | UnitCell, Distance, Ramachandran and FieldLines use the scalar `segment` prop instead of uploaded segment columns.                                     | `run-annotations`, `run-efield` (CI's `MOLGPU_SKIP_TIMING=1`), `run-trajectory`, `run-invalidation`.                                                      |
| 3 | Assembly copies provide `useCombinedMatrixTransform` as `TransformContext` (upstream `ConeHelper` pattern) instead of hand-written affine WGSL.        | `run-tube`, `run-ribbon`, `run-surface`, `run-materials`; Tube/Ribbon/Surface assembly canvases pixel-identical before and after, translated and rotated. |
| 4 | `DrawMode` accepts use.gpu's `"oit"`; GPU-sourced positions carry bounds for OIT draws. README, docs and site demos use `mode="oit"` in `<Pass oit>`.  | `run-postprocess` counts draws in `OITPass/Transparency` and fails on use.gpu's missing-bounds warning; that check fails on the previous source.          |

Item 4 corrects the October 15 counter-review. Scene components cannot read
`usePassContext()`: `Renderer` provides `PassContext` only inside its quoted
draw tree (`render/renderer.mjs`), and a representation calling it throws
"Required context 'PassContext' was used without being provided". Automatic OIT
detection would need a quote round trip with a one-frame delay, so OIT is the
caller's explicit layer mode, as it is for use.gpu layers. Bounds for live atoms
and sticks are the root extent, padded; motion past it only coarsens OIT depth
weighting (`oit/oit.wgsl` floors the weight).

## Items 5–9: remove duplicated molgpu mechanics

Each item keeps behaviour and instrumentation counters unless stated.

5. **One selection gate.** Bonds, BallAndStick, Tube, Surface, Ribbon/Cartoon
   and Label repeat the same `SelectionConsumer` wrapper that strips the
   diagnostics and narrows `select`. Replace them with one helper in
   `selection/selection-consumer.ts`. Validate with `run-selection`,
   `run-components` and `typecheck:components`. **Done:**
   `selected(who, Resolved)` and the `Resolved<P>` type replace six wrappers and
   six prop declarations.
6. **One opacity/colour prelude.** `checkOpacity`, the field test, the
   opacity-scaled flat colour and `modeProps` are repeated per representation,
   and three volume visuals build the same RGBA tint inline. Fold them into one
   `rendering/opacity.ts` helper. Validate with `opacity.test.ts`,
   `run-materials`, `run-postprocess` and `run-invalidation`.
7. **Reuse `VertexFieldColors`.** `FieldBonds` and `FieldPoints` repeat its
   field inputs, `useField` and `useOpacityColors` sequence. Validate with
   `run-gate2`, `run-selection` and `run-invalidation`.
8. **Shared raw-GPU boilerplate.** The surface, SES and DSSP jobs repeat a
   transient-buffer allocator and a one-shot read; eight modules repeat a
   per-device compute-pipeline cache and bind-group mapping; 19 files redefine
   buffer usage flags. Share them without changing labels, ownership or
   destruction points. Validate with `run-gpu-dssp`, `run-ses-field`,
   `run-surface`, `run-efield`, `run-trajectory` and `run-retirement`.
9. **Test-only and duplicated helpers.** `pointer-plane.ts` re-derives use.gpu's
   view ray (`useViewContext().pick` plus `@use-gpu/interact`
   `intersectRayPlane`); `buildBondColumns` is a test oracle in `src`; most of
   `line-size.ts` is reached only by tests; row equality is written three times.
   Validate with the site tug check, unit tests and `run-tube`.

## Not changed

- `useRawSource`/`getScratchSource` for draw-bound allocations: no ownership
  tracking, no refcounted per-device cache, silent buffer growth.
- `ComputeBuffers` for EField, ElasticNetwork or FieldLines targets: it always
  destroys; those owners release without destroying.
- `<Pick>` re-renders its pickable on hover changes; the cost is unmeasured and
  the October 15 decision prefers `<Pick>`.
- Unverified retirement risk, outside this pass: the GPU surface mesh and the
  DSSP code buffer are destroyed on replacement while draws reference them;
  `run-surface` covers bursts but no held-compilation case was found.
