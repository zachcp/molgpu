# S1/S2: measured rendering and explicit-time invalidation

Run: 2026-09-17. Beads: `molgpu-sept-cqm.7`, `.1`, `.2`.

## Result

S1 and S2 pass their feasibility criteria on this machine. Together with S3's
previous kernel-reuse result, Gate 0 is satisfied. This is not a promise of 60 fps
on every device or proof that the library-level resource architecture exists.
S4's importer/bundle experiment and the open upstream regressions remain work.

## Reproducible browser harness

`spikes/s1-spacefill/run-browser.mjs` starts Vite and fresh Chrome pages, uses a
fixed 1280x800 viewport at DPR 1, counts GPU queue submissions and buffer writes,
and fails on browser/WebGPU errors. It waits for submitted GPU work to finish
before accepting each page. Run `npm ci && npm run test:browser` from that spike;
see its README for requirements and the S2-only command.

This run used Chrome 150.0.7871.187 headless, with the WebGPU adapter reporting
vendor `apple`, architecture `metal-3`. The browser did not disclose a specific
chip model. It reported the document visible and generated frames without an
app preview pane or human watching the browser. The unsafe-WebGPU enablement
flag is recorded in the runner; no software-renderer forcing flags were used.

## S1 timing evidence

The old sampler could time an idle scene. The new scene continuously rotates the
camera; sampling starts after a GPU submission, warms up 60 frames and records
180. Each workload below submitted exactly 180 GPU batches during that window.
These are frame-cadence measurements, not GPU timestamp durations.

| Atoms | Size parameter | Median ms | p95 ms | Median fps |
|---:|---:|---:|---:|---:|
| 10,000 | 74 | 16.7 | 17 | 59.9 |
| 100,000 | 74 | 16.7 | 17.1 | 59.9 |
| 1,000,000 | 74 | 33.5 | 50.5 | 29.9 |
| 1,000,000 | 18.5 | 17.7 | 34.2 | 56.5 |

100k atoms sustain approximately 60 fps in this workload. At 1M, reducing sphere
size improves cadence substantially, consistent with fragment/overdraw pressure;
this experiment does not isolate the GPU bottleneck conclusively. The empirical
size calibration remains unresolved in jy6.5. `pointBytes` in raw evidence counts
packed CPU inputs, not padded GPU allocation or total resident memory.

Also repaired the previously malformed mesh baseline: vec4 position/normal
stride, unit-diameter sphere scaling, u32 merged indices and index draw count.
The 100-sphere smoke test renders without validation errors. It is not a new
instanced-RawFaces implementation or an equal-apparent-size comparison.

## S2 invalidation evidence

`s2.html` owns explicit time in seconds. `sample.mjs` uses upstream
`EaseTypes.number.spline` for linear RGBA keyframes, with no Animate clock.
Tests cover clamped endpoints, midpoint interpolation, exact knots, direction
independence and nonfinite time rejection. The scene seeks through
0.5, 1, 1.5, 2, 1.5, 1, 0.5, 0 after the initial t=0 render.

Across all eight seeks:

- Position construction and the cached sphere mesh construction stayed at **1**.
- Position and size buffer writes stayed at **1** each.
- Bound mesh position, normal, UV and index buffer writes stayed at **1** each.
- Color-array construction and color-buffer writes increased from **1 to 9**.
- Tracked GPU buffer replacements stayed at **0**; every seek submitted a render.
- Browser and WebGPU validation errors were absent.

GeometryData exposes shader-backed attributes; the probe traverses those bindings
to inspect real GPU buffers rather than assuming every source has `.buffer`.
Red/green endpoint canvas screenshots differ and were visually checked. The mesh
smoke image was also inspected; the cached mesh in S2 is a memoization witness,
not a molecular representation correctness test.

This proves cheap geometry reuse while uploading new color buffers. It does NOT
prove the stronger urn.5 requirement of no per-atom style uploads; that is the
next field-compilation experiment. No automatic spline/easing/camera/beat system
was implemented. Direct Node ESM import of the upstream interpolator fails on
CommonJS named-export interop; only the Vite/browser path is proven here.

## Saved evidence

[Machine-readable report](evidence/2026-09-17-s1-s2/report.json),
[100k atoms](evidence/2026-09-17-s1-s2/s1-100000-74.png),
[t=0](evidence/2026-09-17-s1-s2/s2-t0.png),
[t=2](evidence/2026-09-17-s1-s2/s2-t2.png), and
[corrected mesh smoke](evidence/2026-09-17-s1-s2/mesh-smoke.png).
