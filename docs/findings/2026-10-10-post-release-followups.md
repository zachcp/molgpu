# Post-release follow-ups

Baseline: `origin/main` at `6e40283` (October 6). Work branch:
`codex/post-release-followups`. Tracking: `e9d`, `ahc.11`, `a70`, `0vs.8`,
`s5o.21`; all IDs have prefix `molgpu-sept-`.

## Checkout and tracker reconciliation

The completed `site-examples-consolidation` branch had the same tree as its
merged commit `8bf1005`. Its dirty evidence, standalone examples and untracked
coverage scripts were preserved in the stash named "Preserve local work before
retiring completed site consolidation, 2026-10-10". The local branch was then
retired; embedded `.claude` worktrees were preserved.

Orientation `634`, health epic `s5o` and review epic `0vs` now have current
notes. `s5o.23` was already implemented in main `58909b2`: a fresh components
run confirmed position-dependent selection updates under nested providers and
the root-only path, so that issue is closed. The implementation follow-ups stay
in progress until their changes land.

## Coordinate snapshot cadence (`e9d`)

`Published` temporarily reports `current: false` for a newly requested
generation. CoordinateSnapshotBoundary used that flag to unmount the shared
ThrottledReadback. Every remount reset its dispatch timestamp and allocated two
staging buffers. Keep the reader mounted while there is demand; gate scheduling,
copying and publication on the source holding its requested generation instead.
Owner/buffer/layout/generation rejection and map completion remain unchanged.

The pinned Live `useResource` implementation was inspected: dependency changes
dispose the previous scheduling effect immediately. Retaining the fiber keeps
its refs and staging buffers across those changes without replacing upstream
primitives or guessing GPU completion with timers.

The real site's playback regression measures a 1.6-second interval with the
Ramachandran subscriber mounted. The interval measures a rate; it is not proof
of GPU completion.

| Case                | Trace rebuilds | Readback dispatches | Budget |
| ------------------- | -------------: | ------------------: | -----: |
| Original main, Tube |             98 |                  98 |      9 |
| Fixed, Tube         |              6 |                   8 |      9 |
| Fixed, Ribbon       |              6 |                   7 |      9 |

The fixed cases allocate no new coordinate-snapshot staging buffers during
playback. The original implementation fails the same test. Components and
readback-identity browser suites pass, including source replacement, resizing
and unmount.

## Shadows (`a70`)

Tube, Bonds and BallAndStick expose `shadow?: boolean`, default false. Bonds use
absolute line sizing when shadows are enabled. BallAndStick forwards the flag
only to its sticks; forwarding it to the balls would enable the known incorrect
PointLayer shadow sizing. Sphere impostors remain the separate `x0p` spike.

The pinned RawLines implementation was inspected: its default is no shadows, and
it explicitly requires absolute sizing for shadow-casting lines. The site
Compose example opts in. Its shadow-pass probe reports one extra draw each for
Tube, sticks and Cartoon, zero for Spacefill and the transparent surface. The
Compose browser run passes. README, changelog and reviewed API snapshot include
the new props.

## Transparency policy (`0vs.8`)

Keep one shared rule: automatic draw mode uses flat colour alpha multiplied by
opacity. Every Field, including constants, and alpha introduced by a material
requires explicit transparent mode unless opacity is already below one. Under
OIT, shader alpha still contributes normally once the layer is transparent.

Alternatives were inspecting private Field nodes, evaluating every row on the
CPU, or making every Field transparent conservatively. Private inspection would
couple viewer to an opaque lower-package representation; CPU evaluation adds
work and cannot resolve all live GPU inputs; always-transparent Fields change
depth and shadow behavior for opaque fields. The explicit policy preserves
existing behavior and is documented in both Translucency and the README.

The executable acceptance example is the postprocess browser fixture's alpha
scene: flat and constant Field alpha, per-row Field alpha, explicit opaque and
transparent modes, opacity changes, and material alpha over overlapping atoms
and a surface. White isolates alpha from the different colour-input paths.

## Lifetime and CI follow-ups

The ElasticNetwork retirement matrix changes reuse the prior local
implementation from `dea3a7e`, excluding its old evidence. It adds 25k/100k-atom
replacement and unmount cases and clears the private diagnostic hook when its
GPU state retires. The runner now waits for fixture initialization rather than
dereferencing an absent scene on a cold load.

The Chrome installation retry reuses `399fd72`. Local shell checks prove success
on attempt two and failure after attempt three with the intended backoffs.
Hosted workflow acceptance is still required; no release is triggered by this
change.

## Validation and release limits

- Unit suite: 563 passed; one localhost permission denial. The denied HTTP Range
  case passed on an authorized retry (one passed, ten filtered out).
- Component and site type checks passed.
- All eight packages passed H1–H6; shadow API additions and the Translucency
  documentation change were reviewed in `api.txt`.
- Whole-workspace JSR publish dry run passed. Nothing was published.
- Motion and Compose site routes pass independently.
- The postprocess alpha scene passes every Field/mode/opacity/material case.
  Opacity and material-alpha changes build no geometry and upload no molecular
  buffers. Materials and Gate 2 browser suites also pass. The final combined
  postprocess/Gate 2/invalidation run passes 83 tests, with 28 inapplicable
  cases ignored.
- Held readback retirement passes for successful and rejected maps under source
  replacement and unmount;
  [dated evidence](evidence/2026-10-10-readback-retirement.json).
- A full site run stopped at the existing surface back-clip assertion:
  background pixels changed from 402594 to 388362, while the test expected an
  increase. This is a reproduced acceptance failure, not a proven production
  clipping defect. The surface scene leaves atoms outside the clip scope, and
  the test can observe them before asynchronous surface drawing completes. Do
  not claim a clean full site or full GPU gate from the passing subsets.

Release PR #87 (`0.3.0`) was mergeable with successful static and all five
WebGPU groups on its existing head. These follow-ups must land and the release
checks must refresh before recommending publication. The separate
sphere-impostor, 100k dynamics profiling, later force models and scientific-view
planning tracks remain outside this implementation batch.

Release preparation also needs the manual package changelog cut required by
`docs/RELEASING.md`: release-please has `skip-changelog: true`, and PR #87
currently changes only the eight versions and its manifest. The package
changelogs still contain Unreleased sections. This assessment does not edit or
merge the release PR.
