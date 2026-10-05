# Post-overhaul diligence: viewer and pinned use.gpu

Started 2026-10-04; completed 2026-10-05. Baseline `8bf1005`, use.gpu 0.20.0.
Review `molgpu-sept-0vs.3`. The delegated reviewer supplied candidate findings;
the primary reviewer completed upstream verification and this report after the
delegated turn stopped. No uncompleted agent validation is counted as passing.

## Decision and scope

Keep viewer as the single Live/GPU adaptation package, with the ordinary entry
and `advanced`. Its 108 source files include coherent private responsibilities:
field planning/binding, immutable column caching, selection resolution, source
requests, coordinate publication, readback provenance, geometry and GPU jobs.
The recent dispatch-observation extraction is present and used by coordinate,
attribute and field-line producers. No additional public entry or generic
resource framework is justified.

This is a boundary and representative-path review, not exhaustive shader proof.
Inspected entries/types, sources/contexts, representation adapters, native
dispatch observation, coordinate kernels/passes, readback tokens, ElasticNetwork
ordering and raw-job rationale. Existing scientific/lifetime suites remain
necessary for future implementation; a source review alone cannot certify every
retirement.

## Concrete upstream comparison

Read installed `node_modules/@use-gpu/workbench/mjs/` implementations at the
exact 0.20.0 pin: `data/raw-data.mjs`, `hooks/useRawSource.mjs`,
`compute/compute-buffer.mjs`, `compute/kernel.mjs`, `compute/compute.mjs`,
`compute/readback.mjs`, `compute/iterate.mjs`, and `queue/dispatch-loop.mjs`.
The primary reviewer also inspected pinned Live `tree.mjs` for the request
probe. These local installed sources, not current online documentation, define
this audit.

| Mechanism              | Observed upstream contract                                                                                                                                   | Decision                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RawData / ColumnSource | RawData copies and packs input, updates source metadata/bounds and emits reconciliation signals. useRawSource uploads `array.buffer` directly.               | Keep RawData packing; a shorter hook is not equivalent for offset views or padded columns.                                                                                     |
| ComputeBuffer / Kernel | Explicit target sizes, initial/version dispatch guards and linked inputs already express per-row maps. ComputeBuffer allocates without explicit destruction. | Keep CoordinateKernel and ownership adaptation; do not replace them with raw compute for symmetry.                                                                             |
| Dispatch observation   | The local bridge observes an actually encoded native dispatch, then publishes after synchronous submission via a microtask.                                  | Keep one bridge. Submitted readiness is not GPU completion; source/version ownership remains at callers.                                                                       |
| Readback               | Queued copy/readback has once/dispatch controls, but no molecular owner/layout/generation token.                                                             | Keep provenance and demand-driven snapshot policy. Upstream readback is not a drop-in replacement.                                                                             |
| Iterate                | Repeats the gathered ordered compute callbacks `count` times, using their compute-pass arguments.                                                            | Repeated dependent dispatches alone do not justify raw WebGPU.                                                                                                                 |
| DispatchLoop           | Supports batching and a loop gated by `queue.onSubmittedWorkDone()`, with a continuation callback.                                                           | Narrow older claims that use.gpu cannot report completion; this primitive still does not automatically provide molecular cancellation/publication or variable-size job policy. |

The October 2 native audit's broad “no on-demand job” wording should be read as
an assessment of its Kernel/Compute path, not the entire upstream API. This
report supersedes that generalization without rewriting its historical results.
EField/DSSP/surface retain concrete chunking, CPU sizing and latest-request
policies; this pass does not prove a DispatchLoop conversion equivalent.

### ElasticNetwork raw exception corrected

The old header said a dispatch sequence cannot repeat in one frame. `Iterate`
disproves that reason. The actual integrator (`elastic-network.ts:413–475`)
restores buffers before a compute pass and ends/restarts passes to insert
`copyBufferToBuffer` checkpoints between steps. Iterate receives a compute-pass
encoder; it does not express those command-encoder copy boundaries.

Corrected the header only, retaining raw behavior and ownership. No benchmark or
native replacement claim follows. The ordered Superpose/Unwrap experiment
remains owned by `s5o.22`; ElasticNetwork retention expansion is already
`ahc.11`. Neither is duplicated, closed or reassigned by this review.

## V1: P2 — field alpha does not select transparent mode

Tracking: `molgpu-sept-0vs.8`.

`internal/opacity.ts:37–39` returns 1 for every Field in `flatAlpha`. Spacefill
(`:268`), Bonds (`:285–288`), Ribbon (`:138`), Tube (`:99`) and Surface (`:196`)
use that value to choose a mode. At opacity 1, even a constant RGBA Field with
alpha 0.5 gets the default mode rather than automatic transparent mode. The
former README promised identical automatic behavior for flat and Field colors. A
pure helper probe reproduces `{}` for that Field versus `{mode:"transparent"}`
for the same flat RGBA value.

This is a reproduced decision mismatch and source-confirmed call path, not a
rendered overlap failure. Current README now states the limitation: use explicit
`mode="transparent"` for translucent fields or material wrappers. The follow-up
must decide automatic policy for known versus arbitrary field alpha and test
actual overlapping draws under OIT, explicit overrides, opacity edits and
invalidation. Do not scan/re-upload coordinates merely to infer transparency.

## Imports, exports and layout

All cross-package production imports use existing public entries. Viewer owns
all Live/workbench/shader imports; shader-source exports remain dynamics/wgsl.
Type-only imports and lazy IO imports are counted in the inventory but are not
bundle-size measurements. A shared barrel that merely re-exports these imports
would hide coupling, not remove it.

Keep top-level public components, adjacent scope modules and private adapters.
The Structure/Trajectory context modules form a runtime import cycle through the
owner-checked reader, but their imported context values are read in hook bodies,
not during initial construction. No initialization failure was established. A
future touched-area cleanup may put readers in a leaf module; a mass folder move
now offers no demonstrated improvement. Split trajectory player/cache
responsibilities only when a concrete change needs it; frame-cache/window and
source-request are already separate. Keep shared type exports based on caller
contracts, not one props type or public subpath per file.

## Validation

Primary fresh checks: hardening H1–H6 for all eight packages and public JSX
component type checking passed. Existing browser runners `run-components`,
`run-volume`, `run-superpose-source`, and `run-gate2` passed: 4 top-level tests,
59 seconds, Chrome 154.0.8037.95. They exercise component ownership/reload,
volume composition, nearest source recovery and style/upload/lifetime behavior,
including their browser error assertions. Vite emitted its existing unresolved
`@std/path` config warning; the suites completed successfully.

No fresh complete retirement, field-alpha visual regression, external published
consumer, full GPU gate or performance benchmark was run. These four passing
suites do not cover the new collision, arbitrary rejection or alpha cases.
