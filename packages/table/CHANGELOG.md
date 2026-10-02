# Changelog

All notable changes to `@molgpu/table` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[release procedure](https://github.com/zachcp/molgpu/blob/main/docs/RELEASING.md)
for the procedure.

## [Unreleased]

- Clarify package examples, generated API documentation and data contracts;
  remove internal work-tracking shorthand from published documentation.

- `Trace` gains `atom`: the guide atom row of each sample (CA, or the nucleic
  trace atom), so trace consumers can read atom-domain columns.

- Remove the deprecated `atoms.formalCharge` and `residues.secondaryStructure`
  topology columns (and `legacySsCodes`); set the `formalCharge` and `ssCode`
  attributes with `withAttributes`. Built-in views of topology columns now
  report provenance `topology` instead of `legacy`.

- Remove the unexported `frame-ss.ts` per-frame DSSP cache from the published
  source; the io DSSP oracle now runs per-frame DSSP with public `dssp` and
  `withPositions`.

- `createTrajectory` copies the arrays of in-memory `frames`, so later writes to
  caller inputs no longer change the trajectory. With a `source`, every frame
  read is validated (index range, abort, `Float32Array` type, length, finite
  values) before any consumer sees it; a source must not reuse decode buffers
  across reads. `createVolume` still adopts `values` as a transfer.

- Identity-dependent rejection messages name duplicate @molgpu/table copies and
  explain dependency alignment for deduplication.

- Remove test-only validators, frame conversion/lookup helpers, per-frame DSSP,
  and `selectBonds` from the package entry. Constructors continue to validate;
  tests import implementation helpers directly.
- Add `VolumeGrid` and `createVolumeGrid` for volumes whose samples live on the
  GPU; the transform helpers accept a grid.
- Add `sampleVolumeGradient` and `volumeGradientStep`: the world-space gradient
  of the trilinear sampler by central differences, zero within a step of the
  boundary.

- `frameSecondaryStructure(data, trajectory, { rows, maxBytes })` runs DSSP on
  integer trajectory frames read from `TrajectoryData.source`, cached with a
  byte cap; `timeline(frames)` returns an SS-vs-time matrix.
- DSSP. `dssp(data, { rows })` ports Mol* 5.11's DSSP (per chain and model,
  Mol*'s default options) and returns `ssCode` values per residue.
  `withSecondaryStructure(data, { mode })` sets `ssCode` with provenance
  `computed:dssp` by Mol*'s modes: `auto` (the default) keeps an imported,
  legacy or user column and computes when it is absent or `default`, `dssp`
  always computes, `model` keeps the data. The port fixes Mol*'s bend bug, so
  bends (S) are also assigned outside a model's first chain.
- Secondary-structure codes. `SS_CODES` lists the DSSP letters in `ssCode` order
  (0 coil, H, B, E, G, I, T, S, P) and `ssKind(code)` projects a code to helix,
  sheet or coil. `secondaryStructureTrace` reads the `ssCode` attribute, and a
  hand-built structure's `residues.secondaryStructure` resolves as `ssCode` with
  provenance `legacy`. `Residues.secondaryStructure` is deprecated.
- `Atoms.formalCharge` is deprecated. Set the derived `formalCharge` attribute
  with `withAttributes`; `@molgpu/io` now writes only that.
- Derived attribute channels: `withAttributes` validates and copies atom or
  residue columns, advancing the attribute revision. `attributeColumn` and
  `attributeNames` resolve built-in and derived columns with provenance.

- Trajectories. New experimental `createTrajectory`, `validateTrajectory`,
  `validateTrajectoryFrame`, `frameAtTime` and `trajectoryFromModels`, with the
  `TrajectoryData`, `TrajectoryInput`, `TrajectoryFrame`, `FrameSource` and
  `TrajectoryTimeUnit` types. A `FrameSource` decodes frames on demand;
  `trajectoryFromModels` plays a multi-model structure as frames over its first
  model through `atomMap`.
- `VolumeData`: an immutable grid with an index-to-world affine that may rotate
  and shear. New experimental `createVolume`, `validateVolume`,
  `MAX_VOLUME_SAMPLES`, `sampleVolume`, `volumeIndexToWorld`,
  `volumeWorldToIndex`, `volumeInverseTransform`, `volumeComponent` and
  `volumeLevel`. `createVolume` adopts `values` without copying, always computes
  statistics, and rejects more than 256³ samples unless `maxSamples` allows
  them.
- Added `spatialGrid`, a uniform spatial hash with optional partitions, shared
  by bond inference and `@molgpu/select`'s `within`.
- `bondTopology` inference uses cells as wide as its largest cutoff and
  partitions atoms by model. Fix: pairs up to 3.14 Å apart (S/P with padding 1)
  that straddled two 3 Å cells were missed. Superposed NMR models are no longer
  scanned against each other (143k-atom 2k39: about 2.8 s to 0.3 s per call).
  Inferred rows are now in canonical order, by `b` then `a`; the bond set is
  unchanged on the test corpus.
- Added `atomRadii(data)` and `elementRadius(z)`: one source for per-atom
  display radii. `atomRadii` returns the `atoms.radius` column when present,
  else element van der Waals defaults, cached per dataset identity.
- `validateStructure` builds cheaper duplicate-site and duplicate-bond keys,
  about 28% faster on a 400k-atom structure.
- Source is TypeScript (`src/*.ts`); the hand-written `index.d.ts` is gone. The
  public API is unchanged.

First public release (0.1.0). APIs marked _experimental_ in the README may still
change in 0.x minor releases.

- Validated, frozen columnar structures (`createStructure`), coordinate updates
  that keep identity (`withPositions`), the `activeAtoms` default view policy,
  bond topology/inference and polymer and secondary-structure traces.
- `LICENSE` includes the Mol* MIT notice for the ported code.
