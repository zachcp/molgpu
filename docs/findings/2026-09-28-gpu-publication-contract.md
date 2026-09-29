# GPU Publication and Retirement Decision

Retirement continuation: the
[2026-09-29 guarded-draw decision](2026-09-29-gpu-retirement-decision.md) tests
the pinned draw gate during held compilation and selects a safe policy for paths
without complete guard coverage. Earlier open-integration wording below records
the prior research checkpoint.

Date: 2026-09-28. Research: `molgpu-sept-crj.7`. Implementation baseline:
`1175c64`; review checkpoint: `f432dcd`. This is an assessment and proposed
implementation plan. No production code has changed.

Continuation: the
[retained-draw experiment](2026-09-28-gpu-retirement-boundary.md) now reproduces
unsafe destruction even with a two-frame queue fence and rejects a plain Queue
checkpoint as a withdrawal certificate. It records a small native reachability
comparison and the next bounded guarded-draw experiment. The deterministic
integration remains open; the earlier source risks below should be read
alongside that newer evidence.

## Goal and Priority

The quality pass aims to make complicated molecular scenes composable through
small JSX components, with independent data packages and application-owned
use.gpu rendering. Keep the eight packages. Scheduling, buffer layouts and
publication bookkeeping belong in viewer adapters, not ordinary scene props.

Finish this interrupted P1 spike before `crj.11` (isolated JSR consumers),
`crj.9` (primary JSX), `crj.10` (immutable ownership), and `crj.8` (assemblies).
Incorrect publication can silently change scientific inputs; premature
destruction already breaks rendering. These contracts inform existing fixes
`crj.2`, `crj.5`, `19s` and the upstream-adoption task `s5o.7`.

## Reproduced Evidence

The research fixture is
[gpu-readiness](../../test/spikes/gpu-readiness/probe.tsx). It composes a
four-atom Structure, an offset coordinate provider, a generic attribute producer
computing `x + 113`, and coordinate/attribute snapshot consumers. Original x
coordinates are 0, 1, 2, 3; the offset is 7.

The runner intercepts `createComputePipelineAsync` in the browser. It holds
either the attribute or coordinate pipeline promise until explicitly released.
The hold exceeds all existing startup wakeups. A separate mapped buffer copy
observes actual GPU contents. This is a deliberate scheduling perturbation, not
a measurement of normal compilation latency.

Re-run on Chrome 153.0.8010.53:

| Held pipeline | Before release                                                                                                          | After release                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Attribute     | Coordinate snapshot is correct; attribute snapshot and GPU output are all zero.                                         | GPU output becomes `[120,121,122,123]`; attribute snapshot remains zero through the observation window. |
| Coordinates   | Coordinates report `ready: false`, yet CPU positions are zero and the attribute producer publishes `[113,113,113,113]`. | Coordinates and attribute snapshot recover to the expected values.                                      |

Both scenarios report no page or uncaptured WebGPU errors. Saved raw
observations and acceptance checks:
[JSON](evidence/2026-09-28-gpu-readiness.json). The attribute snapshot's
generation/buffer deduplication explains the persistent stale value: actual
dispatch does not advance its published generation or invalidate the premature
read. This is stronger evidence than a timer risk inferred from source, but does
not prove every consumer or replacement path.

`deno task test:viewer:gate2` also reproduces:

- One new 16-byte `molgpu:attribute:bfactor` allocation.
- `[Buffer "molgpu:attribute:element"] used in submit while destroyed`, from
  `ColorPass`.
- The suite stops at its zero-allocation assertion, before its explicit
  uncaptured-error assertion and later camera checks. It is a failing suite.

First use of an immutable column may require one upload. The destroyed-buffer
error is independently invalid. Retain `19s`; do not create another recolour bug
or upload all columns eagerly to satisfy the current assertion.

## Pinned Upstream Audit

All paths below refer to installed `@use-gpu/workbench@0.20.0/mjs`, not a newer
online API. Exact source locations make these observations reproducible.

| Primitive                                                       | Observed contract                                                                                                   | Consequence                                                                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `queue/dispatch.mjs`                                            | No pipeline yields an empty call (or suspension); stale pipeline suspends. `onDispatch` executes inside encoding.   | Pipeline allocation, encoding and queue submission are distinct events.                                                                                                                        |
| `compute/kernel.mjs`                                            | `initial` uses version-based dispatch suppression; its internal `onDispatch` swaps history targets.                 | Keep native linking/dispatch; a wrapper returning from a compute call alone is not proof that a suppressed dispatch ran.                                                                       |
| `compute/compute-buffer.mjs`                                    | `then` is a Live `fence`; buffers are memoized, with no explicit destruction cleanup here.                          | `then` is not a GPU readiness signal or retirement fence.                                                                                                                                      |
| `pass/compute-pass.mjs`                                         | Immediate mode encodes and submits synchronously during evaluation.                                                 | Raw immediate submission is not itself an architectural violation. A callback deferred to a microtask can follow this synchronous submit, but only for this mode and with a verified dispatch. |
| `compute/readback.mjs`, `pass/readback-pass.mjs`                | Copy/readback work enters the renderer queue, even under immediate Compute.                                         | Native Readback is a candidate for staging/copy machinery; its timing cannot be substituted blindly for the current scheduler.                                                                 |
| `hooks/useReadbackStorage.mjs`                                  | Staging ring, map/copy/unmap and cancellation; no domain/source publication token.                                  | Viewer still owns provenance, demand, throttling and stale-result policy.                                                                                                                      |
| `data/raw-data.mjs`, `hooks/useScratchSource.mjs`               | Allocation/packing/version machinery; no explicit last-draw destruction fence.                                      | Switching allocation primitives alone does not repair early destruction.                                                                                                                       |
| `hooks/useRawSource.mjs`                                        | Uploads `array.buffer`.                                                                                             | Preserve existing packing until offset views and format stride are verified.                                                                                                                   |
| `queue/draw-call.mjs`, `pass/color-pass.mjs`, `queue/queue.mjs` | Async pipeline changes can suspend a draw; draw execution/submission is reconciled separately from the source hook. | Hook refcounts reaching zero do not establish that every old draw has been withdrawn.                                                                                                          |

## Decision: Separate Publication from Allocation

Adopt the following viewer-internal contract. It is a target for the follow-up
work, not a statement that current interfaces already meet it.

1. **Binding identity describes storage.** Use a stable descriptor while the
   device, allocation, offset, format and row layout are unchanged. Keep content
   revisions separately so a new frame does not unnecessarily relink bindings.
   Audit native mutable `StorageSource.version` semantics before changing our
   currently recreated wrapper objects.
2. **Coordinates remain packed xyz f32.** Logical rows preserve topology order;
   storage uses 12 bytes per atom (`array<f32>`), exposed through the pinned
   `vec3to4<f32>` accessor. It is not a 16-byte WGSL `array<vec3<f32>>` buffer.
   Attribute storage is f32 per row; semantic code conversion remains `crj.2`.
3. **A requested revision is pending until its producer has submitted.**
   Allocation and compilation do not publish valid contents. An encoding
   callback is insufficient unless its adapter proves submission happens before
   any consumer can act. Readiness transitions must not masquerade as another
   content change; retire the `generation * 2 + ready` convention after
   dependency tests.
4. **GPU consumers require queue ordering, not CPU completion.** Once the
   producer's command is submitted, a dependent command on the same device queue
   may consume it. Do not add an `onSubmittedWorkDone` wait between every stage.
   Pending providers must gate draws, derived attributes, bounds and copies.
5. **CPU consumers publish only after the ordered copy maps successfully.** Rate
   timers may throttle eligible work; they cannot establish readiness. Commit
   the publication token only after semantic conversion and publication succeed,
   so a conversion failure is not silently recorded as success.
6. **Capture provenance when scheduling.** A token identifies the provider
   instance, dataset/topology revision, source buffer and view layout, and
   content generation. Include attribute name/domain or volume grid identity
   where applicable. An opaque layout identity can hold the shape; no generic
   public token framework is needed. Check the captured token on completion and
   never attach old bytes to the current owner.
7. **Retained snapshots keep their original token.** A consumer may deliberately
   use the latest completed snapshot while a new revision is pending, within its
   documented staleness policy. A new owner/layout starts pending. Do not
   relabel retained output as the requested revision, substitute root
   coordinates, or expose a new zero-filled allocation as usable data.

For the first dispatch, both snapshots and derived consumers in the probe must
remain pending until their inputs are submitted. For later updates, retaining a
previous result is permitted only when its provenance and consumer policy remain
valid. GPU DSSP's bounded hold is distinct from a CPU startup delay and should
not be deleted merely because both use timers.

## Decision: Retirement Requires Withdrawal, Then Completion

An allocation has one owner. Consumers borrow it; their final hook release alone
does not authorize destruction. Explicit destruction requires this order:

1. Stop new publication and invalidate pending callbacks for that owner.
2. Withdraw every retained draw/dispatch/copy that can submit the allocation, or
   account for its final submission. Include suspended pipeline replacement.
3. Only after that boundary, fence already submitted work. Finish or cancel
   outstanding mappings according to the staging owner's lifecycle.
4. Destroy once and release the allocation from its owner.

`internal/retire-buffers.ts` currently waits two animation frames before taking
a queue fence. That only covers work already submitted when the fence is taken;
it cannot establish step 2. Immediate destroys in `attribute-sources.ts`,
`column-source.ts`, coordinate/attribute `Published`, and the DSSP publication
cleanup also lack that proof. Gate 2 reproduces the attribute case; the other
paths remain source-reviewed risks.

**Implementation direction:** make immutable column retention belong to the
Structure/device lifetime, rather than the currently selected style. This makes
the usual style switch reuse previously uploaded columns and keeps old shader
bindings alive. Dynamic provider outputs and replacement Structures still need
the withdrawal boundary above; structure lifetime is not a universal fix.

The inspected pin does not expose an obvious allocation-specific "last draw
withdrawn" callback. Do not invent one or claim the two-frame helper supplies
it. The bounded retirement follow-up must demonstrate a queue/reconciler
boundary with an instrumented replacement test before spreading a helper. If
explicit destruction cannot be proven at that boundary, evaluate dropping owner
references and following native reachability-based lifetime, with measured
memory bounds, instead of retaining a guessed destroy delay. This is an explicit
open integration question; deterministic retirement is not yet verified.

## Reuse and Narrow Exceptions

| Path                                      | Proposed reuse                                                                                    | Preserve or verify before conversion                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CoordinateKernel / AttributeProducer      | `ComputeBuffer`, `Kernel`, immediate `Compute`; one internal submission-aware publication adapter | Verify suppressed calls, async compile, same-buffer parameter updates, replacement and siblings; delete startup repaint bursts only after event-driven redraw passes.                       |
| CoordinatePasses, Superpose, Unwrap       | Compare ordered native kernels with existing raw staged encoders                                  | Multi-stage algorithms alone do not prove native incompatibility. Retain the present raw path provisionally; verify pass order, scratch dependencies and CPU oracle parity before adoption. |
| Coordinate / attribute / volume snapshots | One demand/provenance scheduler; evaluate native Readback for copies/staging                      | Match throttling, final-on-pause, replacement and queued-readback timing. Then delete equivalent duplicate attribute machinery and the 200 ms readiness delay.                              |
| Bounds                                    | Gate on submitted coordinates; compare native reduction + Readback                                | Remove the initial 16 ms readiness assumption. Retry/throttle delays are separate. Test owner changes and empty selections.                                                                 |
| EField                                    | Preserve its dispatch/backpressure policy; share publication tokens and retirement rules          | It already gates coordinates, but initially publishes generation zero and can request a snapshot; replacement while busy needs source-aware validation. No new browser reproduction here.   |
| GPU DSSP                                  | Preserve frozen-generation input, CPU oracle, cancellation and bounded hold                       | CPU-sized grid/overflow recovery crosses a real async boundary. Its raw implementation remains provisional; scientific algorithms and tolerances do not change for API uniformity.          |

No raw path receives a permanent exemption from this source review. `s5o.7`
should convert the smallest equivalent path first and record actual limitations
and measurements for retained exceptions. No new package, scene graph or generic
resource framework is proposed.

## Alternatives Considered

| Alternative                                                            | Assessment                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Increase startup delays or repaint counts                              | Rejected. The explicit compilation hold outlasts any chosen timeout and reproduces incorrect values without validation errors.                                                 |
| Fence GPU completion after every compute stage                         | Rejected as the default. Ordered queue submission is sufficient for dependent GPU work; CPU readback and workload backpressure have separate completion requirements.          |
| Mechanically replace every raw pipeline with Kernel/Readback           | Rejected. Native primitives do not supply molecular provenance or an allocation-specific retirement fence. Equivalent behavior must be demonstrated per path.                  |
| Retain every buffer until device shutdown                              | Rejected as a general ownership policy. Dynamic replacement would accumulate resources. Structure-scoped immutable-column retention is a narrower candidate.                   |
| Explicit destruction after verified queue withdrawal                   | Preferred contract; concrete pinned integration still requires a research demonstration.                                                                                       |
| Native reachability-based reclamation after releasing owner references | Fallback to evaluate if explicit withdrawal cannot be established. Avoids guessed destruction timing but requires memory-retention measurements and honest cleanup guarantees. |

## Executable Acceptance and Remaining Work

```sh
# Capture observations without requiring the unfixed implementation to pass.
deno run -A test/spikes/gpu-readiness/run.mjs

# Executable target: currently fails, intentionally, on invalid publication.
deno run -A test/spikes/gpu-readiness/run.mjs --acceptance

# Existing retirement failure; its first-use allocation assertion needs correction.
deno task test:viewer:gate2
```

The probe requires pending snapshots to stay absent, final CPU/GPU attributes to
equal `[120,121,122,123]`, and no page/WebGPU errors. Its sampling window is
bounded; it does not exhaustively observe every transient publication. The waits
hold the adversarial test condition and bound observation, not establish GPU
readiness. This internal-contract fixture intentionally uses workspace aliases;
it does not answer the isolated JSR consumer question.

Before declaring the implementation contract verified, extend browser acceptance
to cover both pipelines held together; repeated parameters on one buffer;
sibling providers with colliding generations; replacement/resizing during map;
and unmount during compile/readback. Retirement acceptance must hold a
replacement render pipeline beyond two frames, repeatedly switch styles, verify
geometry and coordinate upload counters, and observe unmount/last
submission/destruction. Capture validation errors throughout, including after
unmount. These are planned tests, not passing evidence from this assessment.

The research resolves the publication model and rejects timing-based retirement.
Keep `crj.7` in progress until the deterministic withdrawal integration and its
minimal demonstration are settled. That remaining research can proceed without
implementing a production fix. JSR isolation is still the next separate spike.

## Bounded Follow-ups and Verification Status

- `crj.14` is the new P1 readiness fix, blocked by this spike. It covers
  producer submission, dependent-consumer gating and deletion of startup timing
  guesses.
- `crj.5` retains readback identity and shared scheduler work; `crj.2` retains
  semantic code conversion. Their existing scope is not duplicated.
- `19s` retains the concrete style/retirement fix and revised allocation checks.
  `s5o.7` retains per-path upstream adoption after equivalent behavior is
  proven.
- The closing gate `crj.13` now also depends on `crj.14`. None of the existing
  implementation issues or reference decisions was closed.

Scoped formatting, lint and the probe's TypeScript checks pass. The observation
runner completes; its new `--acceptance` mode fails on the demonstrated pending
and stale publications, as expected on unchanged production code. Gate 2 fails
as detailed above. No full GPU gate, retirement replacement/unmount pass, or
isolated package-consumer pass is claimed. The local browser runs required
sandbox escalation to bind the test server; both ran successfully after that.
