# Retained Draws and GPU Retirement

Continuation: the [2026-09-29 decision](2026-09-29-gpu-retirement-decision.md)
verifies a native guarded draw and a research-only guarded Spacefill
replacement, then selects reachability for unguarded allocations on the current
pin. The "next experiment" below records this document's earlier checkpoint.

Date: 2026-09-28. Research continuation of `molgpu-sept-crj.7` at `f432dcd`;
production implementation remains unchanged. This supplements the
[publication decision](2026-09-28-gpu-publication-contract.md).

## Goal and Choice of Spike

The assessment is about dependable molecular JSX beneath caller-owned use.gpu
rendering, with eight independent packages and scientific CPU references. It is
not a feature expansion or a blanket GPU rewrite. Review the composition and
ownership contracts before implementing their repairs.

Beads and the previous checkpoint put `crj.7` first, ahead of `crj.11` (JSR
isolation). Submission-aware publication already has evidence and a decision;
the remaining question is whether the viewer can retire an allocation while an
upstream renderer may still retain its old draw. This pass investigates that
question only. Existing implementation issues `19s`, `crj.14`, `crj.5`, and
`s5o.7` remain separate and open.

## Decision

Reject immediate source-hook destruction, a two-frame delay followed by a queue
fence, and a plain callback quoted into Queue as evidence of draw withdrawal.
All can coexist with a retained old draw that submits again. This is now a
browser reproduction, not just a source-reviewed risk.

Continue with two bounded candidates: retain demand-uploaded immutable columns
for their Structure/device owner, and investigate invalidating a retained draw
before its bindings are encoded. Structure retention solves style churn only;
provider replacement and Structure unmount still require a retirement policy.
Native reachability is a viable fallback candidate with a passing small
experiment, but no deterministic native-memory bound has been established.

Do not introduce a generic resource framework or ask ordinary JSX consumers to
own renderer queues. Keep `crj.7` in progress: this experiment eliminates false
withdrawal boundaries; it does not certify a production destruction boundary.

## Pinned Source Evidence

These paths are installed use.gpu **0.20.0**, under `node_modules/@use-gpu`.

| Source                                 | Relevant behavior                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `live/mjs/hooks.mjs:285`               | `useResource` invokes prior cleanup immediately on dependency change, while evaluation is still in progress.                               |
| `live/mjs/fiber.mjs:715`               | `makeFiberReduction` substitutes its previous reduced value when the new value is `SUSPEND`.                                               |
| `workbench/mjs/queue/draw-call.mjs`    | An asynchronously replacing pipeline yields `SUSPEND`; the old draw closure captures its old storage binding.                              |
| `workbench/mjs/render/renderer.mjs:50` | The renderer gathers draw calls before handing them to pass components. It does not expose an allocation-specific removal acknowledgement. |
| `workbench/mjs/queue/queue.mjs`        | The Queue continuation executes gathered task closures; a sibling task executing does not prove another retained task has disappeared.     |
| `workbench/mjs/pass/color-pass.mjs`    | Each task invocation builds and submits a command buffer from the captured draw list.                                                      |

The application owns those passes and queues. A local Structure cleanup hook
cannot infer their complete retained state. Full molecular-subtree removal did
withdraw the observed draws in this fixture, but removal scheduling and the
source cleanup callback are different events.

An alternative worth testing is already present in `draw-call.mjs`:
`shouldDispatch` runs before the inner draw binds storage. `RawFaces` forwards
it. `PointLayer` forwards extra props to `RawQuads`, but `RawQuads` does **not**
forward this callback into `useDraw`. Therefore simply attaching it to ordinary
Spacefill props cannot supply a universal solution. Adoption would need a
specific upstream-compatible adapter or upstream support, plus coverage of every
relevant draw variant. This is a research direction, not a selected
implementation.

## Reproduced Experiment

The [research fixture](../../test/spikes/gpu-retirement/probe.tsx) uses public
Structure/Spacefill beneath WebGPU/AutoCanvas/OrbitCamera/Pass. Two colour
fields have different shader structures, so switching attributes really invokes
async render compilation. The runner explicitly holds the replacement pipeline
promises, advances the camera across more than two frames, awaits a queue fence,
then requests another draw while compilation is still held.

It records buffer IDs through bind-group creation, render bindings, draw calls,
command-buffer creation and submission, plus release/destruction events and
uncaptured WebGPU errors. A sibling Queue task records checkpoints. All policy
overrides are browser-only fault injection in the research runner; no production
file or installed dependency is patched.

Chrome **153.0.8010.53** produced:

| Policy in the probe                            | Submissions referencing a buffer after destruction | Uncaptured errors | Old draw after a completed fence |
| ---------------------------------------------- | -------------------------------------------------: | ----------------: | -------------------------------- |
| Current source-hook destruction                |                                                  9 |                 9 | Yes                              |
| Simulated two-frame + queue-fence retirement   |                                                  7 |                 7 | Yes                              |
| Suppress explicit molecular-buffer destruction |                                                  0 |                 0 | Yes, safely retained             |

The two-frame simulation applies the successful-fence branch of the existing
`retireBuffers` scheduling to the attribute release that currently destroys
immediately. It demonstrates why routing that release through the helper is
insufficient. It does not claim every existing helper caller was exercised.

In the saved two-frame trace, element buffer 4 is released at sequence 7, fenced
at 14 and destroyed at 15. Sequence 16 submits a draw using buffer 4. After the
later completed-fence marker at 34, sequence 35 uses it again. Queue checkpoints
also execute between these submissions. A later submission is the
counterexample; the number of elapsed frames is not the correctness criterion.

All three policies then hide the molecular subtree while compilation is still
held, release the promise and repaint. The observed post-hide submissions
contain no original molecular buffers. No page errors occurred. This is a
positive observation for this one subtree-removal case, not proof for suspended
siblings, additional passes, render bundles, compute work, or in-flight
readback.

The reachability comparison additionally performs 12 complete molecular
mount/unmount cycles. Across the initial scene and those cycles it allocates 40
molecular buffers totaling 1,056 requested bytes. After root unmount, releasing
the probe's own setters/root reference, and CDP forced GC, **zero molecular
GPUBuffer wrappers remain reachable**. WeakRefs are observational only. These
numbers are tiny cumulative allocations, not a GPU memory measurement, peak
footprint, deterministic cleanup guarantee or representative molecular budget.
Native bind groups may retain backend resources independently of JS wrappers.

Raw trace, checks and summaries:
[2026-09-28-gpu-retirement.json](evidence/2026-09-28-gpu-retirement.json).

## Alternatives and Bounded Plan

| Candidate                                                             | Decision and next evidence                                                                                                                                                                         |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| More frames, a timeout, or a plain Queue checkpoint                   | Rejected. The unresolved promise can outlast any delay, and checkpoints ran while the old draw remained active.                                                                                    |
| Structure/device-owned immutable columns                              | Preferred for `19s` style caching. Upload a column only on first demand; changing styles must preserve geometry and coordinate uploads. Does not settle owner replacement.                         |
| Retained draw checks a captured allocation/owner token before binding | Next bounded experiment within `crj.7`. First prove the pinned `shouldDispatch` mechanism with a minimal native draw; then identify the smallest viable path for points and other representations. |
| Reachability after releasing owner references                         | Keep as fallback. Small forced-GC experiment passes; exercise realistic buffers, repeated resize, ordinary GC and backend memory pressure before choosing it as the general policy.                |
| Reconcile an empty subtree, then remount                              | Useful experimental control. It visibly withdraws this scene, but may flicker, rebuild geometry, and place orchestration outside the molecular owner. Reject as the default styling fix.           |

The next experiment must answer one question: can a retained draw be made inert
before it binds a retired allocation, without owning the application's Pass? Use
a mutable validity cell captured by that **allocation's** old closure,
invalidate it on retirement, then fence prior submissions and destroy. Do not
let a new owner reactivate an old cell, or treat an encoding callback as a
submission event. Account for commands encoded but not yet submitted: this pin's
ColorPass encoding and submission are synchronous, but that fact must be checked
for every proposed participating path.

Start with one native draw and one replaced buffer. Hold its replacement shader,
invalidate the old token, continue camera redraws, then unmount and release the
held promise. Success requires zero post-retirement binding/submission of the
old allocation and zero validation errors. Extend to a second suspended sibling
and the applicable picking/shadow passes before treating the mechanism as
general. Stop and record an upstream limitation if the relevant primitive drops
the guard; do not solve the spike by replacing the renderer.

If that mechanism is unavailable or too invasive, choose reachability explicitly
and record the weaker cleanup guarantee and measured retention budget. Do not
rename released-owner counters to "destroyed"; current instrumentation treats
those concepts as equivalent. Any counter adjustment belongs to the eventual
implementation and its documented policy.

Reuse Beads as follows; no duplicate implementation issues are needed:

- `crj.7`: finish the guarded-draw/native-ownership decision and its minimal
  demonstration. Preserve this experiment as negative evidence for timer and
  checkpoint approaches.
- `19s`: later implement immutable-column retention and the selected retirement
  policy; revise first-use upload assertions, then run held replacement,
  repeated style changes and unmount checks before removing the CI skip.
- `s5o.7`: adopt native primitives only where equivalent publication and
  lifetime behavior is demonstrated. Raw scientific paths retain their CPU
  oracles.
- `crj.14` / `crj.5`: retain the separate submission-readiness and asynchronous
  provenance work. This pass changes neither algorithm nor API.
- `crj.11`: next independent spike after this decision is settled. Keep external
  consumer resolution separate from workspace-aliased GPU fixtures.

## Executable Acceptance and Validation

```sh
# Research mode asserts that both unsafe policies reproduce the counterexample.
deno run -A test/spikes/gpu-retirement/run.mjs

# Target for unchanged production code: fails on post-destruction submissions.
deno run -A test/spikes/gpu-retirement/run.mjs --acceptance

deno fmt --check test/spikes/gpu-retirement
deno lint test/spikes/gpu-retirement
deno check test/spikes/gpu-retirement/probe.tsx
```

The browser comparison and research assertions pass; production acceptance fails
as expected. Scoped formatting, lint and TypeScript checks pass. The localhost
browser run required sandbox escalation. No full GPU gate, native-memory budget,
deterministic retirement implementation, JSR isolation, publication or
deployment is claimed. Only findings, evidence, research fixtures and Beads are
changed.
