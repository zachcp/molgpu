# GPU solvent-excluded-surface field

Date: 2026-10-02. Baseline: `283faea`. Bead: `molgpu-sept-mqo.1` (first slice of
`molgpu-sept-mqo`). Suite: `deno task test:viewer:ses`
(`packages/viewer/test/run-ses-field.mjs`). Apple silicon, Chrome WebGPU.

## What was built

`packages/viewer/src/internal/ses-field.ts` ports Mol* 5.11's
`calcMolecularSurface` to WGSL. It reads packed GPU coordinates and a row
selection, and returns the f32 field in the x-fastest layout that
`@molgpu/geo`'s `marchingCubes` reads. The only data read back is a 32-byte
bounds summary, which sizes the grid, and the torus-probe count.

- **Grid:** the box, padding, `ceil` dimensions and sample coordinates use
  Mol*'s own f64 arithmetic (`sesGrid`), so the GPU and CPU grids are identical.
- **Cell list:** the existing `cellListWgsl` bounds, count, scan and scatter
  stages from `@molgpu/dynamics/wgsl`. Cells are one search radius (van der
  Waals radius plus probe radius) wide.
- **Points:** one workgroup per atom, iterating the atom's sample box in Mol*'s
  order. The atom's neighbour list (up to 512 entries) is gathered once into
  workgroup memory, and the "is this projection hidden" test runs over that
  list. Like Mol*'s `lastClip`, it tries the previous hit first. Values merge by
  `atomicMin` on positive f32 bits. A sample that already holds an equal or
  lower value skips the hidden test.
- **Probes and torii:** the same per-atom neighbour list yields each overlapping
  pair once, from the pair's lower row, and its `probePositions` circle points.
  Unhidden points are appended to a probe list, which grows and reruns on
  overflow. One workgroup per probe then lowers the visited samples in Mol*'s
  index box around that probe.

Mol*'s two passes only take minima, so the atomic, any-order GPU updates give
Mol*'s sequential result.

Mol*'s "extended" mode applies when the probe radius is less than two resolution
steps. Its update depends on order, so the port does not reproduce it:
`gpuSesField` throws a `RangeError` and the caller keeps the CPU field. A
neighbour list that overflows also throws a `RangeError`, so callers can fall
back to the CPU in the same way.

Raw WebGPU compute, like `<EField>` and GPU DSSP: the stages need workgroup
memory, workgroup barriers and storage atomics. The pinned use.gpu compute
helpers expose none of these.

## Agreement with Mol*

The CPU field is computed by `@molgpu/io`'s `molecularSurfaceField` on the same
gathered atoms. In the table below:

- **Visited Δ** counts samples where the GPU and CPU disagree on which samples
  are visited.
- **Values > 1e-3** counts visited samples whose GPU and CPU values differ by
  more than 1e-3.
- **Mesh Δ** is the vertex-count difference between `marchingCubes` meshes
  extracted from the two fields.

| Protein |  Atoms |   Samples | Probes | Visited Δ | Values > 1e-3 | CPU vertices | Mesh Δ | CPU field | GPU field |
| ------- | -----: | --------: | -----: | --------: | ------------: | -----------: | -----: | --------: | --------: |
| 1crn    |    327 |   217,088 |  3,241 |         0 |             0 |       54,664 |      0 |     58 ms |    9.4 ms |
| 1ejg    |    641 |   232,960 |  5,238 |         0 |             0 |       55,512 |      0 |    119 ms |   10.6 ms |
| 1tqn    |  3,999 | 2,143,428 | 29,587 |         0 |             0 |      498,328 |      0 |    669 ms |   27.9 ms |
| 1a4y    |  8,939 | 4,733,040 | 65,756 |         0 |             0 |    1,108,504 |      0 |  1,517 ms |   59.6 ms |
| 4c7r    | 12,208 | 8,683,906 | 89,836 |         0 |            11 |    1,543,456 |     −8 |  2,107 ms |   81.6 ms |

**Precision.** The largest difference elsewhere is under 6e-6 Å, which is f32
rounding. On 4c7r, 11 of 8.7 million samples differ: an f32 "is this point
hidden" test sits on a sphere boundary and flips, which removes or adds one
probe contribution. The suite bounds these flips: at most 1e-4 of samples may
change visited state, at most 1e-3 may differ in value, and mesh vertex count
and area must match within 1e-3.

**Timing.** Field time includes both readbacks. It is the second call; the first
builds the pipelines. The GPU field is 7–26× faster than the CPU field.

## Path to the first per-atom version

1. **Pair search:** the first port searched ±1 cell for atom pairs. Overlapping
   spheres can be up to two search radii apart, so torus probes were missing
   (1.3% of 1crn samples differed). A brute-force f64 reference at a differing
   sample located the missing pair. Pairs now search ±2 cells.
2. **Speed:** a per-sample gather was correct, but its points pass took 47 of 69
   ms on 1tqn. The per-atom version above, with workgroup-memory neighbours,
   brought 1tqn from 69 ms to 28 ms.

## GPU marching cubes (`molgpu-sept-mqo.2`)

`packages/viewer/src/internal/marching-cubes-gpu.ts` reproduces `@molgpu/geo`'s
`marchingCubes` on the GPU. It uses the same tables, which `@molgpu/geo` now
exports packed as `marchingCubesTables()`.

- **Counts and offsets:** a classify pass counts each cube's vertices and
  indices, and two exclusive scans place every cube's output. The scans use the
  new fold-safe `internal/gpu-scan.ts`, which the SES cell list also uses now.
- **Readback:** only the two totals (8 bytes) are read back, to size the output.
- **Emit:** a final pass writes the positions, normals and indices. Order,
  winding and normals (clamped central differences mapped through the inverse
  transpose) follow the CPU builder exactly.

Each mesh below is extracted from the GPU field above, and the CPU mesh is
`marchingCubes` of the same samples read back:

| Protein |  Vertices | Index mismatches | Max position Δ | Min normal cos | GPU field + mesh | CPU mesh |
| ------- | --------: | ---------------: | -------------: | -------------: | ---------------: | -------: |
| 1crn    |    54,664 |                0 |         3.8e-6 |     1 − 1.0e-7 |     9.1 + 2.6 ms |    19 ms |
| 1ejg    |    55,512 |                0 |         9.5e-6 |     1 − 1.0e-7 |     9.0 + 2.2 ms |    14 ms |
| 1tqn    |   498,328 |                0 |         1.1e-5 |     1 − 1.0e-7 |    27.1 + 7.5 ms |   129 ms |
| 1a4y    | 1,108,504 |                0 |         7.6e-6 |     1 − 1.0e-7 |   59.8 + 14.9 ms |   273 ms |
| 4c7r    | 1,543,448 |                0 |         6.1e-5 |     1 − 1.0e-7 |   82.3 + 24.1 ms |   403 ms |

The counts and offsets cost 16 bytes per cube while the mesh is built. For 4c7r
that is 137 MiB of transient memory, released before the call returns. If that
becomes a limit, packing both counts into one array, or running a sparse pass
that touches only cut cubes, would halve it or better.

## GPU attribution (`molgpu-sept-mqo.3`)

`packages/viewer/src/internal/attribution-gpu.ts` finds each vertex's nearest
selected atom row on the GPU. It reuses the coordinates and atom cell list the
field froze; `gpuSesField(..., { retainCells: true })` hands those to the
caller.

It keeps the CPU's exactness argument:

- **Window search:** the 5³ cell window around the vertex is searched first.
- **Certification:** a hit within two cell widths is certified. Clamping the
  cell of a vertex outside the atom bounds keeps the certificate valid.
- **Fallback:** an uncertified vertex scans every selected atom.
- **Ties:** equal distances resolve to the lower row.

The CPU reference is `nearestAtomAttribution` of the same GPU vertices, with the
cell size `<Surface>` passes it:

| Protein |  Vertices | Different atom | GPU field + mesh + attribution | CPU attribution |
| ------- | --------: | -------------: | -----------------------------: | --------------: |
| 1crn    |    54,664 |              0 |                          14 ms |           40 ms |
| 1ejg    |    55,512 |              0 |                          13 ms |           52 ms |
| 1tqn    |   498,328 |              0 |                          42 ms |          494 ms |
| 1a4y    | 1,108,504 |              0 |                          90 ms |        1,054 ms |
| 4c7r    | 1,543,448 |              0 |                         126 ms |        1,496 ms |

The CPU path rebuilds 1tqn in 1.15 s. The GPU path does the whole rebuild,
including the three small readbacks, in 42 ms. That meets the bead's 100 ms
target before any drawing work.

## Live-coordinate `<Surface>` (`molgpu-sept-mqo.4`)

`<Surface>` decides per render which build to use:

- **Root coordinates** (static) build the mesh once on the CPU, as before.
- **Live coordinates** — a coordinate provider or a trajectory below the
  structure — call `gpuSurfaceGeometry` (`internal/surface-gpu.ts`) from
  `internal/use-gpu-surface.ts`.

How the live build behaves:

- **Scheduling:** one build is in flight at a time. The newest generation is
  queued behind it, and intermediate generations are skipped. A changed source
  buffer or geometry parameter aborts the running build.
- **Display:** the last finished mesh stays drawn meanwhile.
- **Buffers:** the mesh is drawn straight from GPU buffers. No coordinate
  snapshot is subscribed and no CPU geometry is uploaded. Each published mesh is
  owned by the hook and destroyed when a newer one replaces it or the surface
  unmounts. A discarded result is destroyed at once.
- **CPU fallback:** a probe radius below two resolution steps, or an atom whose
  neighbour list overflows, falls back to the CPU build from 4 Hz snapshots.
- **Grid budget:** the budget error still surfaces through `error`.

`run-surface.mjs` drives `<Transform>` coordinates and checks that:

- a shift moves the GPU surface;
- a burst of 12 generations builds at most once per generation, without WebGPU
  errors;
- no CPU geometry is uploaded under live coordinates;
- a colour edit rebuilds nothing;
- unmounting is clean.

The invalidation, retirement, components, efield, trajectory and tube suites
also pass.

`surface-bench.ts` now reports both paths. In Chrome the GPU build of 1tqn takes
42 ms (table above). Deno's own WebGPU (wgpu) has a much higher fixed cost per
readback and submit:

| Protein | CPU total | GPU total (Deno wgpu) |
| ------- | --------: | --------------------: |
| 1crn    |     99 ms |                101 ms |
| 1ejg    |    148 ms |                111 ms |
| 1tqn    |  1,150 ms |                144 ms |
| 1a4y    |  2,572 ms |                193 ms |
| 4c7r    |  3,630 ms |                241 ms |

## Next

`molgpu-sept-mqo.3` ports attribution. `molgpu-sept-mqo.4` wires the
live-coordinate `<Surface>` path. The 1tqn field leaves about 70 ms of the 100
ms budget for meshing, attribution and the draw.
