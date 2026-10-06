# Spike: ordered Kernel stages for Superpose and Unwrap (molgpu-sept-s5o.22)

Date: 2026-10-04. Base: main c429c1c. Follows
[native compute audit](2026-10-02-native-compute-audit.md) and the crj.7
[publication contract](2026-09-28-gpu-publication-contract.md).

## Question

Can use.gpu 0.20.0 `Kernel` stages inside one `Compute` express `<Superpose>`
(centroid → covariance and solve → apply) and `<Unwrap>` (link → propagate or
jump → centre sums → place), with parity against the CPU oracles, so the raw
`CoordinatePasses` path can go?

## What I read in the pinned code

- `Compute` gathers every child `Kernel` call and `ComputePass` encodes them, in
  child order, into one compute pass. Storage writes are ordered between
  dispatches in a pass, so ordered stages are expressible.
- A `Kernel` is one entry point. Its WGSL must be a _linked_ module
  (`@link fn …`), not a module with raw `@group/@binding` and several entries.
  Link order is `getSize`, args, `sources`, `source`, then targets.
- `size` becomes `ceil(size / workgroup_size)` workgroups, so a one-workgroup
  reduction is `size = workgroup size`.
- `ComputeBuffer` provides `[its target]` as the whole compute context: nesting
  two replaces the outer one. A second writable buffer therefore cannot be a
  second target; it has to be a `StorageSource` with `readWrite: true` in
  `sources`, linked as `@link var<storage, read_write>`.
- A compute pass cannot encode `copyBufferToBuffer`.

## Experiment (Superpose)

On the spike commit, `packages/viewer/src/internal/superpose-stages.ts` ran
`<Superpose>` as three `Kernel`s in one immediate `Compute`, behind
`superposeTesting.stages` (off by default). Stage WGSL is derived from
`superposeWgsl` by string surgery so the maths is the same text. Fit state is a
`readWrite` vec4 `StorageSource`; rows and reference are `sources`; parameters
are a `vec4<f32>` arg; output is the `ComputeBuffer` target published by the
existing `Published`.

Executable acceptance example, on the spike commit `6c69c2a` (branch
`health/coverage-audit-and-kernel-spike`; the prototype is not merged, see
Decision):

```bash
git checkout 6c69c2a
MOLGPU_SUPERPOSE_STAGES=1 deno test -A packages/viewer/test/run-trajectory.mjs
```

Result: passes. The stage path was confirmed active (three modules built per
mount). That suite holds the CPU `fitKabsch` oracle (every frame, selected fit
atoms, `translate: false`, collinear pass-through, `to="first"`), status
readback, the first-dispatch race and the nested-scope rejection, with the same
tolerances. The opt-in Gate 13 budget (`MOLGPU_DYNAMICS_GATE=1`) gives identical
owned-buffer bytes and dispatch counts, and similar timings from one run each:

|     Atoms | Mount, raw | Mount, Kernel stages |
| --------: | ---------: | -------------------: |
|   100 000 |     432 ms |               433 ms |
| 1 000 000 |    2065 ms |              2217 ms |

Timeline-tick and resident-frame publication stay at the frame interval (about
14 ms) in both. Single runs on a laptop; the 1M difference is within what I
would expect from noise and is not a finding.

## Costs the spike exposed

1. **Shader restructure.** Three linked modules replace one raw module; here
   they come from string replacement, which is only acceptable for a spike. A
   real conversion rewrites `superposeWgsl` in `@molgpu/dynamics` as linked
   stages (no renderer types cross that boundary, so this is possible).
2. **Types.** Parameters travel as `vec4<f32>`, so row counts are exact only to
   2^24 (the raw path uses `u32`). Fit state becomes `array<vec4<f32>>` indexed
   by constants, losing the `Fit` struct's field names.
3. **Status readback stays raw.** A compute pass cannot copy, so the staging
   copy becomes a second submit after the dispatch, run from a microtask. It is
   ordered by the queue but no longer in the same command buffer as the stages.
4. **Compile latency.** Three `Kernel` pipelines compile asynchronously and the
   generation waits for all three; raw creates three synchronous pipelines.
5. **No deletion.** `CoordinatePasses` remains for `<Unwrap>`, so converting
   Superpose alone adds a second provider mechanism and about 270 lines against
   about 70 removed.

## Unwrap

Not converted. Its dispatch count is data-dependent (one `propagate` dispatch
per level, `rounds` of pointer jumping on the deep-chain fallback, ping-pong
link buffers) and it clears buffers with `encoder.clearBuffer`, which a compute
pass cannot do. `Kernel` stages are fixed when the element is built, so it would
need a stage that clears, a fixed worst-case level loop or indirect dispatch,
and a rebuilt stage list whenever the forest changes. No measured benefit
offsets that.

## Decision

**Keep Superpose and Unwrap raw.** The Kernel-stage form is expressible and
passes the CPU oracle and lifetime checks, so the old reason ("multi-stage work
alone is not proof use.gpu cannot express it") is now answered and the file
headers should say so. The reason to stay raw is the measured cost above, not
inability: no performance gain, a split provider mechanism, weaker parameter
types, and a status readback that cannot live in the compute pass.

Alternatives: (a) convert Superpose only (works today; adds the cost in item 5);
(b) convert both once Unwrap's per-level dispatches have an indirect or
fixed-size form (not designed); (c) extend `CoordinateKernel` to accept ordered
stages so Superpose reuses its readiness logic (smaller than (a), still needs
items 1–3).

## Follow-ups

- Done: the `CoordinatePasses` header (`internal/coordinate-passes.ts`) cites
  this measured reason.
- The flag-gated prototype stays on the spike commit only; it was not merged,
  since the decision is to keep the raw path and it is not intended for release.
