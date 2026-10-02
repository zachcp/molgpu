# Second architecture and package diligence review

Date: 2026-10-02. Source baseline: `e2b4df7`. use.gpu `0.20.0`. Review epic:
`molgpu-sept-ktr`; plan recorded before delegated diligence in
[second-pass plan](2026-10-02-second-pass-plan.md).

## Recommendation

Keep the eight packages, ten public entries and application-owned use.gpu scene.
The recent overhaul substantially improved publication, ownership, scoped query
props and primitive reuse. The next useful pass consists of small correctness
repairs and private simplifications, rather than another framework or package
split. Existing public-entry imports follow the intended dependency directions;
removing legitimate table/query/scientific edges would duplicate contracts.

The most consequential new findings are missed numeric/geometry edge cases and
pending source composition. None establishes that the completed architecture
gate was invalid: its tested cases pass, but do not cover these cases. Reuse
existing coverage work `s5o.11` and ordered-kernel experiment `s5o.22`; do not
reopen closed `crj` issues based on historical descriptions.

This pass changes documentation and review evidence only. Production refactors
remain bounded implementation Beads with acceptance checks. Pre-existing dirty
retirement JSON and browser-coverage scripts were left untouched.

## Package diligence

| Package  | Source files / entries | Conclusion                                                                                                               | Next bounded work                                                                                                                                                       |
| -------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| table    | 18 / 1                 | Shared identities, attributes, spatial grid and ownership contracts belong here; topology/scientific decisions retained  | Optional removal of private compatibility type barrel (`ktr.18`)                                                                                                        |
| select   | 8 / 1                  | Typed chemical graph intentionally differs from display bonds; public query props now compose through viewer             | README corrected; optional split of barrel from implementation (`ktr.18`)                                                                                               |
| fields   | 6 / 1                  | Pure evaluation/WGSL boundary correct; GPU bindings stay in viewer                                                       | Wrap endpoint (`ktr.15`), valid numeric literals (`ktr.16`), optional private construction/evaluation/emission split                                                    |
| geo      | 6 / 1                  | Pure attributed kernels and independent attribution search remain justified                                              | Spacing/affine normals and winding (`ktr.17`)                                                                                                                           |
| io       | 17 / 1                 | Lazy Mol* wall and shared transport remain; no new format entries justified                                              | Public surface allocation preflight (`ktr.11`), invalid download ceiling (`ktr.12`)                                                                                     |
| dynamics | 24 / 2                 | CPU references and renderer-free WGSL entry preserve scientific precision and provenance                                 | Guide validation before packing (`ktr.10`), map ownership (`ktr.14`)                                                                                                    |
| timeline | 2 / 1                  | Private core adapter supports arbitrary-time seconds and owned vector results; native workbench easing is not equivalent | Remove unused per-sample copy (`ktr.13`)                                                                                                                                |
| viewer   | 109 / 2                | One renderer adapter with ordinary and advanced entries; raw job exceptions remain bounded                               | Pending reference composition (`ktr.5`), metadata reader decoupling (`ktr.6`), API rule reconciliation (`ktr.7`), dispatch bridge (`ktr.8`), obsolete helpers (`ktr.9`) |

Counts include production `.ts` source files; import counts include type and
dynamic imports, not measured runtime/bundle costs. The
[inventory](evidence/2026-10-02-second-pass-inventory.json) records exact public
entry manifests and per-specifier source-file counts. No production sibling deep
imports were found. The [current architecture guide](../ARCHITECTURE.md) maps
dependency directions and dataset scopes.

Detailed evidence: [pure packages](2026-10-02-second-pass-pure.md),
[IO/scientific/time packages](2026-10-02-second-pass-science.md), and
[viewer/upstream adapters](2026-10-02-second-pass-viewer.md).

## Prioritized findings and work order

All new fixes are P2 or P3. P2 here means a bounded supported-API or composition
defect/risk, not a newly observed general GPU lifetime failure.

| Priority / issue | Evidence and outcome                                                                                                                                                                                                                    | Implementation acceptance                                                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2 `ktr.5`       | Source-confirmed: `trajectory.ts:411` keeps descendants under inherited/null metadata during src opening; `superpose.ts:272` throws for `to="first"` before its pending-reference pass-through. `:283` throws on reference-read failure | Controlled opening/reload/cancel/error and failed first-reference read; no pageerror, appropriate upstream pass-through/status, preserve actual absent-ancestor and scientific errors |
| P2 `ktr.15`      | Reproduced CPU/emitted-expression mismatch: wrap upper endpoint returns range high on CPU and low through unconditional WGSL `fract`                                                                                                    | Decide convention; CPU and dispatched WGSL parity at endpoints and outside, including negative values                                                                                 |
| P2 `ktr.16`      | Reproduced shader text: scalar NaN/Infinity accepted; finite `1e21` emits invalid `1e+21.0`                                                                                                                                             | Explicit finite/f32 policy and valid exponent serialization; real WGSL compilation cases                                                                                              |
| P2 `ktr.17`      | Reproduced geometry mismatch: anisotropic spacing scales positions without inverse-transpose normals; reflection bypasses affine winding correction                                                                                     | Share affine lowering; matching positions/normals/winding for equivalent spacing and matrices                                                                                         |
| P2 `ktr.10`      | Reproduced: fractional/NaN/2^32 custom guides are converted into different valid u32 atom rows before validation                                                                                                                        | Validate original rows through existing kernel policy, then pack; valid scientific results unchanged                                                                                  |
| P2 `ktr.11`      | Source-confirmed: public molecularSurfaceField has no preallocation sample budget; pinned Mol* raw call does not enforce UI option metadata. Viewer checks do not protect direct IO callers                                             | Validate finite geometry/options and predicted grid before allocation; explicit documented budget; oracle parity                                                                      |
| P2 `ktr.8`       | Source-confirmed duplication of native dispatch observation in CoordinateKernel, AttributeProducer and FieldLines                                                                                                                       | One private bridge, preserving actual-submission readiness, revision guards and lifetime tests                                                                                        |
| P3 `ktr.6`       | UnitCell/Superpose/Unwrap import metadata reader from the full trajectory player module                                                                                                                                                 | Move owner-checked reader beside context; unchanged public API and nested-scope behavior                                                                                              |
| P3 `ktr.7`       | Documented H5 R1/R3 exceed checker enforcement: unnamed component props and exported VectorLike remain                                                                                                                                  | Agree on useful minimal types, then align enforcement, docs and API snapshots                                                                                                         |
| P3 `ktr.9`       | live/viewer identity wrappers and a gather helper with only test consumers remain after adapter migration                                                                                                                               | Remove obsolete production paths while retaining meaningful production bond/attribute regressions                                                                                     |
| P3 `ktr.12`      | Reproduced small injected-fetch call: NaN bypasses whole-download budget comparisons                                                                                                                                                    | Reject invalid ceiling before fetch; retain ordinary/chunked limits and Range integrity                                                                                               |
| P3 `ktr.13`      | Source-confirmed unused vector clone before another output allocation in timeline.sample                                                                                                                                                | Preserve independently owned outputs while removing one redundant copy                                                                                                                |
| P3 `ktr.14`      | Mutation probe demonstrates NormalMode helper retains map; ownership is unstated, so not alone a viewer bug                                                                                                                             | Copy or document transfer, with explicit immutability/version and mutation isolation policy                                                                                           |
| P3 `ktr.18`      | Pure package barrels and large responsibility mixtures can be simplified privately                                                                                                                                                      | Unchanged entries/API/dependencies; mechanical moves separate from behavior changes                                                                                                   |

Suggested sequence: repair `ktr.5`, then the independent field/geometry/guide
correctness cases and IO preflight. Deduplicate the dispatch bridge after those
fixes; its risk requires the existing browser readiness/retirement tests. The
metadata move and dead-helper removal are independent small cleanups. Reconcile
API rules before broad prop-type changes; do private layout work alongside the
relevant repair, with moves reviewed separately. This is priority guidance, not
artificial dependency edges. Existing `s5o.22` remains an independent
experiment.

## Source layout and specialized transforms/visuals

Keep ordinary molecular components as the public vocabulary. Structure owns
topology and root columns; Trajectory supplies coordinates and periodic metadata
over that topology; Volume supplies an independent grid. EField bridges nearest
coordinates/charges to a Volume. Specialized consumers are appropriate:

- UnitCell consumes displayed trajectory boxes; Unwrap can consume them or an
  explicit box. Superpose only requires trajectory metadata for `to="first"`.
- Transform, NormalMode and ElasticNetwork work on nearest coordinates, with
  scientific inputs supplied explicitly. They do not need to live inside a
  separate trajectory package or public namespace.
- Isosurface, VolumeSlice, FieldLines and FieldArrows consume either loaded or
  computed volumes. Volume may surround a Structure to supply sampled fields.

Prefer local responsibility modules over new public subpaths: trajectory
metadata readers next to their context, request orchestration separate from
playback/cache internals, pure geometry builders apart from GPU jobs. Do not add
a generic source provider merely to unify Structure/Volume's loading
presentation with Trajectory's coordinate pass-through. The completed
source/playback decision deliberately keeps those behaviors different. Nested
pending trajectory metadata inheritance needs deliberate acceptance in `ktr.5`,
not incidental change during the move.

Minimal exports means supported entry discipline. A local export for a module
consumer is not an extra JSR API. Conversely, unused workspace scientific APIs
are not automatically dead: external CPU references and explicit public
contracts justify them. Current public/advanced entries are adequate.

## Upstream decisions retained

Read installed 0.20.0 RawData/useRawSource,
Kernel/Compute/ComputeBuffer/Readback, dispatch/ComputePass, shader
refs/instance operators, Loop, core easing and workbench interpolation
implementations. Concrete reasons prevent blind reuse:

- RawData packs/copies offset views and preserves signaling/bounds; useRawSource
  is not an equivalent padded-column substitute.
- Native instance operators initialize cached private fields; independently
  callable indexed molecular getters support different invocation semantics.
- Native Readback lacks molecular source/layout/provenance and demand policy.
- Raw EField/DSSP/surface jobs include chunked submissions, readback-dependent
  sizing and cancellation. Shared scan/copy kernels already removed known
  repeats.
- Timeline's zero knots, arbitrary-time sampling and owned outputs differ from
  workbench's mutable easing helpers; importing workbench into timeline would
  violate the intended lower boundary.
- Chemistry/display graphs, sparse CPU neighbors/dense GPU or attribution grids,
  and scientific f64 kernels have different contracts. Retain their oracles and
  precision, rather than force uniform helper names.

Published root/coordinate buffer destruction remains an advanced-extension
limitation bounded by current retirement evidence. No new destroyed-buffer
submission was reproduced here; do not create a duplicate lifetime bug from
source appearance alone.

## Documentation consolidation and validation

Added one current architecture/navigation guide and linked it from root README,
DESIGN and ROADMAP. Corrected stale query-prop, chemical graph, annotation-hook,
lazy Mol* inventory, viewer dependency/type and GPU Surface policy claims.
Hardening now marks residual npm-era wording and the unenforced export rules; no
package.json files were introduced. Historical decision reports remain dated and
intact, rather than rewriting their evidence around later implementations.

Fresh passing checks: 172 type-checked pure-package tests; 192
IO/dynamics/timeline tests exercised across the initial run and one approved
HTTP-test rerun; five focused viewer CPU tests. Total: 369 scoped test cases.
The initial science test command had one sandbox socket error, then its isolated
rerun passed. The newly identified edge cases are retained in small executable
review probes, not claimed to be covered by those pre-existing tests.

Primary integration passed `deno task check:hardening` for all eight packages,
scoped formatting for all 17 changed review/documentation/evidence files, lint
for both evidence probes, both executable probes and `git diff --check`. All 72
local Markdown link targets in the 14 reviewed Markdown files exist; that check
does not validate remote URLs or heading anchors. No fresh GPU/browser gate or
performance benchmark was run. Browser and published-consumer passes in the
completed architecture gate are historical evidence for unchanged production
code; they do not prove these new acceptance cases. No package publish or
deployment occurred.
