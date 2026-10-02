# Second pass: viewer adapters and pinned upstream primitives

Date: 2026-10-02. Review task: `molgpu-sept-ktr.3`. Baseline: `e2b4df7`. Review
only; no production edits. Composition/provider layout is integrated by the
primary reviewer. Read with the
[second-pass plan](2026-10-02-second-pass-plan.md),
[September architecture review](2026-09-28-stack-architecture-review.md),
[native compute audit](2026-10-02-native-compute-audit.md) and
[retirement acceptance](2026-10-01-gpu-retirement-acceptance.md).

## Assessment

Follow-ups: V1 is `molgpu-sept-ktr.8`; V2 is `molgpu-sept-ktr.9`; public
type-rule reconciliation is `molgpu-sept-ktr.7`. Metadata-reader decoupling is
`molgpu-sept-ktr.6`. Existing ordered-kernel work remains `s5o.22`.

Keep viewer as the single renderer adapter package and its two public entries.
Current field planning, immutable attribute demand uploads, provenance-tagged
snapshots and native one-stage compute are substantial improvements over the
September baseline. A second general compute rewrite would repeat completed
work. Remaining useful simplification is narrow: consolidate the identical
dispatch observation bridge, remove obsolete identity wrappers and test-only
production helpers, and make the source tree easier to navigate by ownership.

No new performance measurement or full browser gate was run here. Runtime risks
below are source observations. The previous browser results are historical
evidence, not fresh results from this pass.

## Pinned implementation diligence

Read the installed `node_modules/@use-gpu` 0.20.0 implementation, including:

| Primitive                                                                                        | Concrete behavior                                                                                                               | Consequence for viewer                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `workbench/mjs/data/raw-data.mjs:34,110`                                                         | Allocates a GPU-layout staging array; copies the supplied view into it; uploads; computes bounds; emits QueueReconciler signal. | Keep ColumnSource on RawData unless a measured replacement preserves view offsets, packing, bounds and signaling.                                                        |
| `workbench/mjs/hooks/useRawSource.mjs:8,33,42`                                                   | Allocates by view byte length but uploads `array.buffer`; no byte-offset slicing or vec3 padding step.                          | Not an equivalent drop-in for arbitrary subarrays or padded WGSL vectors.                                                                                                |
| `workbench/mjs/compute/compute-buffer.mjs:18`                                                    | Owns memoized target creation; `then` follows a Live fence; no destroy cleanup.                                                 | Viewer publication/readiness and retirement policy still need adapter ownership.                                                                                         |
| `workbench/mjs/compute/kernel.mjs:22,56`                                                         | Links args/sources/targets; uses `initial`/`version` guards and native dispatch.                                                | Correct fit for CoordinateKernel, AttributeProducer and FieldLines.                                                                                                      |
| `workbench/mjs/pass/compute-pass.mjs:27,43,48,53`                                                | Invokes gathered calls in one compute pass and submits synchronously for immediate mode.                                        | Dispatch observation can schedule its publication microtask after the synchronous submit, as current wrappers do. An encode count alone does not prove queue completion. |
| `workbench/mjs/compute/readback.mjs:13,23,47`                                                    | Renderer post-copy/readback callbacks, once/dispatch guards and cancellation; no molecular owner/layout/generation token.       | Preserve demand-driven provenance-tagged readbacks; cancellation policy alone is not source identity.                                                                    |
| `workbench/mjs/hooks/useShaderRef.mjs:2`                                                         | Stable refs with changing `.current`; functions/source overrides supported.                                                     | Current opacity/point-size/uniform adaptations use upstream mechanics correctly.                                                                                         |
| `workbench/mjs/hooks/useInstancedSources.mjs:29` and `shader/mjs/wgsl/operators/instanced.mjs:4` | `instanceWith` builds an initializer that fills private fields and separate getters reading those fields.                       | Not mechanically identical to viewer's independently callable `getData(getIndex(i))` accessor. See indexing below.                                                       |
| `workbench/mjs/providers/loop-provider.mjs:4`                                                    | `useAnimationFrame` passes the current fiber into LoopContext.                                                                  | Viewer useRepaint calls LoopContext without a fiber for a single repaint; replacing it with useAnimationFrame changes scheduling semantics.                              |

### V1. P2: one dispatch observation bridge is copied three times

`internal/coordinate-kernel.ts:143–193`, `attribute-producer.ts:144–181` and
`field-lines.ts:268–314` all gather a Kernel call, wrap its compute function,
observe its dispatch-count callback, deduplicate the revision notification and
schedule a mounted-guarded state update through `queueMicrotask`. The similarity
is exact in the mechanics; domain-specific readiness and instrumentation differ.

Upstream Kernel has no public submitted-generation callback on this pin. Its
dispatch `onDispatch` is used internally for target swaps, so deleting the
wrapper and assuming a Live fence indicates submission would undo the crj.14
contract. Consolidate only the observation bridge in one private Live adapter.
Keep generation construction, readiness policy, output ownership and scientific
callbacks in their current providers. Do not introduce a generic resource
system.

Acceptance: held native pipeline compilation for coordinate and attribute
producers; no publication until a real dispatch; repeated identical revision
dispatches once; same-buffer parameter revisions stay pending until submitted;
replacement/unmount cannot publish the old revision. Run `run-retirement`,
`run-invalidation`, `run-trajectory`, `run-efield` and public JSX type checking.
FieldLines' color-range edit must still dispatch/upload/build nothing.

This is a new maintenance follow-up, not a reopening of completed `s5o.7`.

### V2. P3: remove migration wrappers and retired production gather code

`internal/elements.ts:1–10` explicitly states both sides are native LiveElement.
`live` and `viewer` now return their input unchanged. They are still imported
throughout loaders, transforms, visuals and material composition. Removing these
calls and the module reduces import noise without weakening the public return
type. Keep `ViewerElement`/`ViewerComponent` as the documented public aliases.

`internal/gather.ts:5` has no production consumers. The only callers are
`test/attribute-gather.test.ts` and `test/bond-columns.test.ts:107`. Its CPU
attribute gathering reflects a superseded adapter: live visuals now bind shared
attribute sources through `fieldColumns` and `useAttributeSources`. A green test
of this helper does not exercise the production shader path. Remove it or move
the independent oracle into tests; preserve meaningful bond endpoint assertions
and test current attribute binding in the relevant browser suite.

Acceptance: reference searches find no production imports of either helper;
viewer unit tests and JSX type checking pass; the relevant field/bond browser
assertions remain. Scoped format/lint. This is a bounded new cleanup, consistent
with previously completed `s5o.17.2`, not a reason to reopen that issue.

### V3. P3: distinguish internal exports from supported package entries

`deno.json` publishes exactly `.` and `./advanced`, through `src/index.ts` and
`src/advanced.ts`. This already meets the useful minimal-entry goal. Most local
`export` declarations are necessary module links, not extra public JSR APIs.
Deleting them solely to lower an export count would couple files needlessly.

`types.ts` mixes ordinary props, public semantic values and advanced resources;
`src/internal` mixes pure geometry, field bindings, GPU jobs and lifecycle
mechanics. Use modest private folders by ownership if a concrete editing task
benefits: geometry builders, field adaptation, coordinate adaptation and GPU
jobs. Keep context/provider files together with their domain; do not create one
folder per tiny helper or new public barrels. Stage moves independently of GPU
behavior changes so review and regressions remain attributable.

The main API intentionally names native LiveElement through ViewerElement.
`advanced.ts:1–4` says the main entry never names use.gpu types, which is stale;
`index.ts:1–3` correctly documents the exception. Correct that comment in the
documentation cleanup. The README dependency graph omits dynamics even though
viewer imports both `@molgpu/dynamics` and `@molgpu/dynamics/wgsl`; its claim
that all use.gpu types are confined to advanced also needs the LiveElement
exception.

Public supported API removals require `api.txt`, README, hardening and JSR
dry-run review. Local moves and identity-wrapper removal need no additional
entry. Reconcile public composed coverage with existing `s5o.11`.

## Retained adaptations and alternatives

### Indexed molecular attributes

`internal/indexed.ts:7–32` is a small three-format WGSL adapter used by
`internal/use-field-plan.ts:44–61`. It permits each field getter to
independently evaluate a selected atom index or source-atom attribution. Native
`getInstancedSources`/`instanceWith` instead separates an initializer from
cached private-field getters. A caller must invoke the initializer at the
appropriate index before a getter reads its value. Simply replacing indexed with
one of those getters is not equivalent for arbitrary nested field sampling,
residue lifts or bond endpoints.

Retain the small indexed adapter unless an experiment proves call ordering for
all its consumers and shows an actual benefit. The existing upstream getShader
linker is already used; local WGSL expressing molecular row semantics is not a
duplicate shader runtime.

### Static columns and lifetime

`internal/columns.ts:35` validates columns and leaves the view uncopied, relying
on RawData's staging copy. The offset-view unit test verifies CPU adapter
behavior, not a direct GPU useRawSource substitute. Current immutable cache
`internal/immutable-attribute-cache.ts:44–110` uploads on first demand and
retains columns over style changes; its timer is only a reuse/eviction window
and never asserts GPU completion.

`internal/column-source.ts:24–30` and `internal/coordinate-kernel.ts:54–60`
still explicitly destroy published root/coordinate buffers. This differs from
the reachability policy for styled attributes, volume samples and FieldLines. Do
not call it a newly reproduced failure: crj.15's same-size/resize matrices
specifically exercise root columns and coordinate providers, held compilation,
picking/shadow and unmount, and report withdrawal before destruction. The
acceptance explicitly does not prove arbitrary advanced extension consumers.
Keep that limit visible and require those lifetime suites for any ownership
refactor. The installed RawQuads/RawLines omit shouldDispatch; RawFaces forwards
it. A fence or frame-count delay alone still supplies no general destroy proof.

### Raw scientific jobs

Retain the audited EField, DSSP and surface jobs: they include chunked
submissions, readback-dependent sizing, abort/coalescing and exact scientific
fallbacks. Shared `gpu-scan.ts` and `copy-positions-wgsl.ts` already remove
known duplicated mechanics. Coordinate bounds and cell-list bounds are still
distinct: centroid, selection and provenance semantics prevent a blind merge.

Reuse `s5o.22` for Superpose/Unwrap's ordered native-stage experiment. The
header of `internal/coordinate-passes.ts:28` still says stages are ones that one
linked kernel cannot express. That is narrower than the actual question:
multiple ordered native Kernel calls may express them, as ComputePass's loop
shows. Amend the header to say the raw implementation is provisionally retained
pending the existing experiment, rather than claiming an upstream impossibility.

### Repaint, fields and snapshot mechanics

Retain `useRepaint`: it requests one repaint through upstream LoopContext.
`useAnimationFrame` also supplies a fiber and should not replace it as a naming
cleanup. Retain opacity's linked uniform shader, world-space point-size
conversion, scientific volume sampling, and nearest attribute/volume plans. They
add molecular or unit semantics while reusing upstream shader refs/linking.

Retain the separate fixed-size status staging and demand-rate-limited snapshot
readback adapters. Status supplies two allocation-local busy slots; snapshots
carry full owner/buffer/layout/bytes/generation tokens, rate limits and final
pause publication. Superficially similar copy/map code does not establish
equivalent scheduling/publication semantics. Both already share instrumentation;
do not merge them into a resource framework just to reduce files.

## Package edges and verification

Every inspected cross-package production import uses a public workspace entry.
Viewer legitimately depends on all seven lower packages; dynamics WGSL is its
own documented entry. Reduce repeated local imports through removing obsolete
helpers and moving actual pure geometry to its proper owner where demonstrated,
not by importing lower package internals or copying its scientific code into
viewer. Existing lazy IO loading should stay lazy.

Executed:
`deno test -A packages/viewer/test/columns.test.ts
packages/viewer/test/attribute-gather.test.ts
packages/viewer/test/bond-columns.test.ts`:
**5 passed, 0 failed**, type checked. This confirms the current narrow CPU tests
only. No new production source, manifest, API snapshot or test code changed.
Browser suites described above are follow-up acceptance requirements, not newly
passing checks. Pre-existing dirty retirement JSON evidence and coverage scripts
were preserved.
