# Primitive second-pass counter-review

Date: 2026-10-12. Reviewed `codex/primitive-second-pass` at `923f65d`,
three-commit diff from `da52c90`. Focus: correctness and simple caller props and
components. The initial review made no production changes; the correction below
records the subsequent requested implementation.

The simplification direction is sound. One explicit caller contract per feature
and private `Omit`-derived adapters remove duplication without adding caller
concepts. Named props support typed wrappers; defaults, selection wrappers and
instance composition remain intact. The volume options/shader split keeps
allocation and dispatch ownership with the component. Keep this design; neither
a generic trait hierarchy nor another public configuration object is warranted.
Ramachandran's separate science, colors and placement dependencies address the
reported style invalidation problem. No further defect was established there.

Two gaps were found in F3's new validation boundary. Both were CPU-reproduced;
their rejection regressions now live in
[volume-options.test.ts](../../packages/viewer/test/volume-options.test.ts).
These are incomplete validation fixes, not newly established regressions from
the baseline and not reproduced browser failures.

## F1 — P2: compare ranges at their actual GPU precision

`packages/viewer/src/volume/representations/color-ramp.ts:18–21` checks that
each endpoint rounds to a finite f32, but compares the original JavaScript
numbers. All three normalizers accept `[1, 1.00000001]`; uploading that interval
as f32 produces `[1, 1]`. FieldLines, FieldArrows and VolumeSlice divide by
`range.y - range.x`, so the accepted interval has a zero denominator. The
documented distinct-f32 contract is not enforced.

Compare the rounded endpoints for distinctness/order and check that their f32
difference remains finite and nonzero. Preserve descending slice ranges and
borrowed array identity. Rejection tests should cover ascending and descending
collapse, underflow and overflowing interval width, plus valid intervals. This
requires a small helper correction, with no additional public props.

## F2 — P3: validate every RGBA slot, including array holes

`color-ramp.ts:38–43` uses `Array.some`, which skips holes. A four-slot array
with only slots 0 and 3 set to 1 passes all three normalizers and generates
`vec4<f32>(1.0, , , 1.0)`. Missing outer stop slots likewise evade `some`.
JavaScript callers and programmatically constructed arrays can reach this path;
ordinary complete literal tuples are unaffected.

Validate indexed slots rather than skipping absent entries. Reject sparse outer
arrays and sparse RGBA arrays with the existing component-specific TypeError
before shader construction. Keep complete single/duplicate stop behavior and
unused glyph-stop policy intact. No new caller-facing option is needed.

## Tracking and verification

Reused `molgpu-sept-48k`: these failures are within its existing finite-range
and malformed-ramp acceptance criteria. It was reopened with fresh evidence
rather than creating duplicate bugs. The other three follow-ups remain closed;
this review does not invalidate their evidence.

Review checks passed: eight existing volume-options/Ramachandran CPU tests, two
counter-review characterization tests, the compile-only contract probe, viewer
H1–H6 hardening, and scoped formatting/lint. Characterization tests assert the
remaining failures and should become rejection regressions when corrected.

The implementation's EField, Volume, invalidation and site browser results were
reviewed in its acceptance notes; they were not rerun here. No fresh full CPU,
JSR or GPU gate is claimed. Existing browser coverage exercises ordinary ramps
and style transitions but does not test these malformed/precision cases. No
publication, deployment, commit or push was performed during the review. The
pre-existing untracked `.claude/` directory was left untouched.

## Correction

The PR follow-up compares the f32-rounded endpoints and checks their f32 width
before binding. Validation visits missing stop entries and each RGBA slot rather
than skipping holes. The caller props and component composition are unchanged.
Borrowed array identities, descending slice intervals, single/duplicate field
stops and unused field ramps retain their documented behavior.

The temporary characterization file was replaced by two maintained rejection
tests covering all three consumers, ascending/descending collapse, interval
underflow/overflow, sparse stops and every missing RGBA channel. Positive checks
cover adjacent f32 endpoints, subnormal intervals and input identity. The ten
focused CPU tests, component typecheck and scoped lint passed.

Fresh Volume and EField browser suites passed (2 passed, 0 failed), including
the existing ramp/style transitions and replacement/unmount assertions with no
WebGPU errors. EField throughput cases were enabled. Viewer H1–H6 hardening,
scoped formatting and diff whitespace checks also passed. Browser/hardening
checks required local server access outside the filesystem sandbox; initial
sandbox attempts failed to bind their servers. The reruns succeeded. Vite
emitted the existing unresolved `@std/path` config warning.

Logs: `/private/tmp/molgpu-counter-review-browser.log`,
`/private/tmp/molgpu-counter-review-types.log`, and
`/private/tmp/molgpu-counter-review-hardening.log`. This correction does not
claim a fresh full workspace CPU, JSR or all-suite GPU run. No publication or
deployment was performed.
