# 3D texture vs storage buffer for volume sampling (u71.3)

Date: 2026-09-26. Bead: molgpu-sept-u71.3. Evidence:
[bench.mjs](evidence/2026-09-26-volume-texture-spike/bench.mjs) and
[report.json](evidence/2026-09-26-volume-texture-spike/report.json).

## Question

Phase 11 ships `sampleVolume` as manual trilinear interpolation over an f32
storage buffer (plan section 3). use.gpu 0.20.0's `RawTexture` is 2D-only, but
core can bind `texture_3d`. Does a custom 3D-texture provider earn its API and
complexity for slices and raymarching at 256³?

## Method

Raw WebGPU (no use.gpu) in headless Chrome 153 on Apple Metal 3; the adapter
exposes `float32-filterable` and `timestamp-query`. The benchmark uses a 256³
smooth scalar field (64 MiB as f32) and compares four ways to sample it at a
fractional grid index:

| Variant          | Storage                     | Interpolation                                  |
| ---------------- | --------------------------- | ---------------------------------------------- |
| `storage`        | `array<f32>` storage buffer | manual trilinear, 8 loads (the shipped path)   |
| `textureLoad`    | `r32float` `texture_3d`     | manual trilinear, 8 `textureLoad`s             |
| `r32floatLinear` | `r32float` `texture_3d`     | hardware linear sampler (`float32-filterable`) |
| `r16floatLinear` | `r16float` `texture_3d`     | hardware linear sampler (always filterable)    |

The workloads are an oblique slice of 1024² samples and a raymarch of 512² rays
× 256 steps with a maximum-intensity projection (67M samples). Each is a compute
dispatch timed 20 times, wall clock around submit plus `onSubmittedWorkDone`,
reporting the median. Accuracy is the maximum absolute difference from
`storage`, which matches the CPU `sampleVolume` to 1e-5.

## Results

| Variant          | Upload (ms) | Slice (ms) | Raymarch (ms) | Max error vs storage | Memory |
| ---------------- | ----------- | ---------- | ------------- | -------------------- | ------ |
| `storage`        | 48.2        | 0.6        | 4.8           | 0                    | 64 MiB |
| `textureLoad`    | 45.3        | 1.0        | 13.8          | 0                    | 64 MiB |
| `r32floatLinear` | 45.3        | 0.4        | 3.4           | 1.6e-4               | 64 MiB |
| `r16floatLinear` | 16.1        | 0.4        | 2.2           | 1.5e-3               | 32 MiB |

The values span about ±1.5. The slice times sit near the submit-overhead floor
(~0.2–0.5 ms), so only the raymarch separates the variants.

## Findings

1. **Manual trilinear over a texture is the worst option.** Eight `textureLoad`s
   cost 2.9× more than eight storage loads in the raymarch and gain nothing.
2. **Hardware filtering is faster but breaks CPU/GPU parity.** WebGPU filtering
   quantises interpolation weights (8 fractional bits on this hardware). The
   `r32float` sampler differs from exact trilinear by 1.6e-4 here. That is 16×
   the 1e-5 tolerance that `volumeSample` and slices promise against
   `@molgpu/table`'s `sampleVolume`.
3. **`r32float` filtering is optional.** It needs the `float32-filterable`
   feature. Apple Metal has it, but core WebGPU does not guarantee it, so
   `r16float` is the only format guaranteed to filter.
4. **`r16float` is the fast path for rendering, not for measurement.** It halves
   memory and upload time and is 2.2× faster in the raymarch. Its 1.5e-3 error
   (half precision plus weight quantisation) is invisible in a rendered image
   but wrong for any value a user reads back or colours by exactly.
5. **At first-gate sizes the storage buffer is fast enough.** A full 1024² slice
   costs about 0.6 ms, and 67M raymarch samples cost 4.8 ms.

## Recommendation

Keep the storage buffer as the one sampling path for Phase 11 (`<Volume>`,
`volumeSample`, `<VolumeSlice>`). It is exact against the CPU, needs no optional
feature, needs no new use.gpu texture provider, and is fast enough for slices.

Do not build a 3D-texture provider now. Revisit it with direct volume rendering
(u71.13), where the 2.2× raymarch speed-up of `r16float` matters and small
errors are invisible. If u71.13 adopts it, it should be an opt-in render path
beside the storage buffer, with its own documented tolerance. It should never
replace the storage buffer that `volumeSample` and slices read.
