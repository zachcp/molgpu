# GPU retirement coverage and memory bounds

Date: 2026-10-01. Issue: `molgpu-sept-crj.15`. Branch:
`codex/crj-15-retirement-coverage`, based on `main`. Reviewed pin: use.gpu
0.20.0.

## Result and change

The retirement runner now gates the representative dynamic owner matrix,
retained colour/picking/shadow work, deferred and rejected maps, DSSP scratch
cancellation, and native/browser memory bounds in CI. Two staging owners needed
a repair: `useStatusReadback` and `useCoordinateBounds` released a staging
allocation by explicit destruction while its map completion was pending. They
now release logical viewer ownership at retirement, prevent new work for that
owner, and let the outstanding map settle before destroying its staging
allocation.

Status validity and busy slots belong to the allocation set, so replacement
cannot reactivate an old callback. Successful retired maps are unmapped without
publication; rejected maps also release their slot. Bounds retains only the
staging allocation used by its asynchronous run; unused staging and synchronous
scratch keep their existing cleanup. Snapshot staging already had this policy
and was left unchanged.

The [baseline trace](evidence/2026-10-01-readback-retirement-baseline.json)
observed early staging destruction in all four status/bounds replacement/unmount
cases, with zero page or uncaptured GPU errors. This is a reproduced lifetime
ordering discrepancy, **not** a reproduced destroyed-buffer submission. The
repair strengthens map completion and avoids cancelling useful in-flight work;
it does not claim the baseline generated GPU validation errors.

No scientific algorithm, public API, renderer primitive, immutable style cache,
or publication policy changed. No additional explicit destruction was added for
published buffers. Negative owner probes did not justify changing their existing
cleanup. The installed `ComputeBuffer`, `Kernel`, `useRawSource`, `PickingPass`
and `ShadowPass` implementations were reviewed before constructing the probes.

## Executable coverage

```sh
deno test -A packages/viewer/test/run-retirement.mjs
```

The existing CI glob already includes this runner. The runner executes these
cases serially, including memory measurements in dedicated Chrome process trees:

| Case                                                                     | Stimulus and observed boundary                                                                                                                                                                                         | Local result                                                                                                                                |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Volume, EField phi, FieldLines vertices, produced attributes             | Existing counterexample fixtures: hold replacement render compilation past two frames and a completed queue fence; hide and fully unmount                                                                              | 0 post-destruction submissions; 0 uncaptured errors; old draw observed after the fence                                                      |
| Root columns, Transform, Trajectory, NormalMode, Superpose, Unwrap, DSSP | Same-size input/owner replacement and row-count resize; hold separately styled sibling and replacement render compilation, plus Transform selected-to-all compute compilation; hide while held, release, fully unmount | 14 cases; 0 post-destruction submissions/errors; no molecular draws after hide                                                              |
| Picking and shadow consumers                                             | Public `PickingProvider`, pickable Spacefill and a directional shadow map in both owner matrices                                                                                                                       | Every owner actually encodes molecular draws in `PickingPass` and `<ShadowPass> Atlas #1`; asserted rather than inferred from enabled flags |
| DSSP scratch                                                             | Hold native bounds-map completion in the first submitted invocation; retire owner; release the map                                                                                                                     | Scratch destroyed after completion; aborted invocation publishes no status; 0 post-destruction submissions/errors                           |
| Status, bounds, snapshot staging                                         | Replace or unmount with map not yet begun, native map completed but callback held, or injected map rejection                                                                                                           | 18 cases; pending staging not destroyed; retired maps publish nothing; staging destroyed after settlement; 0 errors                         |
| Existing late-status fixture                                             | Unmount after native mapping, before callback release                                                                                                                                                                  | Idle slot destroyed at retirement, busy slot after release; no status/errors                                                                |

Submission tracing follows bind-group buffers through render draws, compute
dispatches, **and copyBufferToBuffer source/destination edges** into submitted
command buffers. Destruction events and submission order are checked per buffer
identity. NormalMode's non-`molgpu:` input labels are included. Compilation is
held by unresolved promises; frame advancement only exercises continued
rendering. A completed queue fence is an observation point, not a withdrawal
certificate.

Owner matrices are negative probes for the tested ordering: old coordinate and
DSSP draws withdraw before explicit destruction. They do not demonstrate that
arbitrary extension consumers or different future renderers can safely destroy
those buffers. The earlier retained-volume/field/attribute counterexamples
remain positive demonstrations of why reachability is required for their
published allocations.

Evidence: [resize matrix](evidence/2026-10-01-owner-retirement-passes.json),
[same-size matrix](evidence/2026-10-01-owner-retirement-same-size.json),
[DSSP in-flight cancellation](evidence/2026-10-01-owner-retirement-inflight.json),
[readbacks](evidence/2026-10-01-readback-retirement.json),
[late status](evidence/2026-10-01-status-retirement.json).

## Measured memory acceptance

The coordinate churn fixture uses 25,000 and 100,000 atoms for each of
Trajectory, NormalMode, Superpose and Unwrap, seven cycles per case. It
alternates full hide / remount with replacement while mounted, changes the row
count, demands coordinate snapshots and bounds, and renders a four-row
selection. Thus the provider and readback buffers scale with the full structure
while render throughput does not obscure the allocation test. These are
synthetic structures; Unwrap exercises its component/working allocations with
isolated atoms rather than a dense bonded protein. DSSP scientific coverage
remains in the corpus suite.

Acceptance is executable and checks every cycle, not just the first/last pair:

- Post-GC dedicated browser-process-tree RSS may grow at most **128 MiB** above
  its first warmed sample.
- RSS sampled every 100 ms during churn may grow at most **256 MiB** above its
  first-cycle sampled peak. Mounted RSS is also reported. Sampling is not an
  exact continuous peak measurement.
- Reachable molecular buffer wrappers may occupy at most **256 bytes per atom**
  in this fixture, and none may predate the immediately previous churn epoch.
  This permits the bounded previous generation observed through replacement; it
  rejects retention accumulating across the seven cycles.
- After full root unmount, only an observed immutable `element` column wrapper
  may remain, at most **4 bytes per atom + 64 bytes**. Dynamic coordinate,
  input, bounds and staging wrappers must be gone. The retained column's cause
  is not inferred from this test.

The wrapper budget allows two representative allocation sets (trajectory window,
map, packed output, root columns and double snapshot staging) plus bounds
scratch. The RSS budgets allow browser/compiler allocator warmup while remaining
fixed across repeated churn; increasing cycle count does not increase them. They
are regression budgets for these sizes and compositions, not universal
scientific memory limits.

Across the 56 local coordinate cycles, the largest sampled process-tree RSS was
1041.8 MiB, the largest post-GC growth above a case's first sample was 34.2 MiB,
and the largest reachable molecular-wrapper payload was 10.33 MiB. Every
full-root unmount left only the latest `element` wrapper (100,000 or 400,000
bytes). These observations satisfy the fixed budgets above.

A separate seven-cycle EField/FieldLines/VolumeSlice fixture requests a
24,987,856-byte phi allocation each cycle. It rejects any reachable superseded
phi wrapper, allows one newest phi wrapper after hide, and checks all post-GC
samples against 128 MiB and mounted samples against 256 MiB growth. Existing
Volume coverage still tests four 256³ / 64 MiB mounts.

[Coordinate memory evidence](evidence/2026-10-01-coordinate-memory-churn.json)
and [field memory evidence](evidence/2026-10-01-field-memory-churn.json) report
RSS and wrapper reachability separately. RSS includes the dedicated browser,
renderer and GPU processes; it is a proxy for native allocation pressure, not
isolated GPU VRAM. Forced GC demonstrates reachability and bounded observed
reclamation, not ordinary-GC timing or a guarantee of immediate native release.

## Validation and handoff

Local Chrome 154.0.8037.59 on macOS passed the expanded retirement runner and
the existing trajectory, GPU DSSP corpus and readback-identity suites. Component
and public entry type checking and scoped lint/format checks pass. Existing Vite
warnings about `@std/path` and the core ESM default fallback remain in the
trajectory/DSSP harnesses; their behavior tests passed.

Hosted SwiftShader/CI validation is still required before closing `crj.15`.
These are representative acceptance examples, not a full GPU gate or proof for
all possible extension consumers. The contributor guide's historical Gate 2 skip
statement is stale relative to the current CI glob, which includes every
`run-*.mjs` viewer suite. This work does not claim that entire glob was run
locally. No publish or deployment was performed.

## PR #42 CI startup regression

The first hosted runs (36858946555 and 36858915214) failed the matrix's picking
assertion for Transform and NormalMode respectively. The startup barrier
accepted any draw, including the sibling, before molecular picking compilation
finished. The corrected barrier requires actual molecular color, picking and
shadow draws before replacement is armed. Draw evidence now records only that
draw's bound buffers; submission evidence still accumulates all uses.

Both matrix variants deliberately hold initial picking compilation, demonstrate
that the old any-draw condition can be satisfied while replacement readiness is
false, then release it and await all molecular passes. The arm guard rejects
premature replacement.
[Startup regression evidence](evidence/2026-10-01-retirement-startup-regression.json)
records the first molecular draws before arming for all fourteen owner cases.

The push run also failed postprocess loading with Vite's `Outdated Optimize Dep`
response. This was reproduced locally. The postprocess harness now uses an
isolated cold dependency cache, explicitly prebundles its lazy BCIF/surface
adapter entries, and disables late optimizer discovery. Page and GPU error
assertions remain strict. Two fresh-cache postprocess runs and the full expanded
retirement runner passed locally after these fixes; fixed memory budgets are
unchanged. Hosted validation remains pending for the follow-up commit.
