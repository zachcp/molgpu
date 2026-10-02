# @molgpu/dynamics

Pure coordinate mathematics and CPU charge assignment for molecular scenes.
Coordinate functions accept packed xyz typed arrays and return new arrays or
mathematical results. GPU operations are published as WGSL source strings with
plain buffer contracts on `@molgpu/dynamics/wgsl`; `@molgpu/viewer` owns the
WebGPU resources and live coordinate providers. This package imports no
renderer, WebGPU, or `@use-gpu/*` modules.

CPU functions can run in a worker; the package does not manage a worker or a
simulation clock. `langevinStep` advances a mutable simulation state. Replaying
it requires the same initial state, parameters, seed and number of steps.

## Fit coordinates

```ts
import { fitKabsch, minimumImage, periodicBox } from "@molgpu/dynamics";

const reference = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const source = new Float32Array([2, 3, 0, 3, 3, 0, 2, 4, 0]);
const fit = fitKabsch(source, reference);
console.log(fit.rmsd); // approximately 0 Å
console.log(fit.matrix); // column-major 4×4 transform; inputs stay unchanged

const box = periodicBox([10, 0, 0, 0, 10, 0, 0, 0, 10]);
console.log(minimumImage([9, 0, 0], box.matrix)); // [-1, 0, 0] Å
```

Coordinates are packed `[x0, y0, z0, x1, y1, z1, ...]` in Ångström. A fit
requires matching atom order and at least three non-collinear points. It returns
a transform; apply that matrix in your renderer or coordinate adapter.

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
`coulombPotential`, `coulombField`, `createCellList`, `philox4x32`, …) are
internal. The Langevin CPU integrator is public: it is a scientific reference an
application can run in a worker, not only a test oracle.

| Export                   | Stability    | Purpose                                                                                                 |
| ------------------------ | ------------ | ------------------------------------------------------------------------------------------------------- |
| `CellListLimitError`     | experimental | Dense cell grid exceeds `maxCells`; carries `cells` and `limit`.                                        |
| `fitKabsch`              | experimental | CPU proper rigid fit over corresponding atom rows.                                                      |
| `KabschFit`              | experimental | Column-major rigid transform, fitted RMSD, and row count.                                               |
| `minimumImage`           | experimental | Exact nearest Cartesian lattice displacement for a periodic box.                                        |
| `periodicBox`            | experimental | Validate and invert a column-major 3×3 box, as the unwrap kernels take it.                              |
| `PeriodicBox`            | experimental | Box vectors, row-major inverse and inverse norm.                                                        |
| `PbcSearchLimitError`    | experimental | Named error for an excessive exact-image search.                                                        |
| `NormalModeData`         | experimental | Precomputed guide-node displacements and atom mapping.                                                  |
| `residueGuideMap`        | experimental | Map each atom to its residue's guide node (normally CA), altloc-aware.                                  |
| `normalModeFromElastic`  | experimental | Wrap an ANM mode and atom map as `NormalModeData`.                                                      |
| `buildElasticNetwork`    | experimental | Exact-cutoff guide contacts through `table.spatialGrid`.                                                |
| `solveElasticModes`      | experimental | CPU GNM/ANM eigenmodes: dense Jacobi or sparse Lanczos, with residual checks.                           |
| `ElasticSolveOptions`    | experimental | Solver choice (`auto`, `dense`, `lanczos`) and Lanczos basis cap.                                       |
| `ElasticNetwork`         | experimental | Sparse contact pairs and ANM directions.                                                                |
| `ElasticMode`            | experimental | Eigenvalue, vector, residual and GNM/ANM kind.                                                          |
| `elasticNetworkData`     | experimental | `<ElasticNetwork>` input from app-chosen reference positions: CA guides, CSR springs, masses, atom map. |
| `ElasticNetworkData`     | experimental | Langevin system, guide rows, atom-to-node map and reference version.                                    |
| `ElasticNetworkOptions`  | experimental | Guide (`"CA"` or rows), cutoff (15 Å), k (1), masses, contact cap and version.                          |
| `caGuideRows`            | experimental | One CA row per protein residue of the first model (altloc copies are not nodes).                        |
| `enmSprings`             | experimental | Symmetric CSR springs (rest lengths at the reference) from `buildElasticNetwork`.                       |
| `SpringNetwork`          | experimental | CSR offsets, neighbours, rest lengths and spring constant `k` (kcal/mol/Å²).                            |
| `langevinSystem`         | experimental | Validate springs, reference nodes and masses (110 amu default); rigid frame, `omegaMax`.                |
| `LangevinSystem`         | experimental | Reference, masses, centroid, inverse inertia and Gershgorin frequency bound.                            |
| `langevinParams`         | experimental | Resolve temperature, γ, dt, seed and tug; `RangeError` when `omegaMax · dt > 1`.                        |
| `LangevinOptions`        | experimental | Temperature (300 K), γ (1 ps⁻¹), dt (0.02 ps), u32 seed and optional tug.                               |
| `LangevinParams`         | experimental | Resolved constants shared by the CPU reference and the WGSL uniform.                                    |
| `LangevinTug`            | experimental | Harmonic pull of one node toward a target in the upstream frame.                                        |
| `langevinInit`           | experimental | Step-0 state: reference positions, zero velocity, forces.                                               |
| `langevinStep`           | experimental | CPU BAOAB steps with Philox noise and rigid-body projection; f64 or f32 storage.                        |
| `LangevinState`          | experimental | Step count and packed x, v, f.                                                                          |
| `LangevinPrecision`      | experimental | `f64` (scientific reference) or `f32` (GPU parity) state storage.                                       |
| `kineticTemperature`     | experimental | Instantaneous kinetic temperature over the 3N − 6 internal degrees of freedom.                          |
| `templateCharges`        | experimental | Assign AMBER/PDB2PQR residue-template and monatomic-ion charges.                                        |
| `residueNetCharge`       | experimental | Sum a charge column over active atoms into residue rows.                                                |
| `TemplateChargeOptions`  | experimental | Histidine and residue-specific template overrides.                                                      |
| `TemplateChargeReport`   | experimental | Net charge, gaps, ions and unmatched names.                                                             |
| `ChargeAssignment`       | experimental | Values, assigned mask and method report.                                                                |
| `ChargeUnmatched`        | experimental | Aggregated unmatched atom name and sample residue keys.                                                 |
| `gasteigerCharges`       | experimental | Assign PEOE charges to complete non-polymer components.                                                 |
| `GasteigerOptions`       | experimental | Exclusion mask and iteration count.                                                                     |
| `GasteigerReport`        | experimental | Assigned count and refused components.                                                                  |
| `GasteigerRefusal`       | experimental | Component residue keys, refusal reason and detail.                                                      |
| `GasteigerRefusalReason` | experimental | Named reason an unsupported component was not charged.                                                  |
| `electrostatics`         | experimental | Validate dielectric options and derive κ, kT and the output scale.                                      |
| `ElectrostaticsOptions`  | experimental | Model (`vacuum`, `distance`, `debye`), ε, ionic strength, temperature, clamp and unit.                  |
| `Electrostatics`         | experimental | Normalised physics shared by the CPU reference and the WGSL uniform.                                    |
| `DielectricModel`        | experimental | `vacuum`, `distance` (ε = D·r) or `debye`.                                                              |
| `PotentialUnit`          | experimental | `kT/e` or `kcal/mol/e`.                                                                                 |

### `./wgsl`

| Export                    | Stability | Purpose                                                                              |
| ------------------------- | --------- | ------------------------------------------------------------------------------------ |
| `AffineMatrix`            | advanced  | Column-major 4×4 affine matrix shape.                                                |
| `validateAffine`          | advanced  | Reject malformed, non-finite or perspective matrices.                                |
| `isIdentityAffine`        | advanced  | Detect an exact identity affine.                                                     |
| `affineWgsl`              | advanced  | WGSL source for a transform over all rows.                                           |
| `affineSelectedWgsl`      | advanced  | WGSL source for a transform over a bitset-selected subset.                           |
| `cellListWgsl`            | advanced  | WGSL stages for bounds, count, scan, scatter and exact pair queries.                 |
| `prepareDsspLayout`       | advanced  | Pack one model's active protein rows into chain-ordered GPU descriptors.             |
| `DsspLayout`              | advanced  | Descriptor, CA map and residue mapping for one model.                                |
| `dsspWgsl`                | advanced  | WGSL stages for GPU DSSP backbone, H-bonds, turns, helices, bends and bridges.       |
| `DsspBridge`              | advanced  | Compact bridge entry with canonical generation order.                                |
| `finishDssp`              | advanced  | Complete ladders and sheets from GPU flags and bridge readback.                      |
| `planCellList`            | advanced  | Validate generation-tagged bounds and device limits before GPU allocation.           |
| `CellListPlan`            | advanced  | Grid dimensions and buffer budget returned by `planCellList`.                        |
| `CellListBoundsReadback`  | advanced  | Compact 32-byte GPU bounds result tagged with source generation.                     |
| `superposeWgsl`           | advanced  | WGSL for a live Kabsch fit: centroid, covariance and rotation solve, then apply.     |
| `SUPERPOSE_FIT_BYTES`     | advanced  | Size of the fit state buffer `superposeWgsl` reads and writes (144 bytes).           |
| `unwrapWgsl`              | advanced  | WGSL for the live unwrap: image links, pointer jumping, centering, placement, rings. |
| `UNWRAP_LINK_BYTES`       | advanced  | Bytes per row of each unwrap link buffer (16).                                       |
| `UNWRAP_PARAMS_BYTES`     | advanced  | Bytes of the unwrap uniform (128).                                                   |
| `createUnwrapForest`      | advanced  | Deterministic covalent spanning forest from typed bonds.                             |
| `UnwrapForest`            | advanced  | Parent traversal, components and ring edges for one topology.                        |
| `validateNormalMode`      | advanced  | Validate mode vectors, mapping and structural version.                               |
| `normalModeWgsl`          | advanced  | WGSL for additive guide-node displacement.                                           |
| `coulombWgsl`             | advanced  | WGSL for tiled direct Coulomb sums: `packAtoms`, `sumGrid` and `sumPoints`.          |
| `COULOMB_GRID_BLOCK`      | advanced  | Grid samples per `sumGrid` invocation; dispatch `ceil(count / COULOMB_GRID_BLOCK)`.  |
| `COULOMB_CUTOFF_BRICK`    | advanced  | Samples per `sumGridCutoff` workgroup brick (16×4×4).                                |
| `coulombParams`           | advanced  | Encode the 112-byte uniform for one `coulombWgsl` dispatch.                          |
| `CoulombDispatch`         | advanced  | One dispatch's sample range, atom range and grid.                                    |
| `COULOMB_PARAMS_BYTES`    | advanced  | Size of the `coulombWgsl` uniform (112 bytes).                                       |
| `COULOMB_WORKGROUP`       | advanced  | Invocations per workgroup and atoms per tile (64).                                   |
| `COULOMB_MODEL_CODE`      | advanced  | Model code in the uniform: vacuum 0, distance 1, debye 2.                            |
| `elasticDisplacementWgsl` | advanced  | Linked coordinate kernel: atoms move by their guide node's `x − ref`.                |
| `langevinWgsl`            | advanced  | BAOAB in four dispatches per step (`langevinBao`, `Finish`, `Drift`, `ForcesKick`).  |
| `langevinBuffers`         | advanced  | Pack nodes, CSR, rest lengths and step-0 state; scratch size and workgroup count.    |
| `LangevinBuffers`         | advanced  | Typed arrays and sizes for the storage bindings of `langevinWgsl`.                   |
| `langevinUniform`         | advanced  | Encode the `langevinWgsl` uniform from a system and resolved params.                 |
| `LANGEVIN_PARAMS_BYTES`   | advanced  | Size of the `langevinWgsl` uniform (112 bytes).                                      |

## GPU integration

The `./wgsl` entry supplies source strings and plain buffer descriptions. It
does not compile shaders, allocate GPU buffers or schedule dispatches. See each
export's API documentation for binding order, uniform layout and dispatch order.
Use `@molgpu/viewer` components for the managed rendering path.

DSSP secondary-structure calculation uses `prepareDsspLayout` to select one
model's protein residues, GPU stages for backbone and hydrogen-bond analysis,
and `finishDssp` for CPU ladder and sheet completion. Kabsch fitting, periodic
unwrapping and Langevin integration also require ordered stages over the same
coordinate source. The caller owns buffers and synchronizes readback.

`planCellList` checks coordinate bounds and device limits before allocating a
dense neighbour grid. A stale generation returns `null`; invalid coordinates or
exceeded limits throw. Generation numbers are local to their source: retain
source identity alongside a readback when coordinating multiple providers.
Candidate and pair capacity overflows must be handled explicitly.

The cell-grid `count`, `scatter` and `pairs` stages share a 64-byte uniform:
`config = (selectedCount, hasRowMap, maxCandidates, maxPairs)`,
`dims = (nx, ny, nz, cellCount)`, `origin.xyz`, and
`scales = (1/cellWidth, cutoff², 0, 0)`. Cell width is `cellSize * (1 + 1e-6)`
to preserve adjacent cells at floating-point boundaries. Pair outputs are
unordered topology-row pairs; atomic scatter leaves their array order
unspecified. Clear buffers and check the overflow flag.

For one million rows, each atom-side `u32` array occupies 4 MB and packed xyz
coordinates occupy 12 MB. Four million cells need 32 MB for counts and offsets,
plus scratch and result buffers. `planCellList` reports persistent and scratch
bytes separately and a lower bound of two coordinate reads (24 bytes per row).
These are decimal memory sizes and buffer accounting, not timing measurements.

## Langevin simulation

The CPU integrator advances a spring network in Å, ps, amu and kcal/mol. It uses
BAOAB (force kick, drift, stochastic thermostat, drift, force kick) and seeded
Philox noise. It removes linear and angular momentum about the reference frame.
`langevinParams` rejects a step when its frequency bound times `dt` exceeds 1.
`langevinStep` mutates its state; clone state arrays if retaining snapshots.

```ts
import {
  buildElasticNetwork,
  enmSprings,
  kineticTemperature,
  langevinInit,
  langevinParams,
  langevinStep,
  langevinSystem,
} from "@molgpu/dynamics";

// Four guide nodes in a tetrahedron, coordinates in Å.
const positions = new Float32Array([
  0,
  0,
  0,
  4,
  0,
  0,
  0,
  4,
  0,
  0,
  0,
  4,
]);
const contacts = buildElasticNetwork(positions, [0, 1, 2, 3], 8);
const system = langevinSystem(enmSprings(contacts, positions), positions);
const params = langevinParams(system, { seed: 42, dt: 0.002 });
const state = langevinInit(system, params);
langevinStep(system, params, state, 100);
console.log(state.step, kineticTemperature(system, state));
```

Instantaneous temperature fluctuates; a single sample is not an equilibrium
check. Use `"f64"` state storage for a CPU scientific reference and `"f32"` for
comparison with GPU results. Repeated runs on one device are deterministic; CPU
and GPU results should be compared with numerical tolerances.

## Kabsch reference

`fitKabsch(source, reference, rows?, translate?)` fits corresponding topology
rows in double precision and returns a proper rotation (determinant +1). It
rejects collinear or nearly collinear fit points, including degenerate input
with fewer than three rows. The returned matrix applies to **all** output rows;
`rows` selects only the fit. The default also aligns centroids; with `translate`
false the source rotates about its own centroid, which stays put. This CPU
result is the oracle for the live `<Superpose>` viewer provider.

## Periodic boundaries

`minimumImage(delta, box)` finds the nearest Cartesian displacement for an
orthogonal or skew periodic box. `periodicBox` validates and inverts the
column-major 3×3 box vectors. Near-singular boxes are rejected and excessive
exact-image searches raise `PbcSearchLimitError`.

For advanced GPU unwrapping, `createUnwrapForest` uses explicitly covalent bonds
and filters incompatible models and alternate locations. Build the forest once
per topology version; it describes connectivity rather than trajectory history.
`unwrapWgsl` documents the stages, closure checks and buffer layout.

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

This example assumes `data` is a `StructureData` loaded by `@molgpu/io`:

```ts
import {
  gasteigerCharges,
  residueNetCharge,
  templateCharges,
} from "@molgpu/dynamics";
import { withAttributes } from "@molgpu/table";

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
license is in [LICENSE-PDB2PQR](LICENSE-PDB2PQR). Package code is MIT (the
manifest license); bundled data are BSD-3-Clause. Force-field citations: Cornell
et al. (1995), Wang, Cieplak and Kollman (2000), and Dolinsky et al. (2004).

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
returning unconverged modes. Run large systems in a worker.

Both paths match ProDy 2.6.1 (`gamma = 1`, ANM 15 Å, GNM 7.3 Å) on the corpus CA
atoms of 1crn and 1tqn: eigenvalues within 1e-6 relative and vector overlaps
within 1e-5 of 1. The fixture and its script are in `test/fixtures`.

`residueGuideMap(topology, guideRows)` maps every atom to its residue's guide
node, preferring a guide with the same altloc, so side chains follow their CA.
`normalModeFromElastic(mode, atomToNode, version)` turns an ANM mode into the
`NormalModeData` that `<NormalMode>` animates. GNM modes are scalar fluctuations
and are rejected.
