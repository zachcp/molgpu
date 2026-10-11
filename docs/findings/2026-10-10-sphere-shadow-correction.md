# Native sphere shadow correction

Date: 2026-10-10. Bead: `molgpu-sept-hr8`. Baseline: `bea37a3` on
`codex/clipping-and-rendering-spikes`. Pinned use.gpu `0.20.0`; no dependency
upgrade, raw WebGPU rendering, new representation or public signature change.

## Decision and source evidence

Retain native PointLayer for visible spheres and native ShadowRender for their
shadow draws. Correct two inputs inside WorldSpacePointLayer:

- Convert world radii using WGSL `getWorldScale(1, 1)` from the active pass,
  rather than a JavaScript uniform computed from the application camera. The
  existing radii source and one display-scale uniform supply sizes in both
  views.
- Scope native VariantContext adaptation to this layer's shaded ShadowRender.
  Supply the existing shaded `getVertex` as `getVertexDepth` and withdraw the
  color-only `getFragment` for that variant. The native `getSurface` still
  carries ray-traced sphere position, depth, normals and material alpha. Other
  variants and application-provided custom renderers keep their original
  components.

Installed `layers/point-layer.mjs` chooses `traceSphereQuad` for shaded points.
`primitives/raw-quads.mjs` supplies a solid quad for `getVertexDepth` and a
color-only material fragment. In `render/forward/shadow.mjs`, that fragment
selects `renderVirtualDepth`/`renderFragmentDepth`, bypassing the ray-traced
surface. Removing the fragment selects the native shaded depth path, which
requires the shaded vertex. Fixing sizing alone cannot correct this branch. All
of these adapters are existing workbench exports. Direct WGSL use is declared at
the same exact pin in the viewer manifest and lockfile.

Alternatives: a dependency upgrade would change the reviewed stack; copying
RawQuads would duplicate material/picking/scissor/instancing mechanics; a custom
sphere proxy would replace behavior already provided by native machinery. A
narrow native variant adapter is sufficient for the demonstrated shadow bug. No
buffers or teardown paths are introduced by the correction.

## Executable acceptance

Run `deno test -A packages/viewer/test/run-sphere-shadow.mjs`. It compares two
intersecting unit spheres with a 96×48 mesh oracle. Both sphere and mesh draw
into the same native light/pass composition. The fixture ground has a downward
normal matching its winding; the camera sees its back face, which native shading
flips upwards. The original spike fixture's upward normal had hidden ground
shadows by lighting that face downwards. Historical spike evidence remains
unchanged.

Readiness observes color object draws, completed asynchronous pipeline creation,
a new camera-triggered draw, actual shadow draws and submitted queue completion.
There is no timer used as a GPU readiness signal. Ground-shadow masks compare
against both the mesh and a scene with sphere casting disabled, establishing an
actual shadow rather than an aggregate brightness discrepancy.

Perspective, orthographic, off-axis and near-plane-adjacent (`near=5.5`, camera
radius 7) comparisons pass. The first isolated run reports mean RGB channel
errors of 0.409, 0.741, 0.452 and 0.960 on a 0–255 scale. Ground masks disagree
on roughly 5–6% of the sphere-shadow pixels, within the 15% tolerance for mesh
faceting and shadow filtering. The final report is saved in
[evidence](evidence/2026-10-10-sphere-shadow.json).

The runner also checks native environment pixel changes, SSAO/outline
compilation, source/count and cast replacement, storage allocation/upload reuse
at 100k, and uncaptured WebGPU errors through unmount. Camera update plus
queue-completion samples include host orchestration and polling; they are not
GPU timestamps or an isolated rendering benchmark. See the saved final report
for measurements.

## Near-plane intersection limitation

A distinct camera-path failure is reproduced when the near plane intersects the
spheres (`near=6.3`). The corrected path and the original native pass-aware size
candidate both disagree with the mesh on about 35% of visible union pixels. The
native shaded quad is clipped to a narrow strip while the mesh retains the far
sphere surface. This predates the shadow adapter and is not corrected here.
`molgpu-sept-m0y` tracks native proxy placement and near/far ray-hit handling.
The runner characterizes the limitation explicitly; it does not claim full
near-plane intersection acceptance. Keep `hr8` in progress until review/merge,
with this acceptance exception visible to the reviewer.

## Verification

- Package hardening passes all eight packages; public API snapshots unchanged.
- JSR publish dry run passes; nothing published.
- Public component type checks and scoped formatting/lint pass.
- Final sphere shadow runner passes (74 seconds), including environment pixel
  changes, SSAO/outline, source/cast replacement, zero additional molecular
  storage allocations/uploads during 100k camera/roughness edits, and error-free
  unmount.
- Existing postprocess, picking and invalidation/lifetime runners: 83 passed,
  zero failed, 28 ignored. Ignored matrix entries are inapplicable combinations.
  Replacement/unmount and selection-churn checks pass.

These are scoped checks, not a clean full viewer GPU gate. Earlier probe
failures were a hidden ground-shadow fixture and the reproduced near-plane
intersection limitation; neither is omitted from this record. A later upload
probe initially counted all native storage writes, including light-system
updates during camera changes. Its failed assertion was corrected to observe the
large 100k molecular columns (400k/1.6M bytes), excluding legitimately updated
light storage.
