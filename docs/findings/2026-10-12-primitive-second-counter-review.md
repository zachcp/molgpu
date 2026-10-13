# Primitive PR: second counter-review

Date: 2026-10-12. PR #95, `codex/primitive-second-pass` at `dae2e19`; baseline
`da52c90`. The initial review made no production changes; the requested
correction is recorded below.

## Result

No additional regression was established in the PR. The range-width and sparse
array fixes hold. The caller contracts retain their original option sets,
selection diagnostics and wrappers. `ColorStops` and the compatibility alias
remain structurally equivalent. The component-local options/shader split keeps
ownership and dispatch in the components. Ramachandran's scientific memo depends
on identity, topology and immutable positions; attribute/color changes update
colors separately. Its columns retain array identity across style edits.

Keep the simple explicit props and specialized components. No generic trait
system, configuration wrapper or new provider is justified by this review.

One separate pre-existing numerical bug was reproduced on WebGPU. It does not
reopen the completed malformed-input validation fix.

## F1 — P3: narrow ramp intervals extrapolate at their endpoint

Tracking: `molgpu-sept-mgo`.

At `packages/viewer/src/volume/representations/color-ramp.ts:80`, thresholds and
the subtraction origin use rounded f32 stop positions, while the denominator is
the separately rounded difference of the original JavaScript positions. Those
operations need not agree.

Example input:

```ts
const stops = [
  [0.5, [1, 0, 0, 1]],
  [0.5000001, [0, 1, 0, 1]],
] as const;
```

The generated branch ends at `0.5000001192092896` and divides by
`1.0000000116860974e-7`. At that endpoint, interpolation uses a weight of about
1.192 instead of 1. A fresh Chrome WebGPU compute dispatch returned
`[-0.1920928955078125, 1.1920928955078125, 0, 1]` rather than `[0, 1, 0, 1]`.
Compilation messages and uncaptured errors were empty. This is a numeric GPU
failure; no screenshot/render artifact is claimed. Default broad ramps are
unaffected by this example. VolumeSlice, FieldLines and FieldArrows share the
builder.

Baseline `da52c90` generates byte-identical WGSL for this input, confirmed by
executing both builders and comparing their strings. This is a pre-existing
defect exposed by the deeper precision review, not introduced by this PR.

Use consistently rounded stop endpoints to derive interpolation widths,
retaining the existing supported single/duplicate-stop policy. Add a numeric GPU
test for endpoint colors and an interior sample; the current string assertions
only cover exactly representable broad intervals. Keep arrays borrowed and props
unchanged. A private builder correction suffices.

## Evidence and limits

Fresh checks: 13 focused CPU tests across color-ramp, volume-options and
Ramachandran, plus the compile-only contract probe, passed. Source inspection
covered the changed public/resolved contracts, volume normalization and
specialization, nearest-volume dependencies, Ramachandran science/style/layout
dependencies and column ownership. No additional allocation or dispatch change
was found in the refactor.

The focused GPU reproduction is retained at
`/private/tmp/molgpu-ramp-endpoint-review.ts`; run it from this checkout with
`deno run -A --config deno.json /private/tmp/molgpu-ramp-endpoint-review.ts`.
Its output is `/private/tmp/molgpu-ramp-endpoint-review.log`. This requires
Chrome and local server access, using the repository's existing WebGPU browser
harness. The baseline builder was extracted to
`/private/tmp/molgpu-baseline-ramp.ts` for comparison. No full GPU or JSR gate
was rerun in this review. The preceding correction records passing Volume/EField
browser suites and viewer hardening on `dae2e19`'s source.

No implementation, commit, push, publication or deployment was performed during
the review. The pre-existing `.claude/` directory remains untouched.

## Correction in PR #95

The builder now computes interval widths from the same f32-rounded endpoints
that the shader subtracts. Nonzero widths retain their actual magnitude rather
than being floored at `1e-12`; exactly coincident rounded stops keep the
existing fallback. Public props, component composition and borrowed input arrays
remain unchanged.

The maintained Volume browser suite now dispatches the generated ramp code and
checks nine numeric cases: both narrow endpoints and the midpoint, a `1e-13`
interval, exact duplicates, stops coincident after rounding, and a single stop.
The endpoint must be `[0, 1, 0, 1]` and the midpoint `[0.5, 0.5, 0, 1]`, with
per-channel tolerance `1e-6`. Existing suite checks still cover replacement,
unmount and uncaptured WebGPU errors. CPU coverage also checks denominator
construction and unchanged caller input. Fourteen focused CPU tests, component
typecheck and scoped lint passed.

Fresh Volume and EField browser suites passed (2 passed, 0 failed), with no
uncaptured WebGPU errors. The numeric report records nine passing cases and the
corrected endpoint `[0, 1, 0, 1]`; EField throughput cases were enabled. Scoped
formatting and diff whitespace checks passed. The existing Vite `@std/path`
config warning remained. Logs: `/private/tmp/molgpu-narrow-ramp-browser.log` and
`/private/tmp/molgpu-narrow-ramp-types.log`. No new full workspace GPU/JSR gate
is claimed, and nothing was published or deployed.
