# Upstream feasibility findings — 2026-09-15

Verified directly against installed packages, not from documentation or memory.
Re-verify before relying on any of this after a version bump.

Versions probed: `@use-gpu/* 0.20.0` (published 2026-07-16), `molstar 5.11.0` (MIT).

## use.gpu: what actually ships

Confirmed present in `@use-gpu/workbench@0.20.0`:

- **Materials** — `basic-material`, `pbr-material`, `fresnel-material-effect`,
  `normal-material`, `shader-lit-material`, `shader-flat-material`.
  PBR is native; we get to name a shading model.
- **Lighting** — ambient, directional, point, spot, dome, environment.
- **Passes** — `picking-pass`, `oit-pass` (order-independent transparency),
  `ssao-pass`, `outline-pass`, shadow passes (ortho/omni/hemi/spot),
  `deferred-g-pass` + `deferred-resolve-pass`, `motion-pass`, `readback-pass`.
  This is roughly Mol*'s postprocessing feature set, already built.
  `oit-pass` matters specifically for transparent molecular surfaces.
- **Layers** — `point-layer`, `face-layer`, `line-layer`, `surface-layer`,
  `dual-contour-layer`, `label-layer`, `arrow-layer`, `arc-label-layer`.
  `dual-contour-layer` does GPU isosurface extraction from a scalar field,
  which is directly the gaussian-surface / volume path.
- **Data** — `instance-data`, `raw-data`, `struct-data`, `geometry-data`,
  `interleaved-data`, `composite-geometry-data`, `fetch`.

### Fields-as-bound-sources is real

`PointLayer` and `RawFaces` both accept `positions`, `colors`, `sizes`,
`normals`, `zBiases` as `ShaderSource` rather than CPU arrays. This is the
load-bearing premise for Pillar 3 (fields) and Pillar 5 (style changes must
not regenerate geometry). It holds.

### Instanced 3D geometry is supported

`RawFaces` takes `mesh: GPUGeometry` + `instances: ShaderSource` +
per-instance `colors`, and has a `fragDepth` flag. So both spacefill
strategies are open: real instanced sphere meshes, or impostor sprites with
fragment-depth writes. See spike S1.

### Correction: `Animate` is self-driving, not samplable

`Animate` owns an internal clock (`loop`, `mirror`, `repeat`, `speed`,
`paused`, `delay`, `duration`). There is no `sample(t)` entry point, and
`Clock` likewise emits its own advancing time. **A scrubbable global timeline
(Pillar 4) cannot be built by handing `Animate` a `t`.** It has to be built on
the exported interpolation machinery — `EaseTypes` (with `mat4`/`quat`/`angle`/
`number` implementations exposing `spline`/`auto`/`lerp`/`measure`) and
`automaticKeyframes` — driving values from an explicit `t` we own.

Keyframes are richer than expected, which helps: per-keyframe `ease`
(`cosine`/`linear`/`hold`/`bezier`), bezier control points, and spline `knots`.

### Module-load-time WebGPU globals

`@use-gpu/workbench/cjs/codec/pmrem.cjs` dereferences `GPUBufferUsage` at
module scope, so a bare `require` under plain Node throws. Any headless or
server-side rendering needs WebGPU globals installed *before* import. Relevant
to risk R4 and to screenshot testing.

## Mol*: where the extraction boundary falls

`molstar@5.11.0` is MIT with a flat, deep-importable `lib/` tree
(`molstar/lib/mol-math/...`). No export map restricting subpath imports.

The geometry math and the structure traversal separate cleanly:

| Module | Imports | Portable? |
|---|---|---|
| `mol-math/geometry/molecular-surface` | `mol-math`, `mol-data`, `mol-util` only | yes |
| `mol-repr/.../polymer/curve-segment` (ribbon/spline math) | `mol-math` only | yes |
| `mol-repr/.../polymer/trace-iterator` | `Unit`, `StructureElement`, `SecondaryStructureProvider`, `HelixOrientationProvider`, `Segmentation` | no |

**The geometry kernels are portable; the polymer traversal is not.** This is
the single most consequential fact for the plan: it means cartoon splits into
a cheap half (port `curve-segment` nearly verbatim) and an expensive half
(reimplement trace iteration, secondary-structure assignment and helix
orientation over our own table). See risk R1 and Phase 4.

`gaussian-density` pulls in `mol-task` and has split CPU/GPU backends — more
entangled than `molecular-surface`, so prefer feeding `DualContourLayer` from
our own density kernel over porting that one.

## Open questions, deferred to spikes

- Does `PointLayer`'s `shaded` flag produce true sphere impostors with correct
  depth, or only flat-shaded sprites? Decides the spacefill path. (S1)
- What is the real bundle cost of keeping `mol-io`/`mol-model` behind the
  import wall, and can it be made lazy/dynamic? (S4)
- Is `dual-contour-layer` fast enough on a protein-sized density grid, and what
  grid resolution does it need to look publication-grade? (S3)

---

## Amendments from S3 (2026-09-15)

Three items above are corrected by the S3 spike; see
`2026-09-15-s3-molecular-surface.md` for evidence.

- **`molecular-surface` imports.** It *does* import `RuntimeContext` from
  `mol-task`, but as a **type only**, so it is erased at runtime — which is why
  the `^import` grep of the `.js` missed it. A `{shouldUpdate, update}` stub
  satisfies it and there is no runtime `mol-task` dependency. The "portable"
  verdict stands.
- **`dual-contour-layer` is NOT usable on 0.20.0.** Two shipped defects (WGSL
  arity mismatch in the vertex module; unlinked `getNormalData` in both contour
  fit shaders) make it fail for any input. Remove it from the list of
  "confirmed present and usable" features — presence in the package is not
  usability. Surfaces route through ported marching cubes instead.
- **Open question "is dual-contour fast enough on a protein-sized grid" is
  moot** for now — it does not run at all.

Also worth recording: the `RawData` → `ShaderSource` → layer binding path is
now **empirically confirmed** (PointLayer control rendering 2000 points), not
just inferred from type signatures.
