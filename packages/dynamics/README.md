# @molgpu/dynamics

Pure coordinate mathematics for molecular scenes. Functions accept packed xyz
typed arrays and return new arrays or mathematical results. GPU operations are
published as WGSL source strings with plain buffer contracts; `@molgpu/viewer`
owns the WebGPU resources and live coordinate providers. This package imports no
renderer, WebGPU, or `@use-gpu/*` modules.

Time-dependent functions take explicit time arguments, so evaluating the same
input again while scrubbing gives the same output. CPU functions can run in a
worker; the package does not manage a worker or a simulation clock.

The Phase 13 contract is in
[the dynamics plan](../../docs/findings/2026-09-26-dynamics-plan.md).

## Install

```sh
deno add jsr:@molgpu/dynamics
```

## API

| Export                   | Stability    | Purpose                                                                                  |
| ------------------------ | ------------ | ---------------------------------------------------------------------------------------- |
| `AffineMatrix`           | experimental | Column-major 4×4 affine matrix shape.                                                    |
| `validateAffine`         | experimental | Reject malformed, non-finite or perspective matrices.                                    |
| `isIdentityAffine`       | experimental | Detect an exact identity affine.                                                         |
| `applyAffine`            | experimental | Pure CPU transform over packed xyz positions, optionally restricted to sorted atom rows. |
| `affineWgsl`             | experimental | WGSL source for a transform over all rows.                                               |
| `affineSelectedWgsl`     | experimental | WGSL source for a transform over a bitset-selected subset.                               |
| `createCellList`         | experimental | CPU counting-sort cell grid with bounded exact neighbour queries.                        |
| `CellList`               | experimental | Grid arrays and bounded query methods.                                                   |
| `CellListOptions`        | experimental | Selection and allocation limits for a cell grid.                                         |
| `cellListWgsl`           | experimental | WGSL stages for bounds, count, scan, scatter and exact pair queries.                     |
| `planCellList`           | experimental | Validate generation-tagged bounds and device limits before GPU allocation.               |
| `CellListPlan`           | experimental | Grid dimensions and buffer budget returned by `planCellList`.                            |
| `CellListBoundsReadback` | experimental | Compact 32-byte GPU bounds result tagged with source generation.                         |
| `fitKabsch`              | experimental | CPU proper rigid fit over corresponding atom rows.                                       |
| `KabschFit`              | experimental | Column-major rigid transform, fitted RMSD, and row count.                                |
| `minimumImage`           | experimental | Exact nearest Cartesian lattice displacement for a periodic box.                         |
| `createUnwrapForest`     | experimental | Deterministic covalent spanning forest from typed bonds.                                 |
| `unwrapFrame`            | experimental | Make each component whole for one frame and optionally center it.                        |
| `PbcSearchLimitError`    | experimental | Named error for an excessive exact-image search.                                         |
| `UnwrapForest`           | experimental | Parent traversal, components and ring edges for one topology.                            |
| `UnwrapResult`           | experimental | Per-frame positions and ambiguity or box status.                                         |

The CPU function returns a new array. Unselected rows retain their exact input
values. The viewer compiles the WGSL strings and owns every GPU resource.

## Cell grid buffer contract

`createCellList(positions, cellSize, options)` uses packed xyz coordinates and
topology row numbers. `rows`, when supplied, must be sorted and unique. Queries
accept a cutoff no greater than `cellSize`, inspect at most `maxCandidates`
(4096 by default), and fail explicitly if that bound is exceeded. The dense grid
defaults to at most four cells per indexed row. The CPU reference and GPU stages
use a cell width of `cellSize * (1 + 1e-6)` to keep floating-point boundary
pairs in adjacent cells.

`cellListWgsl` exposes separate `bounds`, `mergeBounds`, `count`, `scanCounts`,
`scanValues`, `addOffsets`, `scatter`, and `pairs` entry-point strings. The
caller owns and clears buffers, checks the compact bounds summary for invalid
coordinates, tags that summary with its source generation, and calls
`planCellList` before allocating the grid. A stale readback returns `null`;
invalid coordinates, excessive cells, and device storage limits throw. `count`,
`scatter`, and `pairs` share a 64-byte uniform:
`config = (selectedCount, hasRowMap, maxCandidates, maxPairs)`,
`dims = (nx, ny, nz, cellCount)`, `origin.xyz`, and
`scales = (1/cellWidth, cutoff², 0, 0)`. Pair output uses unordered topology
rows; atomic scatter makes result order unspecified. An overflow flag signals
candidate or pair capacity exhaustion.

At one million rows, each atom-side `u32` array uses 4 MB and packed coordinates
use 12 MB. A grid of at most four million cells uses at most 32 MB for counts
and offsets, plus scan scratch and result buffers. `planCellList` reports
persistent and scratch bytes separately and a lower bound for coordinate reads
(2 passes × 12 bytes per row). The caller reads only compact grid metadata back
to the CPU, rather than whole coordinate frames.

For a one-cell-per-row chain, the planner reports the following decimal MB (1 MB
= 1,000,000 bytes), excluding the existing coordinate buffer and optional pair
output:

|      Rows | Grid cells | Persistent | Scratch | Bounds + count coordinate reads |
| --------: | ---------: | ---------: | ------: | ------------------------------: |
|   100,000 |     99,999 |    1.60 MB | 0.45 MB |                         2.40 MB |
| 1,000,000 |    999,999 |   16.00 MB | 4.52 MB |                        24.00 MB |

These are buffer accounting results, not GPU timing measurements. Later stages
also read and write grid indexes and pair output according to occupancy.

## Kabsch reference

`fitKabsch(source, reference, rows?, translate?)` fits corresponding topology
rows in double precision and returns a proper rotation (determinant +1). It
rejects collinear or nearly collinear fit points, including degenerate input
with fewer than three rows. The returned matrix applies to **all** output rows;
`rows` selects only the fit. The default also aligns centroids. This CPU result
is the oracle for the planned live `<Superpose>` GPU provider.

## Periodic reference

`minimumImage(delta, box)` searches the exact nearest Cartesian image in a
column-major 3×3 periodic box. It rejects near-singular boxes and uses a bounded
candidate search. `createUnwrapForest(topology)` uses only bonds explicitly
marked covalent, filtering different models and incompatible alternate
locations. Build this forest once per topology version. `unwrapFrame` traverses
it for each displayed frame, makes each molecule whole, checks non-tree ring
edges for closure, and can move each selected component's centroid into the
primary box. Missing or invalid boxes pass positions through with an explicit
status. This CPU path is the reference for the planned live unwrap provider.
