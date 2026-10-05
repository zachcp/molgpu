# Post-overhaul architecture and package diligence review

Started 2026-10-04; completed 2026-10-05. Source baseline: freshly fetched
`origin/main` at `8bf1005`. use.gpu: 0.20.0. Tracking: `molgpu-sept-0vs`. The
[plan](2026-10-04-post-overhaul-plan.md) was recorded before delegated code
diligence. The original dirty checkout was preserved; this work lives in the
attached `architecture-second-pass` worktree.

## Recommendation

Keep the eight packages, ten public entries and application-owned use.gpu scene.
The completed `crj` and `ktr` work materially simplified the architecture. This
review of the resulting code found four bounded correctness/contract gaps and
one small duplicate helper, rather than evidence for another broad
reorganization. Correct those gaps before further export pruning or
native-kernel conversions.

Do not reduce cross-package imports by copying data, query or scientific
contracts into viewer. The current dependency directions are appropriate. No new
package, generic dataset node, resource framework or public subpath is needed
for specialized transforms and visuals. No performance improvement is claimed
from source-file or import counts.

## Package-by-package assessment

| Package  | Files / entries | Retain                                                                                    | Action                                                                                                                               |
| -------- | --------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| table    | 17 / 1          | Identity/revisions, immutable-by-contract data, shared molecular/volume/trajectory values | Preserve frame cancellation at the public source boundary (`0vs.6`); optional test-only helper pruning when touching relevant tests. |
| select   | 9 / 1           | Query semantics, scoped evaluation and explicit public barrel                             | Make membership cache keys collision-safe (`0vs.5`); avoid splitting large modules solely by line count.                             |
| fields   | 9 / 1           | Construction/evaluation/WGSL separation and plain binding descriptions                    | No new pure-package defect established; keep runtime binding and transparency decisions in viewer.                                   |
| geo      | 6 / 1           | Pure attributed kernels and established scientific ports                                  | Keep independent nearest-attribution semantics; no measured benefit from moving its 271-line entry implementation.                   |
| io       | 17 / 1          | Lazy Mol* wall, shared transport and format-specific decoding                             | Complete XTC frame cancellation (`0vs.6`); refresh current dependency prose.                                                         |
| dynamics | 24 / 2          | Scientific CPU references, generated licensed data, separate WGSL entry                   | Reuse existing mode-sign helper (`0vs.9`); preserve solver precision and oracles.                                                    |
| timeline | 2 / 1           | Seconds, arbitrary-time sampling and private pinned-core adapter                          | Keep current layout; workbench easing is not contract-equivalent.                                                                    |
| viewer   | 108 / 2         | Ordinary/advanced API, nearest contexts, native per-row kernels, private adapters         | Explicit request outcomes (`0vs.7`), transparency policy (`0vs.8`), corrected raw-compute rationale.                                 |

The [inventory](evidence/2026-10-04-post-overhaul-inventory.json) counts source
files and external specifiers, including type and dynamic imports. No production
sibling-private imports were found. Table/geo have no external production
imports; select/fields/io/dynamics use public table contracts; timeline uses
only its private core adapter. Viewer composes the seven lower packages.

Detailed diligence: [pure packages](2026-10-04-post-overhaul-pure.md),
[IO/science/time](2026-10-04-post-overhaul-science.md), and
[viewer/upstream](2026-10-04-post-overhaul-viewer.md). All packages received
boundary/import/export/layout review and focused source inspection, not an
independent mathematical proof of every algorithm or line-by-line shader audit.

## Findings and bounded work

All issue IDs below carry prefix `molgpu-sept-`.

| Priority / issue | Evidence                                                                                                                        | Required result                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 `0vs.5`       | Public selection probe constructs disjoint five-row sets with the same 32-bit-hash ID. Viewer row/mask caches key on that ID.   | Collision-safe equality/invalidation without unbounded retention; selection/set-operation regressions and browser membership/mask switching.        |
| P2 `0vs.6`       | Public XTC probe resolves after post-byte cancellation; pre-aborted wrapper loses custom reason.                                | Preserve exact abort reason before/after async frame work, with deterministic decode/custom-source regressions.                                     |
| P2 `0vs.7`       | Actual pinned Live request hook loses rejection distinction for undefined; Structure/Volume also suppress other falsy failures. | Explicit success/error outcome; all rejection values reach existing error/status contracts while resolved null and cancellation keep their meaning. |
| P2 `0vs.8`       | Shared mode helper treats all Field alpha as 1; constant translucent fields therefore keep default mode at opacity 1.           | Decide and test field-alpha mode policy with OIT/overlap and unchanged style invalidation. Current documentation states the limitation.             |
| P3 `0vs.9`       | Dense elastic solver repeats the same private sign-normalization helper already used by Lanczos.                                | Reuse that helper twice, preserving f64/f32 pivot distinctions, ordering and scientific tolerances.                                                 |

The selection collision, cancellation and request states are executable
reproductions. Stale rendered selection/mask behavior, source presentation and
translucent overlap consequences are source-confirmed risks until their proposed
browser regressions run. No new general GPU lifetime failure was reproduced.

The [request probe](evidence/2026-10-04-source-failure-probe.ts) uses the actual
source hook through pinned Live ESM with its adjacent import map. Rejections of
undefined, null, false, zero and empty string all miss Structure/Volume's
current truthy error branch; undefined also misses Trajectory's explicit
undefined test. An Error object follows the existing error path. This is
distinct from completed `ktr.5` source ownership/recovery, which tested ordinary
Error rejections.

Prioritize `0vs.5` (membership correctness), then independent cancellation,
source-outcome and transparency repairs. Helper cleanup is lower priority. Beads
carry executable acceptance cases and proportional checks; no artificial serial
dependencies were added between independent fixes.

## Structure, Trajectory and Volume composition

| Scope/value         | Responsibility                                                                                                                                                         | Applicable transforms/visuals                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Structure           | Owns topology, row layout, root coordinates and immutable columns. Resets coordinates, attributes/snapshots and trajectory metadata; inherits independent volume/time. | Atom/bond/polymer/surface visuals, selections, annotations; coordinate and attribute providers.                                      |
| Trajectory          | Coordinates and displayed periodic metadata over nearest Structure. Opening/failed sources preserve upstream coordinates while shadowing outer trajectory metadata.    | UnitCell; default Unwrap box; Superpose first-frame reference. It does not define new topology.                                      |
| Nearest coordinates | Fixed-row stream supplied by Structure or a provider.                                                                                                                  | Transform, NormalMode, ElasticNetwork and explicit-reference Superpose do not require a Trajectory. Unwrap can take an explicit box. |
| Volume              | Independent grid/samples scope, preserving surrounding Structure/trajectory/time.                                                                                      | Isosurface, VolumeSlice, FieldLines and FieldArrows. EField supplies the same scope from molecular coordinates/charges.              |
| Timeline            | Application-owned seconds, independent of dataset scope.                                                                                                               | Explicit curves drive trajectory frame index, transforms and styling; IO trajectory picoseconds are not implicitly timeline seconds. |

Ordering is meaningful. A full trajectory replaces upstream positions; mapped
trajectories replace their mapped rows and retain upstream positions elsewhere.
Put transforms below Trajectory when they should act on displayed frames.
UnitCell displays source periodic metadata; it does not automatically transform
its box through arbitrary coordinate providers. EField evaluates live positions
on a grid fixed from root bounds unless an explicit box is supplied, so large
motion needs an appropriate box. These distinctions should remain explicit
rather than hidden behind a generic provider abstraction.

CPU snapshot consumers (Ribbon/Tube/annotations/queries and Isosurface) may lag
live coordinates/volumes; supported moving Surface grids use live GPU jobs with
a CPU fallback. Provider-local generations are not comparable across owners.
Preserve source/layout provenance and nearest-scope resolution when changing
layout. The current architecture guide remains the single navigation map.

## Primitive reuse and simplification decisions

Native RawData packing, ComputeBuffer/Kernel maps and the shared dispatch
observation bridge remain appropriate. useRawSource's backing-buffer upload is
not equivalent to packing offset/padded columns. Native Readback lacks molecular
provenance/demand policy. Existing raw jobs need concrete job-shape reasons, not
blanket claims that use.gpu cannot repeat or await work.

Fresh inspection found `Iterate` repeats ordered compute callbacks and
`DispatchLoop` uses queue completion. Corrected ElasticNetwork's misleading
header: checkpoint restore/copies between compute passes are the actual reason
its current raw encoder remains useful. No production behavior changed. The
earlier audit's broader limitations are narrowed by the new viewer report.

The previous pass already removed compatibility barrels and duplicate dispatch
observation and split field responsibilities. Keep those gains. Private exports
needed by another module are not public JSR exports; removing them or adding
re-export facades merely for shorter import lists offers no demonstrated
benefit. Do small local moves alongside real changes, preserving ten public
entries.

Existing `s5o.11` public browser-coverage work, `s5o.22` ordered-native
experiment and `ahc.11` ElasticNetwork retirement expansion retain their owners
and status. They are references, not duplicate new work or presumed completed
validation.

## Documentation and validation

Updated current architecture navigation, contributor instructions, Deno/JSR
hardening language, dependency examples and DESIGN's Surface/publication policy.
Corrected the stale Gate 2 handoff note with an explicit dated correction.
Historical findings retain their original evidence. Current README now describes
field-alpha mode limitations instead of promising unsupported automatic
behavior.

Fresh checks on the baseline plus documentation/comment-only edits:

- Pure packages: 180 type-checked tests passed.
- IO/dynamics/timeline: 197 passed initially, one HTTP test blocked by sandbox;
  that isolated test passed on approved rerun (198 exercised successfully).
- All eight packages passed hardening H1–H6; public JSX type checking passed.
- Browser: components, volume, Superpose source recovery and Gate 2 passed (4
  top-level tests in 59 seconds, Chrome 154.0.8037.95).
- Retained probes reproduce selection ID collision, XTC cancellation, request
  rejection states and field-alpha mode selection. All four probes type-check
  with workspace declarations and pass scoped lint; execution reproduces each
  reported case. Formatting passed for 22 changed files, `git diff --check`
  passed, and all 38 local Markdown link targets checked exist (remote URLs and
  heading anchors were not checked).

No full GPU/retirement gate, new-case visual regression, JSR dry run, external
consumer rerun or performance benchmark is claimed. No public signature,
manifest or API snapshot changed. No publish or deployment occurred.
Implementation of the five follow-ups remains open; completing this review does
not complete those repairs.

The request probe runs with an ESM import map because direct Deno execution of
the pinned npm Live entry lacks a named export. Type checking uses the ordinary
workspace declaration resolution: checking against raw ESM JavaScript instead
inferred incomplete upstream types and failed. This tooling distinction did not
require source changes or suppress a production type error.
