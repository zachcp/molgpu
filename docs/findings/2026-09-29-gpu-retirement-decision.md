# GPU Retirement Decision After Guarded Draw Probe

Date: 2026-09-29. `molgpu-sept-crj.7` research on the installed use.gpu 0.20.0
pin. No production module or installed dependency was changed. Read this with
the [publication contract](2026-09-28-gpu-publication-contract.md) and the
[earlier retirement counterexample](2026-09-28-gpu-retirement-boundary.md).

## Decision

For the current pin, **release viewer ownership and use native reachability for
allocations whose complete consumer set cannot be guarded**. Do not explicitly
destroy those allocations in a source-hook cleanup or after a frame count or
queue fence. Retain demand-uploaded immutable Structure columns across style
changes, then drop the Structure's references when that owner ends. This is the
selected safe retirement policy for the `19s` repair, subject to a measured
memory budget in its implementation acceptance. It gives deterministic logical
owner retirement, not a deterministic time of native GPU-memory reclamation.

Explicit `GPUBuffer.destroy()` is allowed only after the owner stops
publication, every retained draw/dispatch/copy that can reference that exact
allocation has been made inert or withdrawn, and a fence completes prior
submissions. A `DrawCall.shouldDispatch` validity cell is one usable part of
that proof; it is not a general retirement certificate. The cell must belong to
one allocation/owner and must never be reactivated by its replacement.

This decision lets `crj.14` implement submission-aware publication and
dependent-consumer gating now. `crj.5` still owns asynchronous readback
provenance. `19s` owns immutable-column style retention and its Gate 2
regression. Cross-provider lifetime integration and memory-budget verification
belong to `crj.15`. None of those production repairs is claimed by this spike.

## Executable Proof and Limits

The [browser probe](../../test/spikes/gpu-retirement/run.mjs) now runs six
policies in a public Pass scene. It holds replacement render-pipeline promises
beyond two frames, advances the camera, completes a queue fence while the
promise remains held, then hides/unmounts the molecular subtree. It traces bind
groups through draw encoding and command-buffer submission and captures
uncaptured WebGPU errors. The saved
[trace](evidence/2026-09-28-gpu-retirement.json) was produced with Chrome
153.0.8010.53:

| Probe                                                        | Submissions after old buffer destruction | WebGPU errors | What it establishes                                                                      |
| ------------------------------------------------------------ | ---------------------------------------: | ------------: | ---------------------------------------------------------------------------------------- |
| Current Spacefill style replacement                          |                                        9 |             9 | Immediate hook cleanup is unsafe.                                                        |
| Two-frame delay plus completed queue fence                   |                                        7 |             7 | A fence does not withdraw future retained draws.                                         |
| Suppress explicit destruction                                |                                        0 |             0 | Safe in this scene; 40 small allocations leave no reachable JS wrappers after forced GC. |
| Unguarded native `RawFaces` with suspended sibling           |                                       10 |            10 | Its old draw keeps using a retired allocation.                                           |
| `RawFaces.shouldDispatch` validity cell                      |                                        0 |             0 | The old draw executes the guard after invalidation and skips binding.                    |
| Spacefill with **research-only** `RawQuads` guard forwarding |                                        0 |             0 | The same draw gate prevents the actual held style-replacement failure.                   |

For the last row, the runner injects one `shouldDispatch` forwarding property
into the pinned `RawQuads` source while Vite builds the browser fixture. It does
not patch production or the installed package. A page-local style epoch stands
in for an allocation validity cell in this single-owner experiment. The trace
records rejected old draw calls, zero post-destruction submissions, and zero
WebGPU errors. The unchanged `RawQuads` path has nine invalid submissions in the
corresponding baseline; the guard experiment therefore tests a real retained
replacement draw. It does **not** prove a production allocation-specific token
or cover all molecular representations.

Pinned `DrawCall` checks `shouldDispatch` before binding storage. `RawFaces`
forwards it, while `RawQuads` and `RawLines` omit it from their `useDraw` calls.
`PointLayer` uses `RawQuads`; `LineLayer` is `RawLines`. The viewer also owns
compute, readback and other buffers beyond these draw paths. Consequently a
one-line points forwarding change is necessary for guarded Spacefill
destruction, but insufficient for universal explicit retirement. Do not infer a
withdrawal acknowledgement from a sibling Queue callback.

The reachability sample uses a four-atom scene and 12 mount/unmount cycles:
1,056 cumulative requested bytes and zero surviving JS `GPUBuffer` wrappers
after explicit probe-reference release and forced GC. It is not a native GPU
memory measurement, a peak budget, an ordinary-GC latency bound or proof for
large structures. Production acceptance must measure churn at representative
sizes and reject unbounded growth before relying on native reachability broadly.

## Bounded Implementation Handoff

1. `crj.14`: request and publish revisions separately. A producer publishes only
   after an actual submitted dispatch; dependent GPU work waits for queue
   ordering and CPU snapshots wait for mapped copies. Remove startup wakeups
   once event-driven redraw works. Reuse the delayed-compute fixture, including
   both pipelines held, same-buffer parameter changes and owner replacement.
2. `19s`: cache first-demand immutable columns for the Structure/device owner.
   Permit one bfactor upload on first use; repeated style switches must not
   reupload it, rebuild geometry or upload coordinates. Remove immediate
   destruction of style-released columns. Run held render replacement, repeated
   styles, unmount, validation-error capture and memory-churn checks before
   removing the Gate 2 CI skip.
3. `crj.15`: inventory each allocation and its last possible draw/dispatch/copy.
   Use reachability where a complete guard is not exposed by this pin; prove
   bounded retention under replacement, resize and unmount. An optional
   explicit-destroy path must pass a real per-allocation token through points,
   lines and other relevant variants, test suspended siblings and applicable
   picking/shadow passes, then fence prior submissions. Do not add a general
   resource framework or replace the caller's renderer.
4. `s5o.7`: use native compute/data/readback primitives where their ordering and
   ownership match this contract. Keep raw scientific paths provisionally and
   preserve CPU oracles; a native allocation helper alone supplies no
   destruction proof.

The target acceptance for unchanged production remains intentionally failing:

```sh
deno run -A test/spikes/gpu-readiness/run.mjs --acceptance
deno run -A test/spikes/gpu-retirement/run.mjs --acceptance
deno task test:viewer:gate2
```

The research mode `deno run -A test/spikes/gpu-retirement/run.mjs` passes its
counterexample and guarded comparison assertions. The separate readiness
research run passed previously; its production acceptance fails for the
documented pending/stale publication. No full GPU gate or production lifetime
repair is claimed.
