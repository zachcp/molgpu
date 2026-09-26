# S3 finding — lift Mol*'s molecular-surface, feed DualContourLayer

Bead: `molgpu-sept-cqm.3`. The exploratory implementation has been retired.
Versions: `molstar 5.11.0`, `@use-gpu/* 0.20.0`, vite 8.3.0, macOS arm64,
Chrome/WebGPU.

## Verdict: split result

- **The reuse bet — the thing S3 was actually gating — PASSES.** Mol*'s
  `molecular-surface` kernel lifts cleanly and produces correct scalar fields.
- **`DualContourLayer` FAILS, from a reproducible upstream bug in
  @use-gpu/workbench 0.20.0, not from our usage.**

These are separable, which matters for Gate 0: the risk S3 existed to test (is
Mol*'s geometry work reusable?) came back yes. The consumption path has a
narrow, well-characterized upstream defect. **This does not stop the project; it
changes the surface-rendering plan.**

## Part 1 — the lift works

`calcMolecularSurface` needs only plain inputs plus one `OrderedSet` for
indices, and returns a `Tensor` we unwrap to a typed array. Nothing Mol*-shaped
escapes the wrapper, which is the shape `@molgpu/geo` should take.

Two corrections to the earlier feasibility doc:

- `RuntimeContext` **is** imported, but as a **type only**, so it is erased at
  runtime — which is why the earlier `^import` grep of the `.js` missed it. The
  function only ever touches `ctx.shouldUpdate` and `ctx.update`, so
  `{ shouldUpdate: false, update: async () => {} }` satisfies it. No `mol-task`
  at runtime.
- The `Tensor` shape is `{ space, data }` — `field.data` for the array,
  `field.space.dimensions` for dims. Not `field.space.data`.

It runs in **plain Node**, no browser and no WebGPU, confirming the kernel is
renderer-free (relevant to the headless constraint).

### Timings (CPU, single-threaded)

| structure | atoms | res 1.0Å | 0.75  | 0.5   | 0.35   | 0.25   |
| --------- | ----- | -------- | ----- | ----- | ------ | ------ |
| 1crn      | 327   | 40ms     | 56ms  | 71ms  | 207ms  | 370ms  |
| 1tqn      | 3999  | 528ms    | 602ms | 859ms | 2266ms | 3393ms |

Grid at 1tqn/0.25Å is 202×313×263 = 16.6M cells = 63MB of f32. Read this as:
**0.5Å is the practical interactive ceiling** (~0.9s, 8MB for a 4k-atom
protein); 0.25Å is a render-quality setting, not an interactive one. A protein
several times larger will need either downsampling, chunking, or moving the
density step to the GPU.

### Isovalue and the sentinel

Mol* uses `isoLevel: props.probeRadius` (1.4 by default) — confirmed in
`mol-repr/structure/visual/molecular-surface-mesh.js`. So the isolevel is the
probe radius, not zero.

The kernel fills cells far from any atom with **-1001.0, a sentinel rather than
a distance** (`molecular-surface.js:301`). Harmless for marching cubes, which
only interpolates across the isolevel crossing, but **dual contouring estimates
normals from the gradient**, so the cliff between visited and unvisited cells
can produce artifacts. The spike clamps to `level - 2` (`?clamp=0` to compare).
Any isosurfacer we write must handle this.

## Part 2 — DualContourLayer is broken in 0.20.0

Two independent defects, both reproduced with a **trivial analytic sphere SDF**
— no molstar, no material, no lights, `samples: 1`:

1. **WGSL arity mismatch (fatal).** `vertex/dual-contour` emits
   `transformPosition(position)` with one argument, but the linked
   `transformPosition` expects two:
   `too few arguments in call to '_07_transformPosition', expected 2, got 1`.
   The vertex module fails to compile, so the pipeline is invalid. Hits **both**
   the `ShadedRender` and `SolidRender` paths.
2. **Unlinked compute binding.**
   `Link 'getNormalData' in contour/fit-linear is not linked` — and the same in
   `contour/fit-quadratic`, so it is not method-specific.

### Why this is upstream and not us

- **Control:** a `PointLayer` of 2000 points in the _identical_ harness
  (`min.html?layer=point`) renders correctly. WebGPU, `OrbitCamera`, `Pass`, and
  `RawData` → `ShaderSource` binding all work. Screenshot verified.
- Fails on a trivial analytic field, so it is not our data.
- Fails with `method=linear` and `method=quadratic`.
- **No user-side workaround.** Passing an explicit null `transform`
  (`min.html?xf=null`) to try the `@optional` fallback does not help; the 2-arg
  `transformPosition` stays linked. Defect 1 is in shipped WGSL, unreachable
  from props.

Incidental benefit: the control independently de-risks part of S1 and S2 — the
`RawData` → `ShaderSource` → layer path works.

## Recommended path for surfaces

__Near term: port Mol_'s marching cubes and feed `FaceLayer` as a mesh._*
`mol-geo/util/marching-cubes/algorithm.js` has **no `mol-model` dependency**
(one real `mol-task` import for its scheduler). It is the same "port kernels,
never reinvent" bet that just paid off in Part 1, and it is the exact path Mol*
itself uses, so it is known-good. Cost: isosurfacing on CPU, so changing the
isolevel regenerates geometry — acceptable, since INVARIANT 4 only requires that
_style_ changes not regenerate geometry, and isolevel is a geometry param.

**In parallel: report/fix upstream.** Both defects are narrow and we now have a
minimal repro. We pin exact use.gpu versions and are already prepared to
vendor-patch (INVARIANT 2), so a local patch is viable ahead of any upstream
release.

**Not recommended yet:** writing our own dual-contouring compute shader. It is
the most work and buys little over marching cubes until GPU isosurfacing is
actually a bottleneck.

## Consequences for the plan

- Gate 0's "if S3 fails, stop" is **not** triggered — the geometry-reuse premise
  held. Record the distinction so it is not misread later.
- `DualContourLayer` should be treated as unavailable on 0.20.0. Anything in the
  design that assumed it (gaussian surfaces, volume isosurfaces) routes through
  ported marching cubes for now.
- Risk R3 (use.gpu is pre-1.0, churn is real) is now **evidenced, not
  hypothetical**. A shipped layer is simply broken. The containment invariant
  (use.gpu only inside `@molgpu/viewer`) is load-bearing; keep it.
- `mol-task` is a runtime dependency of the marching-cubes port, so
  `@molgpu/geo`'s "no Mol* at runtime" goal needs softening to "no `mol-model`"
  — or call the inner builder directly and skip `Task`.

## Reproducing

The reproduction application was retired after its conclusions were captured in
the package tests and this finding.
