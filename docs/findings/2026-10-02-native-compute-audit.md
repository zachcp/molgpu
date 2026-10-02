# Native compute audit: raw WebGPU paths in the viewer

Date: 2026-10-02. Bead: `molgpu-sept-s5o.7`. Base: `main` at `f4884a6`.
Contract:
[2026-09-28 GPU publication contract](2026-09-28-gpu-publication-contract.md)
(crj.7).

## Question

For every viewer path that builds WebGPU pipelines, buffers or readbacks itself,
should it move onto use.gpu 0.20.0's `Kernel`, `Compute`, `ComputeBuffer` or
`Readback`? Where it stays raw, the reason must be written in the file header.

## What the pinned primitives do

I read `workbench/mjs/compute/kernel.mjs`, `compute/compute-buffer.mjs`,
`compute/readback.mjs` and `queue/dispatch.mjs` at 0.20.0.

- **`Dispatch`/`Kernel` link WGSL text.** Workgroup variables, barriers and
  storage atomics pass through, so needing them is no reason to stay raw. `size`
  may be 1–3D, and `indirect` dispatch is supported. Pipelines compile
  asynchronously, and the dispatch suspends until its pipeline is ready.
- **A dispatch runs inside the frame loop's compute pass.** `Kernel`'s `initial`
  and `version` suppress repeat dispatches. Immediate `Compute` encodes and
  submits during evaluation.
- **There is no on-demand job.** A frame-loop dispatch cannot read a result
  back, size the next stage from it, wait for queue completion, or be aborted by
  a newer request.
- **`ComputeBuffer` memoizes its target and never destroys it.** `Readback`
  queues its copy in the renderer and carries no source or generation provenance
  (crj.7).

So the deciding question for each path is the shape of the job, not the WGSL
features it uses. Two of my mqo modules gave the wrong reason: they said
workgroup memory and atomics were unavailable. That is corrected here and in the
[GPU SES field findings](2026-10-02-gpu-ses-field.md).

## Decisions

| Path                                                                           | Job shape                                                                                                                                  | Decision                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CoordinateKernel` (Transform, NormalMode, Trajectory, assembly copies)        | One per-atom map per generation                                                                                                            | **Native already**: `ComputeBuffer`, immediate `Compute`, `Kernel` with `initial`/`version`, and a wrapper that learns when the dispatch is encoded.                                                  |
| `<FieldLines>`                                                                 | One integration per volume generation                                                                                                      | **Converted to native** in this change. The integrator WGSL is in linked form, run by `Kernel` on a `ComputeBuffer` target with the same encode-detection wrapper.                                    |
| `<Superpose>`, `<Unwrap>` (`internal/coordinate-passes.ts`)                    | Ordered dependent stages per generation in one command buffer (reduction → solve → apply; graph traversal), plus a status readback         | **Raw, kept provisionally.** crj.7 requires an ordered-stage experiment with CPU-oracle parity before converting. Filed as `molgpu-sept-s5o.22` (non-blocking). The header already states the reason. |
| `useCoordinateBounds`                                                          | One reduction and readback per generation, published with its source and generation                                                        | **Raw** readback: native `Readback` lacks provenance and queues in the renderer. The reason is now in the header.                                                                                     |
| `<EField>`                                                                     | One computation split into dispatches bounded for the GPU watchdog, one in flight, bursts coalesced, published after `onSubmittedWorkDone` | **Raw.** A frame-loop dispatch can't span chunked submissions or report completion. The reason is now in the header.                                                                                  |
| GPU DSSP                                                                       | Frozen generation; bounds readback sizes the cell grid; overflow readback with exact CPU recovery; cancellable                             | **Raw.** The reason is now in the header. Its hand-written hierarchical scan is replaced by the shared `internal/gpu-scan.ts`.                                                                        |
| GPU surface (`ses-field`, `marching-cubes-gpu`, `attribution-gpu`, `gpu-scan`) | One cancellable job: grid sized from a bounds readback, probe list from a count readback, mesh from totals readback                        | **Raw.** The reasons are corrected in the headers.                                                                                                                                                    |
| `throttled-readback`, `status-readback`                                        | Demand-driven, provenance-tagged staging                                                                                                   | **Raw**, per crj.7 (`Readback` has no source token or throttling policy).                                                                                                                             |
| `volume-buffers`, `immutable-attribute-cache`, `instrumentation`               | Allocation and upload only                                                                                                                 | Not compute; out of scope.                                                                                                                                                                            |

## Duplication removed

- **Position copy:** `COPY_POSITIONS` moved to
  `internal/copy-positions-wgsl.ts`, shared by GPU DSSP and the SES field
  (mqo.1).
- **Scan:** GPU DSSP, the SES cell list and GPU marching cubes all use the
  fold-safe `internal/gpu-scan.ts`. Before, DSSP orchestrated its own
  hierarchical scan over `cellListWgsl`.
- **Bounds reductions:** `useCoordinateBounds` and the `cellListWgsl` bounds
  stage still both exist. They are not equivalent: the hook also publishes a
  centroid, and its readback has its own provenance policy. Both are left in
  place.

## Evidence

FieldLines on native `Kernel`:

- `run-efield`: the dipole invariant drift across lines is at most 9.6e-4
  (threshold 0.02), and a colour-range edit dispatches nothing new, uploads
  nothing and builds no geometry.
- `run-retirement`, which includes the field-lines memory case, passes, as do
  `run-invalidation` (75 passed) and `run-volume`.

GPU DSSP on the shared scan: `run-gpu-dssp` passes on the corpus, matching CPU
DSSP.

`deno task typecheck`, `lint` and `fmt` pass.

## Outcome

s5o.7 is complete:

- every raw path has a recorded reason in its header;
- the one path the primitives clearly express (FieldLines) is converted;
- the one remaining open experiment (Superpose/Unwrap ordered stages) is filed
  as non-blocking.
