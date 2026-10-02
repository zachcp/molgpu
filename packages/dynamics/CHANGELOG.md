# Changelog

All notable changes to `@molgpu/dynamics` are recorded here.

## [Unreleased]

- Clarify package usage and data ownership, add complete examples, and remove
  internal planning references from public documentation.

- The manifest `license` is now `MIT` (JSR rejects compound SPDX expressions);
  the BSD-3-Clause PDB2PQR notice still ships as `LICENSE-PDB2PQR`.
- `elasticNetworkData(positions, topology, { guide, cutoff, k, masses,
  maxContacts, version })`
  builds `<ElasticNetwork>` input from reference positions the application
  chooses; `caGuideRows` picks one CA per protein residue of the first model.
  `./wgsl` adds `elasticDisplacementWgsl`.

- Langevin dynamics over elastic networks. `enmSprings` turns
  `buildElasticNetwork` contacts into a symmetric CSR spring network;
  `langevinSystem`, `langevinParams`, `langevinInit`, `langevinStep` and
  `kineticTemperature` are the BAOAB CPU reference (f64 or f32 storage), with
  Philox-4x32-10 noise keyed by (seed, step), inverse-CDF normals, rigid-body
  projection of the velocities and tug, and a Gershgorin `omegaMax · dt ≤ 1`
  guard. `./wgsl` adds `langevinWgsl`, `langevinBuffers`, `langevinUniform` and
  `LANGEVIN_PARAMS_BYTES`; a new browser suite (`deno task test:dynamics:gpu`)
  checks Philox bitwise, normals within 1e-5 and 100 steps against the CPU-f32
  reference within 1e-4 Å.

- `ElectrostaticsOptions` gain optional `cutoff` and `switchWidth`. The CHARMM
  switching function (C¹ at both ends) is applied by the CPU reference, by
  `coulombWgsl`'s `kernel` (`sumPoints`), and by the new `sumGridCutoff` entry,
  which skips 64-atom tiles beyond the cutoff using `tileBounds`. The params
  uniform carries the cutoff in `origin.w` and the switch start in `dims.w`.
  `sumGrid` still sums exactly.

- `coulombWgsl`'s `sumGrid` computes `COULOMB_GRID_BLOCK` (4) consecutive grid
  samples per invocation, chooses the potential model once per tile, and clamps
  `r²` instead of taking a square root where the model allows. Dispatch
  `ceil(count / COULOMB_GRID_BLOCK)` invocations. 128³ × 50k atoms (distance
  model) runs 4.3× faster with results unchanged within 1e-6.

- **Changed (experimental):** the package has two entries.
  - `.` keeps the domain API: template and Gasteiger charges, elastic networks
    and normal modes (`buildElasticNetwork`, `solveElasticModes`,
    `residueGuideMap`, `normalModeFromElastic`), `electrostatics`, periodic
    boxes (`periodicBox`, `minimumImage`), `fitKabsch` and the two limit errors.
  - `./wgsl` (advanced) now holds the WGSL sources, buffer-size constants and
    dispatch/layout helpers used by `@molgpu/viewer`: the eight `*Wgsl` sources,
    `COULOMB_*`, `SUPERPOSE_FIT_BYTES`, `UNWRAP_*_BYTES`, `coulombParams`,
    `CoulombDispatch`, `prepareDsspLayout`, `finishDssp`, `DsspLayout`,
    `DsspBridge`, `planCellList`, `CellListPlan`, `CellListBoundsReadback`,
    `createUnwrapForest`, `UnwrapForest`, `validateAffine`, `isIdentityAffine`,
    `AffineMatrix`, `validateNormalMode`.
  - No longer exported: the CPU references and test constants `applyAffine`,
    `applyNormalMode`, `unwrapFrame`, `UnwrapResult`, `coulombPotential`,
    `coulombField`, `coulombGrid`, `CoulombGrid`, `gridPoints`, `packCharges`,
    `debyeKappa`, `createCellList`, `CellList`, `CellListOptions`,
    `COULOMB_CONSTANT`, `GAS_CONSTANT_KCAL`, `MAX_ELASTIC_DIM`.

- Add `CellListLimitError` (a `RangeError` with `cells` and `limit`), thrown by
  `createCellList` and `planCellList` when the dense grid exceeds `maxCells`.
- `cellListWgsl` pairs and `dsspWgsl` hbonds clamp grid cells to the bounds, so
  an atom on the upper bound no longer skips its neighbour cells.
- `finishDssp` groups bridges by unit in one pass.

- Add Coulomb electrostatics: `electrostatics()` (vacuum, ε = D·r and
  Debye–Hückel, kT/e or kcal/mol/e), f64 `coulombPotential` / `coulombField` /
  `coulombGrid` references with closed-form fields, `packCharges`, and
  `coulombWgsl` (`packAtoms`, `sumGrid`, `sumPoints`) with `coulombParams`.

- Add AMBER/PDB2PQR residue-template charge assignment, ion charges and active
  residue net charge, with pinned upstream data and BSD-3-Clause notice.
- Add Gasteiger-Marsili charges for non-polymer components with explicit refusal
  reports, implicit-hydrogen folding and RDKit reference fixtures, covering
  Kekulé and order-4 aromatics, sulfonyl and phosphate groups, and ligands with
  alternate locations.
- Add the renderer-free package scaffold and enforce its import boundary.
- Add column-major affine CPU math and WGSL variants for all or selected atoms.
- Add the CPU Kabsch proper-rotation fit and degeneracy checks.
- Add exact triclinic minimum-image and covalent-forest CPU unwrap references.
- Add pure normal-mode displacement, validation and WGSL for precomputed modes.
- Add bounded CPU GNM/ANM contact construction and eigenmodes with residual
  checks.
- `solveElasticModes` takes `options` and solves systems above the dense limit
  with sparse Lanczos (full reorthogonalisation, exact translation deflation).
  Both paths match ProDy 2.6.1 ANM and GNM modes on 1crn and 1tqn.
- Add `residueGuideMap` and `normalModeFromElastic`, which turn an ANM mode into
  `<NormalMode>` input.
- Add `superposeWgsl` and `SUPERPOSE_FIT_BYTES`: a live GPU Kabsch fit in three
  ordered stages, checked against `fitKabsch`.
- Add `unwrapWgsl` (nearest-image links, pointer jumping, centering, placement
  and ring checks), `UNWRAP_LINK_BYTES`, `UNWRAP_PARAMS_BYTES`, and
  `periodicBox` / `PeriodicBox` for the live unwrap.
