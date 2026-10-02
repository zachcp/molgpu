# GPU DSSP bounds readback measurement

Date: 2026-10-01. Baseline: `88e975d`. Bead: `molgpu-sept-7uv`. No production
change; this records the measurement that decided against one.

## Question

`gpuDssp` submits a CA bounds reduction and awaits a 32-byte `mapAsync` before
it can size the dense cell grid (`planCellList`, which also enforces
`maxStorageBufferBindingSize` and selects the sparse-layout fallback). Does that
mid-pipeline wait cost enough during trajectory playback to justify sizing the
grid on the GPU or reusing a previous plan?

## Measurement

`MOLGPU_DSSP_BENCH=1 deno test -A packages/viewer/test/run-gpu-dssp.mjs` runs
`measureDsspPlayback` in `test/gpu-dssp/fixture.ts`: 40 successive frames with
±0.05 Å jitter written to one coordinate buffer, as a trajectory publishes them.
It reports the median end-to-end `gpuDssp` time and the median bounds `mapAsync`
wait, excluding the first frame (pipeline compilation). It also reports
dispatches and submits per update. Local Apple GPU, Chrome:

| Protein | Residues | Per update | Bounds wait | Share | Dispatches | Submits |
| ------- | -------: | ---------: | ----------: | ----: | ---------: | ------: |
| 1crn    |       46 |     2.0 ms |      0.5 ms |  25 % |         12 |       5 |
| 1tqn    |      659 |     2.6 ms |      0.6 ms |  23 % |         15 |       5 |
| 4c7r    |     1612 |     2.8 ms |      0.7 ms |  25 % |         15 |       5 |

The existing scale benchmark (1CRN copies) gives 8.3 ms for 14 076 residues and
30.1 ms for 140 714 residues end to end, with zero CPU mismatches.

## Decision

Keep the bounds readback. It costs at most about 0.7 ms per update at corpus
sizes. That is a fixed queue round-trip, not proportional work. The `GpuDssp`
provider runs latest-wins and asynchronously, so the wait never blocks a render
frame. It only delays when new codes publish, by less than a twentieth of a 60
Hz frame. Removing it would require either GPU-side grid sizing with indirect
dispatch, or reusing a previous plan with clamped cell indices plus an overflow
re-plan. Both add correctness paths around buffer budgets, the sparse fallback
and first-frame behaviour, which are exact and oracle-checked today.

Revisit only if a measured workload shows the bounds wait dominating, for
example on a much slower device or with many simultaneous DSSP providers.
`measureDsspPlayback` gives the number to compare.
