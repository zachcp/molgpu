# Post-overhaul diligence: IO, dynamics and timeline

Date: 2026-10-04. Baseline: `8bf1005`. Review: `molgpu-sept-0vs.2`. Read-only
production review after `ktr`; no production changes or Beads mutations by this
reviewer.

## Assessment

| Package  | Retain                                                                                                                                         | Simplify or follow up                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| io       | One public entry, format readers, shared transport/error/grid adapters, lazy Mol* wall; table is its only molecular-package dependency.        | Finish cancellation at frame decoding/publication; refresh dependency version prose.                    |
| dynamics | Scientific CPU references and paired WGSL; root application API and advanced `./wgsl`; public table imports for topology/view/spatial queries. | Reuse the existing private sign-orientation helper in the dense solver. No broad folder reorganization. |
| timeline | One entry, one private pinned-core interpolation adapter, seconds and deterministic owned samples; no sibling dependencies.                    | Keep current layout and imports. No new defect established.                                             |

Reviewed manifests, entrypoints, imports, source layout, transport and decoder
boundaries, scientific ownership and numerical kernels, curve construction and
sampling, upstream easing implementation, existing tests and the prior science
review. This is architecture/code diligence with scoped unit evidence, not an
independent proof of every scientific algorithm or GPU composition.

## S1: P2 — frame cancellation stops at the byte boundary

Reproduced through public `openTrajectory`: an XTC source read resolves
positions while its signal is already aborted. `io/src/xtc.ts:119–129` awaits
both the lazy decoder and bytes, then runs the Mol* task without a signal check
or abort observer. It also has no check after decoding or before return
(`:137–154`). `readExactly` checks around its byte read, but that cannot cover
subsequent asynchronous decoding. `table/src/trajectory.ts:131–144` validates
the returned frame without checking cancellation after awaiting the underlying
source.

The retained [probe](evidence/2026-10-04-post-overhaul-science-probe.ts) queues
cancellation immediately after a small custom byte read completes; it uses no
wall-clock timer. Current output is `aborted: true, outcome: "resolved"` with
positions `[1,2,3]`. An already-aborted second read rejects, but
`preservesReason: false`: table's wrapper creates a new AbortError at `:133`
instead of forwarding the signal's reason. IO README promises reason
preservation. This issue is at the public returned frame source, not a claim
that the viewer necessarily publishes stale frames (viewer owners also suppress
stale work).

The completed `crj.12` handles HTTP Range integrity, fetch cancellation and
header scans; `ktr.12` validates download budgets. Keep those closed. A bounded
follow-up should cover the remaining decoder/public-frame boundary, referencing
both existing decisions. No matching open cancellation issue was found in the
Beads inventory during this review.

Acceptance: pre-aborted reads reject with the exact signal reason; cancellation
after bytes but before decode/publication rejects with that same reason; a fresh
read still succeeds; independent frame signals remain independent of the
completed opening request. Apply checks around XTC lazy loading/task completion
and pass a cooperative Mol* observer where supported. The shared table frame
wrapper should check before and after awaiting its source. Add deterministic
regressions for custom-source completion and XTC decoding, preserving all
trajectory oracle outputs and avoiding timers. Run table trajectory and IO
trajectory/transport tests plus scoped type checking; viewer source-replacement
browser coverage is needed only if changing viewer integration.

## S2: P3 — duplicate mode sign normalization

`dynamics/src/elastic-network.ts:164–173` already defines `orient` over f64/f32
vectors, used by the Lanczos branch at `:243–247`. The dense branch repeats the
same largest-magnitude-positive normalization for its f64 vector at `:295–301`
and its compact f32 output at `:313–321`. These are equivalent mechanics within
one file, unlike the scientifically distinct eigensolvers.

A small cleanup can call the existing helper at both dense sites. Preserve both
calls: f32 rounding can change the largest-magnitude pivot. Retain the current
tie rule, negative-zero behavior, eigenpair ordering, residual calculations and
oracle tolerances. Acceptance: dense/Lanczos elastic-network tests and existing
ProDy oracle tests pass, with unchanged public API. No generic numerical utility
or upstream dependency is needed. This is source-confirmed duplication, not a
measured performance regression.

## Upstream primitives and imports

Read installed use.gpu 0.20.0 `workbench/mjs/animate/interpolate.mjs`,
`animate/ease/number.mjs` and `animate/ease/angle.mjs`, and the local adapter.
Timeline already imports core easing functions from `core/mjs/ease.mjs`.
Workbench's spline helpers reject zero scalar knots with `if (!k1 || !k2)` and
expect reusable target buffers, while timeline accepts zero knots and promises
fresh vector results. Its scalar automatic interpolation also needs the local
adapter's returned-value handling. Retain that boundary; importing Workbench
would not be a contract-equivalent simplification. Historical bundle-size/Node
loading claims in the adapter were not re-benchmarked here.

Dynamics has no use.gpu/Mol* imports. Its f64 Kabsch fitting, exact skew-box
nearest-image search, Philox thermostat, Coulomb/charge models and elastic
solvers carry scientific contracts beyond generic renderer math. Retain separate
CPU and WGSL implementations where they provide oracles. In particular, do not
merge the small-matrix Kabsch Jacobi implementation with dense elastic and
Lanczos solvers merely because their algebra overlaps: dimensions, convergence,
zero-mode and residual policies differ. The existing table spatial grid already
supplies elastic contact queries. Dense GPU cell-list planning/reference layout
is distinct from that sparse CPU spatial index.

IO already delegates BCIF semantics/assemblies, CCP4 transformation, XTC
decoding, selection parsers and molecular surfaces to Mol*. TRR remains local to
preserve streaming and velocity data; DCD preserves format variants; PQR handles
widened records and charge mapping. `molstar-model.ts` is a useful lazy facade,
not a public barrel to proliferate. No production sibling-private imports were
found in these three packages. Test fixtures do use table internals
intentionally; this does not justify exposing test convenience functions
publicly.

Keep shared `types.ts`, `error.ts`, `input.ts`, `byte-source.ts`, `grid.ts` and
`residues.ts` in IO, and paired operation/WGSL files in dynamics. Minimal public
exports is achieved at package entries; deleting private cross-file exports or
adding more per-format public entries would create churn without demonstrated
consumer value. Generated charge data remains separate with its license.

## Completed fixes and composition

Confirmed current source retains `ktr.10` validation of original guide rows,
`ktr.11` surface preflight and explicit sample cap, `ktr.12` finite download
ceilings, `ktr.13` removal of the unused vector copy, and `ktr.14` owned mode
vectors and mapping. Do not recreate those issues. Surface and CCP4 sample
budgets have different documented policies; this pass did not establish a new
CCP4 allocation defect.

Lower packages should remain value-oriented: IO constructs StructureData,
TrajectoryData and VolumeData; dynamics consumes topology/arrays/scientific
parameters; timeline controls seconds. The viewer resolves Structure/Trajectory/
Volume scope and owns specialized transforms and visuals. Trajectory scientific
picoseconds and timeline seconds must stay distinct, joined by explicit frame
curves. No scene hierarchy or provider registry belongs in these packages.

For current documentation consolidation, `io/README.md:24–30` still claims the
table dependency is `^0.1.0`, although the workspace package version is `0.2.0`.
Refresh this example or remove the fragile fixed sibling version while retaining
the single-resolved-copy guidance. Preserve dated historical findings, linking
completion notes instead of presenting prior defects as current.

## Verification and limits

Ran type-checked
`deno test -A packages/io/test/*.test.ts packages/dynamics/test/*.test.ts packages/timeline/test/*.test.ts`:
197 passed; the single HTTP Range server test was blocked by sandbox loopback
permission at `trajectory.test.ts:376`. Re-ran only that test with approved
escalation: 1 passed. All 198 scoped tests therefore executed successfully
across the two invocations; the first invocation was not an all-pass run. This
includes parser/corpus, transport, charge, molecular-surface, elastic/ProDy,
PBC, Kabsch, Langevin and timeline tests. Log: `/tmp/molgpu-science-tests.log`.

The retained probe was type-checked, linted, formatted and executed. No GPU
suite, full workspace hardening/JSR gate, benchmark, publish or deployment was
run by this reviewer. No public API changed. The primary reviewer owns Beads
updates and integrated documentation.
