# use.gpu 0.20.0: DualContourLayer emits invalid or unlinked WGSL

## Summary

`DualContourLayer` cannot create a render pipeline in `@use-gpu/*` 0.20.0.
Two independent defects reproduce with an analytic sphere field, so neither is
caused by molecular data or the host application.

1. `instance/vertex/dual-contour` calls `transformPosition(position)` with one
   argument, but the linked function expects two. Chrome reports: `too few
   arguments in call to '_07_transformPosition', expected 2, got 1`.
2. The contour-fit module leaves `getNormalData` unlinked. Chrome reports
   `Link 'getNormalData' in contour/fit-linear is not linked`; the quadratic
   path fails equivalently.

Both shaded and solid paths fail at shader/pipeline creation.

## Minimal reproduction

Pinned environment: `@use-gpu/{core,live,shader,webgpu,wgsl,workbench}` 0.20.0,
Chrome 150 on macOS arm64 with WebGPU enabled.

```sh
cd spikes/s3-molecular-surface
npx vite .
# Open http://localhost:5183/min.html in a fresh tab.
```

[`min.mjs`](../../spikes/s3-molecular-surface/min.mjs) creates a 48³ analytic
sphere SDF and feeds it directly to `DualContourLayer`. `?method=quadratic`
reproduces the unlinked-normal error in the alternate path. `?layer=point` is
the control: it renders in the identical WebGPU, canvas, camera, and pass
harness. Passing `?xf=null` (an explicit null transform) does not avoid the
arity mismatch.

## Expected / actual

Expected: the sphere isosurfaces at level zero.

Actual: WGSL validation/linking fails before draw submission, leaving no
surface. The independent CPU fallback is available at `?layer=mesh`; it uses
MolGPU's pure marching-cubes output with `FaceLayer`, not DualContourLayer.

## Impact

This blocks DualContourLayer for molecular and general volume isosurfaces on
0.20.0. MolGPU retains its CPU marching-cubes fallback until a versioned
upstream fix passes both analytic-sphere and molecular-field browser checks.
