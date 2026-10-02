# Superpose first-reference source recovery

Date: 2026-10-02. Tracking: `molgpu-sept-ktr.5`. Documentation baseline:
`82cfea7`; implementation remains in the working tree.

## Reproduction and decision

The controlled Chrome WebGPU regression in
[`run-superpose-source.mjs`](../../packages/viewer/test/run-superpose-source.mjs)
reproduced `<Superpose to="first"> needs a <Trajectory> ancestor` while a
nonempty Structure's trajectory loader was still opening. The first harness
attempt hit a sandbox localhost restriction; the approved browser run reproduced
the production error before implementation.

Keep a nearest, structure-owned trajectory scope even before its source opens.
The displayed frame remains null during opening/failure, preserving the public
`useTrajectoryFrame()` contract. An opening or failed inner Trajectory shadows
outer metadata while passing outer coordinates through. Structure boundaries
still shadow trajectory scopes; siblings remain independent.

Superpose distinguishes an absent ancestor from an unavailable reference. It
passes upstream coordinates through during source opening/failure and a pending
or failed frame-0 reference read. `onStatus` reports `pending` or `error`, with
`phase: "source"` for trajectory opening/playback errors and `"reference"` for
its own read failure. Existing generation/RMSD fields remain: the loading/error
generation is the upstream generation at the transition, and RMSD is null.
Without a callback, a reference failure logs once; Trajectory owns its source
error logging. Missing ancestors, missing fit-row positions and collinear
references retain their scientific/composition errors.

Reference requests now depend on the structure resource as well as trajectory
and row count. Replacement/unmount aborts and suppresses late results through
the existing source-request primitive. No GPU primitive, fitting algorithm,
allocation mechanism or retirement policy was replaced.

## Acceptance evidence

The focused browser regression covers controlled source opening, replacement,
source failure, retry, cancelled late opening, nested pending/failed source
shadowing, sibling scope isolation, independent first-reference read failure,
reference replacement and unmount cancellation, late success/rejection, one-time
fallback logging, and retained missing-ancestor/collinear errors. Coordinate
comparisons use actual mapped GPU outputs; queue completion and coordinate
matching establish results, rather than elapsed timers. The new runner is
included in `deno task test:components`.

Passing checks:

- `deno test -A packages/viewer/test/run-superpose-source.mjs
  packages/viewer/test/run-trajectory.mjs
  packages/viewer/test/run-components.mjs`:
  three browser suites passed. Expected exceptions were asserted only in
  deliberate invalid-composition/reference cases; successful and recovery cases
  had no page or uncaptured WebGPU errors.
- `deno test -A packages/viewer/test/run-retirement.mjs`: the complete existing
  retirement runner passed all 11 child invocations, including held draws,
  same-size replacement, in-flight compute, delayed/rejected maps and memory
  churn. Fresh generated output is retained under
  `/private/tmp/molgpu-ktr5-retirement`; pre-existing dirty October 1 evidence
  was restored byte-for-byte after the run.
- `deno task typecheck:components`.
- `deno task check:hardening`: all eight packages. The viewer API snapshot was
  regenerated and reviewed; only SuperposeProps/Status changed.
- `deno task jsr:check`: dry run only.
- Scoped source/harness lint, formatting and `git diff --check`.

Existing Vite builds report unresolved `@std/path` in their config bundling and
an undefined core default-import fallback in tube geometry; both browser suites
completed successfully. These unchanged warnings are outside this fix. No full
GPU gate, performance benchmark, publication or deployment is claimed.
