# VolumeData, formats, and GPU storage

Decision record for Phase 11's independently shippable first gate. It covers
static scalar volumes, CCP4/MRC input, CPU isosurfaces, `VolumeSlice`, and
static `volumeSample`. It explicitly excludes direct raymarching, GPU marching
cubes, DX/Cube and DensityServer input, and sampling from Phase 9 live
coordinates.

## 1. Data model

`@molgpu/table` owns a renderer-free immutable `VolumeData`:

```ts
type VolumeData = {
  readonly values: Float32Array;
  readonly dims: readonly [number, number, number];
  readonly transform: Float32Array; // 4×4 column-major index → Å affine
  readonly stats: {
    readonly min: number;
    readonly max: number;
    readonly mean: number;
    readonly sigma: number;
  };
  readonly components: 1 | 3;
  readonly unit?: string;
};
```

Samples are x-fastest: `i + nx * (j + ny * k)`, with interleaved components when
`components === 3`. `createVolume` and `validateVolume` reject non-positive
dimensions, inconsistent lengths, non-finite values/affines/statistics, and
unknown components. Scalar consumers require `components: 1`; a later vector
consumer must name an extraction operation rather than silently take a channel.
The complete affine, including shear/rotation, is authoritative for CPU mesh
vertices and CPU/WGSL sampling.

`SurfaceField` migrates compatibly: `VolumeData` is its base data and the
surface-specific `level`, `maxRadius`, and `resolution` are retained in a
surface metadata wrapper. Existing public imports stay valid during the
migration. The surface's previous origin/diagonal spacing path is replaced by
the complete affine, with regression coverage for a non-orthogonal grid.

## 2. Formats and error boundary

The first reader is CCP4/MRC, behind `@molgpu/io`'s Mol* dynamic-import wall. It
returns `VolumeData`, handles axis order, `nstart`, origin, and the
index-to-world affine, and exposes stable reader error codes in the style of
`BcifErrorCode`. Tests compare one EM and one crystallographic fixture with
Mol*'s parsed grid. DX and Cube are deferred follow-ons; DensityServer BCIF is
later still. No renderer, field, or table package imports Mol* or use.gpu.

## 3. GPU representation and sampling

The initial `<Volume>` uploads a storage buffer once for a volume identity.
`sampleVolume(p_world)` applies the inverse affine, returns an explicit outside
value of zero, and performs clamped trilinear interpolation at the boundary. CPU
and WGSL agree within `max(1e-5, 1e-5 * max(abs(expected), abs(actual)))` at
interior, boundary, and outside points. The source is kept static for this gate
and is released with the context resource.

`RawTexture` in use.gpu 0.20.0 is 2D-only although core can bind `texture_3d`.
The separate spike decides whether a custom 3D texture provider earns its API
and complexity; it does not block the storage-buffer implementation choice.

## 4. Component placement and geometry

`<Volume>` is standalone and parallel to `<Structure>`. It has no assembly or
topology dependency. A representation can consume both contexts only through an
explicit prop/reference; a structure does not implicitly own a volume.
`<Isosurface level>` uses CPU `geo.marchingCubes` initially and transforms every
vertex through the full affine. A level is either absolute or explicitly
sigma-relative (`mean + sigma * level`); zero/near-zero sigma uses an absolute
fallback and tests declare it. Colour, opacity, and material remain props and
must not remesh. `<VolumeSlice>` changes plane uniforms/sampling only.

## 5. Budget and oversize policy

A 256³ scalar f32 volume is 67,108,864 bytes (64 MiB) before the GPU upload,
mesh output, or temporary CPU work. The first gate permits at most one CPU
values array and one GPU storage copy (128 MiB payload total); isosurface
generation must account for its own bounded output separately. `createVolume`
has a default hard ceiling of 256³ scalar samples (or the same byte budget for
multi-component data) and fails with a documented oversize error instead of
implicitly downsampling. A caller may explicitly request a named downsample
policy in a later API; no silent resampling is allowed. At 100k/1M atoms, volume
memory is independent of atom count; field/mesh consumers must report their own
buffers rather than hiding them in the volume budget.

## 6. Testable first-gate outcomes

The build sequence validates data and affine mapping, parses MRC, uploads and
samples it, then uses it in isosurfaces, fields, and slices. Tests use a small
sheared affine fixture, verify upload/disposal counters, compare CPU/WGSL
sampling, and prove style changes do not remesh or reupload. The gate runs the
normal test/typecheck/component suites with real WebGPU assertions for the
GPU-facing paths.

## 7. Counter-review (u71.2)

Adversarial pass over sections 1–6 against the current code (2026-09-26). Each
finding carries a verdict; accepted ones amend the build beads named.

1. **`SurfaceField` lives in `@molgpu/io`, not `@molgpu/table`.** The plan reads
   as if table owned the migration. _Accepted:_ table owns `VolumeData`,
   `createVolume`, `validateVolume` and a CPU `sampleVolume`; io's
   `SurfaceField` becomes `VolumeData & { resolution, maxRadius, level }`. Every
   existing field keeps its name and meaning, so the change is additive (u71.4).
2. **The 256³ default ceiling would break large surfaces.** `<Surface>` already
   allows 256 MiB grids through `assertGridBudget`/`maxBytes`; a 64 MiB default
   inside `createVolume` would reject grids `<Surface>` accepts today.
   _Accepted:_ `createVolume` takes `maxSamples` (default 256³); the surface
   path passes the budget it already enforced (u71.4).
3. **Surface stats include the -1001 sentinel.** The mean and sigma of an SES
   grid say nothing useful. _Accepted as documented:_ stats are plain statistics
   of every stored value; `SurfaceField.level` stays absolute, and sigma levels
   are meant for density maps (u71.4, u71.7).
4. **Header statistics are not trustworthy.** Mol* trusts `AMIN/AMAX/AMEAN`, and
   when `ARMS` is zero its fallback is RMS about zero, not a standard deviation.
   _Accepted:_ `createVolume` always computes min/max/mean/population sigma from
   the values, so `level: { sigma }` means the same thing for every source. The
   oracle test compares grids and affines, not header stats (u71.5).
5. __A Mol_ oracle alone is circular._* If the reader delegates to Mol*,
   comparing with Mol* only proves the lowering. There are no map fixtures in
   the repo. _Accepted:_ tests write synthetic CCP4/MRC bytes in-test: an
   EM-style orthogonal map with an `ORIGIN` record, and a crystallographic map
   with non-90° angles, nonzero `NCSTART…`, and permuted `MAPC/MAPR/MAPS`. Each
   encodes a known analytic function of world position. The test checks that our
   affine maps index → world where the function's value matches (an independent
   oracle) and that it agrees with `Grid.getGridToCartesianTransform` (the Mol*
   oracle) (u71.5).
6. **Full-affine isosurfaces need no geo API change.** `marchingCubes` accepts
   only origin and diagonal spacing. _Accepted, cheaper:_ extract in index space
   (origin 0, spacing 1), then map positions through the affine and normals
   through its inverse-transpose, renormalised. When the determinant is
   negative, flip triangle winding so front faces stay consistent. `<Surface>`
   switches to the same helper (u71.4 regression test, u71.7).
7. **"Near-zero sigma falls back to absolute" is an unneeded special case.**
   _Rejected as written:_ `level: { sigma: k }` always means
   `mean + k * stats.sigma`. A flat map gives `mean`, so no hidden branch is
   needed. The test covers the flat case (u71.7).
8. **One upload per identity must cover fields too.** `volumeSample` needs the
   values on the GPU. A second upload per field would double the 64 MiB.
   _Accepted:_ the viewer keeps a refcounted, identity-keyed volume buffer
   cache. `<Volume>`, `<Isosurface>`, `<VolumeSlice>` and field lowering all
   draw from it, and the last release destroys the buffer (u71.6, u71.8).
9. **The inverse affine and dims do not need uniforms.** The fields compiler has
   only scalar `f32` uniforms. A volume is immutable, so `compile()` bakes its
   inverse affine and dims into the WGSL as constants. The only GPU input is the
   values buffer (binding id `volume:<id>`). The atom position is a second
   buffer binding, `positions` (u71.8).
10. **Hidden coupling to Phase 9.** Lowering the `positions` binding to
    `useCoordinates().source` costs nothing and makes sampling follow a provider
    for free. _Accepted with scope held:_ this gate tests static coordinates
    only. u71.15 remains the bead that tests and documents the live behaviour.
11. **`<VolumeSlice>` cannot take a fields `colormap`.** Fields compile to
    per-row `getField(row)`; a slice colours per fragment, not per atom row.
    _Accepted:_ `<VolumeSlice>` takes `range` and `stops` in `colormap`'s
    `[t, color]` format and emits the same piecewise-linear mapping in its
    fragment shader. The plane is a uniform (u71.10).
12. **`rgba32float`/`r32float` 3D textures are not filterable in core WebGPU.**
    They need the optional `float32-filterable` feature. This makes the texture
    path conditional, not free. _Accepted:_ the spike measures it; the storage
    buffer stays the default (u71.3).
13. **Isosurface output is the unbounded cost.** geo's marching cubes builds JS
    `number[]` arrays; a dense 256³ map can emit millions of triangles.
    _Accepted as documented:_ `<Isosurface>` runs as a `useGeometryJob`, which
    cancels superseded levels, and counts `geometryBuilds:isosurface:mesh`. A
    GPU mesh (u71.11) is the scale-out path.
14. **Memory at 100k/1M atoms.** Volume memory does not depend on atom count.
    `volumeSample` adds no per-atom buffer: it reads the existing positions
    source. The budget is one CPU copy plus one GPU copy per volume identity.
    _No change._
