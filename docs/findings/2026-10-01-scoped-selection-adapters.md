# Scoped molecular selection adapters

Implementation for `molgpu-sept-crj.20`, on `codex/crj-20-scoped-selection`,
based on main `a89700d`. The contract follows the ordinary JSX decision and its
counter-review amendment. Pinned use.gpu remains 0.20.0.

`SelectionInput` is shared by representations, EField, coordinate selections,
Label/Distance and focus. Query defaults are first-model/primary-conformer for
ordinary consumers, all rows for coordinate selections. Explicit query scopes
win; resolved atom selections are exact and topology-bound. Pending and
selection errors are contained at the consumer, and never become default draws.

The internal resolver subscribes to nearest coordinate snapshots and declared
attribute columns. Opaque attribute predicates subscribe to all visible produced
columns. Source/owner/layout tokens withdraw superseded publications, including
DSSP warmup. Status reports distinguish pending, ready-empty, retained complete
membership while updating, and errors. Inputs are latest-published at 4 Hz/on
pause, with no guarantee that coordinate and attribute publications share a
frame.

The browser acceptance exercises default/explicit views, scoped proximity seeds,
exact membership, predicate/foreign/stale errors with healthy siblings, precise
subscriptions, nested structures and sibling streams with equal local
generations, stable-empty warning deduplication, coordinate selectors and live
focus. Real GPU coordinate and attribute producers run behind held map promises:
replacement and row-count resize reject old-owner publications, and unmount
emits no late status. The public AcceptanceScene renders BCIF loading,
trajectory/transform, Ribbon, ligand/proximity Spacefill, EField/isosurface and
a GPU DSSP selection without the five former missing-query type suppressions.
Query-valued Label/Distance also pass their image/centroid browser oracle. Pure
tests verify guide-only partial residue trace membership.

Two reproduced regressions were corrected before handoff. Membership-array reuse
must reset on dataset identity or topology revision, otherwise held draws can
reference retired root buffers. DSSP's pending selection snapshot must preserve
its existing GPU attribute draw replacement branch, otherwise held render passes
can reference retired code buffers. Unchanged main passed the same retirement
matrix; the corrected implementation passes it and the full retirement runner.
Pinned Live also registers only one cleanup per resource hook, so multiple
attribute subscriptions use one combined teardown.

## Validation

Local Chrome 154.0.8037.59 on macOS:

- `deno task test`: 486 passed, 0 failed.
- `deno task typecheck`, `deno task typecheck:components`: passed.
- `deno task check:hardening`: all eight packages passed; viewer `api.txt`
  reviewed.
- `deno task jsr:check`: dry run passed; nothing published.
- `run-selection.mjs`: passed, 131 diagnostic events, no uncaptured WebGPU
  errors.
- `run-invalidation.mjs`: 75 passed, 28 existing ignored cases, 0 failed.
- `run-retirement.mjs`: full runner passed in 1m50s, including its fixed memory
  bounds and held-draw/readback assertions.
- `run-annotations.mjs` and `run-gpu-dssp.mjs`: passed.
- Relevant component, trajectory, EField, Tube, Ribbon and Surface browser
  suites passed during implementation. This is not a claim that the full browser
  glob or Gate 2 was run locally; hosted CI supplies the complete browser gate.
- Scoped formatting, lint and diff whitespace checks passed.

An initial invalidation failure exposed excess trace rebuilding; stable
membership within one topology now retains its row array. One full retirement
attempt was interrupted by Vite source reloads during its memory phase; the
final source-frozen run above passed. Existing generated retirement baseline
files were restored to avoid replacing unrelated historical evidence with a new
run's allocation IDs.
