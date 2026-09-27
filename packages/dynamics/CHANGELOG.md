# Changelog

All notable changes to `@molgpu/dynamics` are recorded here. See
[docs/RELEASING.md](../../docs/RELEASING.md) for the release procedure.

## [Unreleased]

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
