# Architecture Spike Log

Research branch: `codex/architecture-quality-spikes`. Baseline implementation:
`1175c64`. Architecture review and contributor guide checkpoint: `f432dcd`. No
production implementation is authorized by this research pass.

## Priority and Progress

1. `molgpu-sept-crj.7`: GPU dispatch readiness and retirement decision complete;
   publication contract and guarded retirement experiment recorded. The
   [2026-09-29 decision](2026-09-29-gpu-retirement-decision.md) selects native
   reachability where this pin cannot guard every consumer. Production repairs
   and representative memory-budget verification remain `crj.14`, `19s`, and
   `crj.15` follow-up work.
2. `molgpu-sept-crj.11`: isolated JSR consumption and multi-copy identity.
   Packaging is a release boundary that workspace aliases cannot verify.
3. `molgpu-sept-crj.9`: primary molecular JSX composition. Settle the intended
   consumer shape before expanding internal APIs.
4. `molgpu-sept-crj.10`: immutable ownership and scientific responsibilities.
5. `molgpu-sept-crj.8`: assembly instances through picking.

## GPU Checkpoint

Pinned upstream source examined: installed use.gpu 0.20.0, especially
`workbench/mjs/{compute,pass,queue,hooks,data}`. Do not substitute current
online API descriptions for this pin.

- `dispatch` returns an empty call before an async pipeline exists. Its
  `onDispatch` callback executes inside command encoding, not GPU completion.
- `ComputeBuffer.then` is a Live fence, not a GPU dispatch-completion signal.
- `Compute immediate` submits synchronously during Live evaluation. Raw queue
  submission during evaluation is therefore not inherently an API violation.
- Native `Readback` collects copies and promises into `ReadbackPass`; that pass
  is quoted into the renderer queue, even when compute is immediate.
- `RawData`, `ComputeBuffer`, and `getScratchSource` do not supply an explicit
  buffer-destruction fence. Replacing our allocation with these primitives does
  not by itself prove safe explicit destruction.
- Our attribute snapshot waits 200 ms instead of observing dispatch readiness.
  `AttributeProducer` does not gate on upstream coordinate readiness. Coordinate
  snapshots also request copies while a coordinate provider is pending.
- `retireBuffers` waits two animation frames before fencing submitted work. This
  cannot prove that a retained old draw will never submit afterward.

## Resumed Checkpoint

The [publication decision and plan](2026-09-28-gpu-publication-contract.md)
records the recovered project goal, pinned upstream audit, alternatives,
executable acceptance and remaining research. The browser probe was rerun on
Chrome 153.0.8010.53 and confirms both premature publication and a snapshot that
stays stale after actual GPU output becomes correct. Gate 2 again logs a
destroyed element buffer and fails its allocation assertion. Production code
remains unchanged.

- `molgpu-sept-crj.14`: new bounded P1 bug for submission-aware publication and
  dependent-consumer gating. Depends on the contract spike.
- `molgpu-sept-crj.5`: reuse for owner/buffer/layout readback identity and
  equivalent scheduler deduplication.
- `molgpu-sept-crj.2`: retain semantic code conversion as a distinct fix.
- `molgpu-sept-19s`: reuse for style replacement and retirement regression;
  first-use immutable column uploads are allowed.
- `molgpu-sept-s5o.7`: reuse for measured native primitive adoption, preserving
  scientific kernels and documenting narrow exceptions.

## Retirement Checkpoint

The [retained-draw investigation](2026-09-28-gpu-retirement-boundary.md) now
reproduces the remaining lifetime risk under explicitly held replacement render
compilation. Immediate destruction produces nine invalid submissions; simulating
the two-frame-plus-fence helper still produces seven. A completed queue fence
and sibling Queue checkpoints both occur while old draws can still submit.
Neither is a withdrawal acknowledgement.

Suppressing explicit destruction in the research page avoids validation errors.
Twelve complete molecular mount/unmount cycles leave zero reachable molecular
buffer wrappers after the probe releases its own references and forces GC. This
is a small reachability observation, not a native-memory bound. Hiding the
molecular subtree withdraws the observed draws, including after the held
compilation is released; other passes/suspended siblings remain unverified.

Next bounded research within `crj.7`: test an allocation-specific validity cell
through native `DrawCall.shouldDispatch`, which runs before storage binding.
`RawFaces` forwards it; `RawQuads` (used by PointLayer) does not. Prove a
minimal guarded draw and identify an upstream-compatible points path before
choosing explicit retirement. If unavailable or too invasive, decide native
reachability with an honest cleanup guarantee and representative retention
measurements. Reuse `19s` for immutable-column style caching and its eventual
repair. Do not spread a cleanup helper, implement a new renderer, or close
`crj.7` on these observations alone. `crj.11` remains the next independent
spike.

## 2026-09-29 Continuation

The [guarded-draw decision](2026-09-29-gpu-retirement-decision.md) supersedes
the previous "next research" instruction. Native `RawFaces.shouldDispatch`
rejects a retired buffer while a sibling shader is suspended. A research-only
one-property forwarding change in pinned `RawQuads` rejects the retained old
Spacefill draw during held style replacement. The matching unguarded cases
submit destroyed buffers. Because points and lines do not expose this guard in
the installed pin and compute/readback paths need their own accounting, use
native reachability for allocations lacking complete consumer coverage. `crj.14`
can proceed from the publication contract; lifetime and memory-budget
verification stay in bounded implementation follow-ups.
