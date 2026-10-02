# Linear field wrap endpoint parity

Date: 2026-10-02. Tracking: `molgpu-sept-ktr.15`. Source baseline: `001bef2`.

## Decision and repair

Linear's existing CPU behavior and overflow-only contract are retained: its
closed domain maps both endpoints to the corresponding range endpoints. Only
normalized values below zero or above one wrap. For domain `[0,1]` and range
`[10,20]`, input `1` returns `20`, while `2` returns `10`. Reversed domains
follow the same normalized convention. Curve wrap remains periodic over its
half-open stop interval, so the last stop time returns the first stop value.

Before implementation, the expanded existing raw WebGPU parity harness
reproduced the upper endpoint discrepancy (`linearWrap1`, absolute error 10).
The CPU endpoint tests already passed. WGSL emission now uses a small private
helper that applies `fract` only outside `[0,1]`. CPU evaluation, curve
emission, public declarations, dependencies and scientific algorithms are
unchanged. The README and constructor documentation state the deliberate
distinction.

## Verification

Explicit test values cover both endpoints, interior points, positive and
negative overflow, integer-period overflow, negative domains and reversed finite
domains. Nine four-row linear batches and seven curve times run in the existing
real GPU parity harness. Every new case has zero measured CPU/GPU error. The
harness now captures uncaptured WebGPU errors and releases each case's device
after completed readback.

Passing checks:

- `deno test -A packages/fields/test/*.test.ts`: 35 type-checked tests.
- `deno check packages/fields/src/index.ts`.
- `deno task test:fields:gpu`: all 27 cases passed in Chrome 154.0.8037.95, with
  no page or uncaptured WebGPU errors.
- `deno run -A scripts/check-hardening.mjs fields --update`: H1–H6 passed,
  including the publish dry run; reviewed API snapshot has no changes.
- Scoped formatting/lint and `git diff --check`.

Numeric validation and literal serialization remain the separate `ktr.16`
follow-up. These checks do not claim parity for nonfinite inputs, every
floating-point rounding boundary, a full viewer GPU gate or a benchmark. No
publication or deployment occurred.
