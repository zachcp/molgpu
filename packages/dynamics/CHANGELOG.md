# Changelog

All notable changes to `@molgpu/dynamics` are recorded here. See
[docs/RELEASING.md](../../docs/RELEASING.md) for the release procedure.

## [Unreleased]

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
