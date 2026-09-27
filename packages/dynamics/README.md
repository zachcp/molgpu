# @molgpu/dynamics

Pure coordinate mathematics and CPU charge assignment for molecular scenes.
Coordinate functions accept packed xyz typed arrays and return new arrays or
mathematical results. GPU operations are published as WGSL source strings with
plain buffer contracts on `@molgpu/dynamics/wgsl`; `@molgpu/viewer` owns the
WebGPU resources and live coordinate providers. This package imports no
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

`@molgpu/dynamics` (`.`) holds the domain functions an application calls.
`@molgpu/dynamics/wgsl` holds the WGSL sources, buffer layouts and dispatch
planning that `@molgpu/viewer`'s GPU components use; it is _advanced_ and tied
to the viewer's buffer contracts. The CPU references that the GPU kernels are
tested against (`applyAffine`, `unwrapFrame`, `applyNormalMode`,
`coulombPotential`, `coulombField`, `createCellList`, …) are internal.

| Export                   | Stability    | Purpose                                                                                |
| ------------------------ | ------------ | -------------------------------------------------------------------------------------- |
| `CellListLimitError`     | experimental | Dense cell grid exceeds `maxCells`; carries `cells` and `limit`.                       |
| `fitKabsch`              | experimental | CPU proper rigid fit over corresponding atom rows.                                     |
| `KabschFit`              | experimental | Column-major rigid transform, fitted RMSD, and row count.                              |
| `minimumImage`           | experimental | Exact nearest Cartesian lattice displacement for a periodic box.                       |
| `periodicBox`            | experimental | Validate and invert a column-major 3×3 box, as the unwrap kernels take it.             |
| `PeriodicBox`            | experimental | Box vectors, row-major inverse and inverse norm.                                       |
| `PbcSearchLimitError`    | experimental | Named error for an excessive exact-image search.                                       |
| `NormalModeData`         | experimental | Precomputed guide-node displacements and atom mapping.                                 |
| `residueGuideMap`        | experimental | Map each atom to its residue's guide node (normally CA), altloc-aware.                 |
| `normalModeFromElastic`  | experimental | Wrap an ANM mode and atom map as `NormalModeData`.                                     |
| `buildElasticNetwork`    | experimental | Exact-cutoff guide contacts through `table.spatialGrid`.                               |
| `solveElasticModes`      | experimental | CPU GNM/ANM eigenmodes: dense Jacobi or sparse Lanczos, with residual checks.          |
| `ElasticSolveOptions`    | experimental | Solver choice (`auto`, `dense`, `lanczos`) and Lanczos basis cap.                      |
| `ElasticNetwork`         | experimental | Sparse contact pairs and ANM directions.                                               |
| `ElasticMode`            | experimental | Eigenvalue, vector, residual and GNM/ANM kind.                                         |
| `templateCharges`        | experimental | Assign AMBER/PDB2PQR residue-template and monatomic-ion charges.                       |
| `residueNetCharge`       | experimental | Sum a charge column over active atoms into residue rows.                               |
| `TemplateChargeOptions`  | experimental | Histidine and residue-specific template overrides.                                     |
| `TemplateChargeReport`   | experimental | Net charge, gaps, ions and unmatched names.                                            |
| `ChargeAssignment`       | experimental | Values, assigned mask and method report.                                               |
| `ChargeUnmatched`        | experimental | Aggregated unmatched atom name and sample residue keys.                                |
| `gasteigerCharges`       | experimental | Assign PEOE charges to complete non-polymer components.                                |
| `GasteigerOptions`       | experimental | Exclusion mask and iteration count.                                                    |
| `GasteigerReport`        | experimental | Assigned count and refused components.                                                 |
| `GasteigerRefusal`       | experimental | Component residue keys, refusal reason and detail.                                     |
| `GasteigerRefusalReason` | experimental | Named reason an unsupported component was not charged.                                 |
| `electrostatics`         | experimental | Validate dielectric options and derive κ, kT and the output scale.                     |
| `ElectrostaticsOptions`  | experimental | Model (`vacuum`, `distance`, `debye`), ε, ionic strength, temperature, clamp and unit. |
| `Electrostatics`         | experimental | Normalised physics shared by the CPU reference and the WGSL uniform.                   |
| `DielectricModel`        | experimental | `vacuum`, `distance` (ε = D·r) or `debye`.                                             |
| `PotentialUnit`          | experimental | `kT/e` or `kcal/mol/e`.                                                                |

### `./wgsl`

| Export                   | Stability | Purpose                                                                              |
| ------------------------ | --------- | ------------------------------------------------------------------------------------ |
| `AffineMatrix`           | advanced  | Column-major 4×4 affine matrix shape.                                                |
| `validateAffine`         | advanced  | Reject malformed, non-finite or perspective matrices.                                |
| `isIdentityAffine`       | advanced  | Detect an exact identity affine.                                                     |
| `affineWgsl`             | advanced  | WGSL source for a transform over all rows.                                           |
| `affineSelectedWgsl`     | advanced  | WGSL source for a transform over a bitset-selected subset.                           |
| `cellListWgsl`           | advanced  | WGSL stages for bounds, count, scan, scatter and exact pair queries.                 |
| `prepareDsspLayout`      | advanced  | Pack one model's active protein rows into chain-ordered GPU descriptors.             |
| `DsspLayout`             | advanced  | Descriptor, CA map and residue mapping for one model.                                |
| `dsspWgsl`               | advanced  | WGSL stages for GPU DSSP backbone, H-bonds, turns, helices, bends and bridges.       |
| `DsspBridge`             | advanced  | Compact bridge entry with canonical generation order.                                |
| `finishDssp`             | advanced  | Complete ladders and sheets from GPU flags and bridge readback.                      |
| `planCellList`           | advanced  | Validate generation-tagged bounds and device limits before GPU allocation.           |
| `CellListPlan`           | advanced  | Grid dimensions and buffer budget returned by `planCellList`.                        |
| `CellListBoundsReadback` | advanced  | Compact 32-byte GPU bounds result tagged with source generation.                     |
| `superposeWgsl`          | advanced  | WGSL for a live Kabsch fit: centroid, covariance and rotation solve, then apply.     |
| `SUPERPOSE_FIT_BYTES`    | advanced  | Size of the fit state buffer `superposeWgsl` reads and writes (144 bytes).           |
| `unwrapWgsl`             | advanced  | WGSL for the live unwrap: image links, pointer jumping, centering, placement, rings. |
| `UNWRAP_LINK_BYTES`      | advanced  | Bytes per row of each unwrap link buffer (16).                                       |
| `UNWRAP_PARAMS_BYTES`    | advanced  | Bytes of the unwrap uniform (128).                                                   |
| `createUnwrapForest`     | advanced  | Deterministic covalent spanning forest from typed bonds.                             |
| `UnwrapForest`           | advanced  | Parent traversal, components and ring edges for one topology.                        |
| `validateNormalMode`     | advanced  | Validate mode vectors, mapping and structural version.                               |
| `normalModeWgsl`         | advanced  | WGSL for additive guide-node displacement.                                           |
| `coulombWgsl`            | advanced  | WGSL for tiled direct Coulomb sums: `packAtoms`, `sumGrid` and `sumPoints`.          |
| `coulombParams`          | advanced  | Encode the 112-byte uniform for one `coulombWgsl` dispatch.                          |
| `CoulombDispatch`        | advanced  | One dispatch's sample range, atom range and grid.                                    |
| `COULOMB_PARAMS_BYTES`   | advanced  | Size of the `coulombWgsl` uniform (112 bytes).                                       |
| `COULOMB_WORKGROUP`      | advanced  | Invocations per workgroup and atoms per tile (64).                                   |
| `COULOMB_MODEL_CODE`     | advanced  | Model code in the uniform: vacuum 0, distance 1, debye 2.                            |

The internal `coulombPotential`/`coulombField` are the f64 oracle for
`coulombWgsl`, which the viewer's `<EField>` dispatches. The physics and budgets
are recorded in
[the electric-field plan](../../docs/findings/2026-09-27-efield-plan.md).

The CPU function returns a new array. Unselected rows retain their exact input
values. The viewer compiles the WGSL strings and owns every GPU resource.

## GPU DSSP

GPU DSSP uses `prepareDsspLayout(data, rows)` to pack one model's protein
residues in chain and sequence order. `dsspWgsl` supplies H placement, bounded
H-bond search over the CA cell list, turns, three ordered helix passes, bends,
and bridge emission. `finishDssp(layout, flags, bridges)` restores canonical
bridge order and completes sequential ladders and sheets on the CPU. The viewer
owns the WebGPU buffers and dispatches; no renderer object crosses into this
package.

## Cell grid buffer contract

The internal CPU reference `createCellList(positions, cellSize, options)` uses
packed xyz coordinates and topology row numbers. `rows`, when supplied, must be
sorted and unique. Queries accept a cutoff no greater than `cellSize`, inspect
at most `maxCandidates` (4096 by default), and fail explicitly if that bound is
exceeded. The dense grid defaults to at most four cells per indexed row. The CPU
reference and GPU stages use a cell width of `cellSize * (1 + 1e-6)` to keep
floating-point boundary pairs in adjacent cells.

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
`rows` selects only the fit. The default also aligns centroids; with `translate`
false the source rotates about its own centroid, which stays put. This CPU
result is the oracle for the live `<Superpose>` viewer provider.

`superposeWgsl` is that fit on the GPU, as three entry points run in order on
one upstream generation. `centroid` and `covariance` each run as one workgroup
of 128 lanes and sum in a fixed order, so a fit is deterministic. Coordinates
are taken relative to the first fit row, so a large common offset does not swamp
small shape differences in f32. `covariance` then solves Horn's quaternion with
4×4 Jacobi rotations on lane 0, and `apply` moves every row by
`R (p - c_source) + c_target`. A nearly collinear live frame writes no rotation
and passes through. The bindings, in order, are:

| Binding | Buffer                                                        |
| ------: | ------------------------------------------------------------- |
|       0 | upstream packed xyz `f32`                                     |
|       1 | fit rows `u32` (read only when `selected`)                    |
|       2 | reference packed xyz `f32` for the fit rows, in fit order     |
|       3 | 144-byte read-write fit state                                 |
|       4 | uniform `(fitCount, selected, translate, atomCount)` as `u32` |
|       5 | packed xyz `f32` output                                       |

`centroid` and `covariance` use bindings 0–4, and `apply` uses 0 and 3–5. In the
viewer tests the GPU RMSD matches `fitKabsch` within 1e-5 Å at a 1000 Å offset.

## Periodic reference

`minimumImage(delta, box)` searches the exact nearest Cartesian image in a
column-major 3×3 periodic box. It rejects near-singular boxes and uses a bounded
candidate search. `createUnwrapForest(topology)` uses only bonds explicitly
marked covalent, filtering different models and incompatible alternate
locations. Build this forest once per topology version. The internal CPU
reference `unwrapFrame` traverses it for each displayed frame, makes each
molecule whole, checks non-tree ring edges for closure, and can move each
selected component's centroid into the primary box. Missing or invalid boxes
pass positions through with an explicit status. This CPU path is the reference
for the live `<Unwrap>` viewer provider.

`unwrapWgsl` is that traversal on the GPU, in five entry points run in order on
one upstream generation:

1. `link` stores each row's exact nearest image from its forest parent. It uses
   the same bounded lattice search as `minimumImage`, capped at `maxCandidates`
   and counted in `status[1]` where the CPU throws.
2. For forests of depth at most 32, `propagate` visits one topology level per
   dispatch. Each non-root link is accumulated once, in place, from a parent
   already relative to its root. Deeper forests use `jump` pointer jumping in
   `ceil(log2(depth))` rounds. Both preserve cross-row bond continuity.
3. `centerSums` computes, per centered component, the lattice shift that moves
   its center rows' centroid into the primary cell.
4. `place` writes each row as its root position plus its displacement, minus
   that shift.
5. `rings` counts non-tree covalent edges that do not close within 1e-3 Å.

Displacements travel as f32 bits in `vec4<u32>` links, so no GPU flushes a
denormal pointer. The binding table and uniform layout are documented on
`unwrapWgsl`. Use `periodicBox(box)` to validate a box and get the inverse the
kernels take.

## Mode application

`NormalModeData` holds a precomputed xyz displacement for each guide node and an
atom-to-node mapping (`0xffffffff` means no displacement). Atoms in one residue
may share a CA guide node. The internal CPU reference `applyNormalMode` adds
`amplitude * sin(2*pi*frequency*time + phase) * vector` to each mapped upstream
row, so the same time always reproduces the same positions. The live
`<NormalMode>` viewer provider uses `normalModeWgsl` and uploads mode vectors
and mapping only when their structural version changes.

## Charge assignment

`templateCharges(data, options)` assigns AMBER/PDB2PQR charges to standard
proteins, DNA/RNA and water, plus conventional charges to monatomic ions. It
returns `Float32Array` values in topology order, a byte assigned mask, and a
report with active-atom net charge, unmatched atom names, missing template heavy
atoms, chain gaps and ion sources. Missing template hydrogens fold onto their
bonded heavy atoms; present hydrogens retain their own charge. Histidine
defaults to HIE unless HD1/HE2 identify a tautomer; callers can set
`options.his` or override a residue by `residueKey(data, row)` in
`options.residues`. Only the observed chain ends get terminal variants. A chain
break stays internal and appears in `report.gaps`.

`gasteigerCharges(data, { exclude })` applies twelve RDKit-style PEOE iterations
to connected non-polymer components. Pass the template mask as `exclude` when
combining both methods; it computes that mask itself if omitted. It requires
known bond orders and refuses polymer-linked groups, modified polymer residues,
unsupported valence and missing element parameters. Kekulé orders from
`chem_comp_bond` are used as given, with the aromatic flag marking conjugation;
order-4 aromatic bonds are kekulized, and refused when the ring hydrogen's
position (for example an imidazole tautomer) is not determined. Hybridization
follows RDKit's bonds-plus-lone-pairs rule. Ligands with alternate locations are
charged per conformer. Implicit hydrogen charges fold onto heavy atoms. The
report names every refused component and reason; components the templates
already charged in full, such as water and ions, are not refusals. This is a
heavy-atom, valence-based method, so unspecified protonation and formal charge
can change the result. No atoms are assigned by guessing a bond order or an
unsupported element parameter.

Sources are combined explicitly, with provenance describing both methods:

```ts
const amber = templateCharges(data);
const het = gasteigerCharges(data, { exclude: amber.assigned });
const values = amber.values.slice();
for (let i = 0; i < values.length; i++) {
  if (het.assigned[i]) values[i] = het.values[i];
}
const charged = withAttributes(data, {
  partialCharge: {
    domain: "atom",
    kind: "scalar",
    values,
    provenance: "template:amber-pdb2pqr.gasteiger",
  },
});
const netByResidue = residueNetCharge(charged);
```

`residueNetCharge` and report totals use `activeAtoms(data)` so alternate
conformers and NMR models are not counted twice. An unmatched atom has value 0
and remains visible in the report. Incomplete residues can have fractional net
charges because their missing heavy atoms have no row to receive charge. Partial
charges are in elementary charges (e). PQR import through `@molgpu/io` is a
separate source and can take precedence when available.

The bundled charge data were generated from PDB2PQR commit
`9babf94e6f9f1792b4efadb9e997955cee720d61` (`AMBER.DAT`, `AMBER.names`,
`AA.xml`, `NA.xml`). Regenerate with
`deno run -A packages/dynamics/scripts/gen-templates.ts`. The exact upstream
license is in [LICENSE-PDB2PQR](LICENSE-PDB2PQR). Package code is MIT; bundled
data are BSD-3-Clause. Force-field citations: Cornell et al. (1995), Wang,
Cieplak and Kollman (2000), and Dolinsky et al. (2004).

`buildElasticNetwork(positions, guideRows, cutoff)` uses `table.spatialGrid` to
find exact guide-node contacts.
`solveElasticModes(network, "gnm" | "anm",
count, options)` returns the first
`count` nontrivial modes in ascending eigenvalue order. It skips zero modes
(rigid-body and floppy), makes each vector's largest entry positive, and checks
every eigenpair's relative residual (at most 1e-6).

Up to 192 scalar dimensions (64 ANM nodes) it diagonalises the Kirchhoff matrix
or Hessian densely by Jacobi rotations. Above that it runs Lanczos with full
reorthogonalisation on a matrix-free product over the contacts. Each connected
component's translations are projected out exactly, and repeated eigenvalues
restart the Krylov space orthogonally. The basis is capped at about 320 MB of
f64 vectors (`maxIterations` overrides it), and running out throws instead of
returning unconverged modes. On an Apple M1, the first five ANM modes of 1tqn
(468 CA, 1,404 dimensions) take about 0.2 s, and ten modes of 1a4y (1,166 CA,
3,498 dimensions) about 2 s. Run large systems in a worker.

Both paths match ProDy 2.6.1 (`gamma = 1`, ANM 15 Å, GNM 7.3 Å) on the corpus CA
atoms of 1crn and 1tqn: eigenvalues within 1e-6 relative and vector overlaps
within 1e-5 of 1. The fixture and its script are in `test/fixtures`.

`residueGuideMap(topology, guideRows)` maps every atom to its residue's guide
node, preferring a guide with the same altloc, so side chains follow their CA.
`normalModeFromElastic(mode, atomToNode, version)` turns an ANM mode into the
`NormalModeData` that `<NormalMode>` animates. GNM modes are scalar fluctuations
and are rejected.
