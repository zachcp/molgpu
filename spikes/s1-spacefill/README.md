# S1 rendering benchmark and S2 explicit-time spike

Requires Node 22+, installed Google Chrome, and WebGPU-capable hardware.

```sh
npm ci
npm run test:browser
# Only the forward/backward scrub assertions:
npm run test:s2
```

The runner starts/stops Vite and a fresh headless Chrome context at 1280×800,
DPR 1. Set `HEADED=1` to run visibly. `RESULTS_DIR` overrides the output directory.
`PLAYWRIGHT_MODULE` optionally points to an existing Playwright ES module instead
of the installed dependency. No browser profile or remote service is used.

`results/report.json` records browser/adapter metadata, timings, GPU submissions,
and S2 counters. PNGs show each workload and both color endpoints. Runs overwrite
these local outputs; copy evidence into docs before rerunning when preserving a
particular measurement matters.

S1 runs 10k/100k/1M deterministic synthetic atoms with continuous camera rotation,
60 warmup frames and 180 measured frames, plus a smaller-radius 1M case. Sampling
starts only after GPU submission and requires a visible document. At least 90% as
many submissions as sampled frames are required. These are browser frame-cadence
measurements, not GPU timestamp-query durations or universal performance promises.
`prep.pointBytes` counts packed CPU input bytes, not padded/resident GPU memory.
The empirical point-size conversion is retained from the earlier spike; physical
unit calibration is still a separate bead. The 100-sphere mesh smoke check fixes
and exercises vec4 stride, unit-diameter scaling and u32 index-count handling; it
is not an equal-size impostor/mesh performance comparison.

S2 is `s2.html`: move the slider to seek explicit seconds. A small pure sampler
uses the pinned EaseTypes implementation with linear RGBA keyframes and clamped
endpoints. It supports forward/backward evaluation without Animate or a clock.
The test checks interpolation, endpoints, nonfinite time rejection, and eight
seeks. Actual GPU write calls and source identities are observed for positions,
sizes, colors and a cached mesh. Colors must upload and renders must submit;
geometry construction and other uploads must stay unchanged. Endpoint screenshots
are also retained for visual inspection.

This spike deliberately uploads a color array per seek. Eliminating those uploads
with shader fields is `molgpu-sept-urn.5`, not a claim of S2. It is not the complete
timeline implementation (automatic splines, easing modes, camera tracks, beats).
The sampler's upstream imports are tested through Vite: direct Node ESM import
currently fails on upstream CommonJS/named-export interop. Do not infer a working
renderer-free Node package from this browser spike.
