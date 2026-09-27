# Changelog

All notable changes to `@molgpu/table` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- Derived attribute channels (Phase 10): `withAttributes` validates and copies
  atom or residue columns, advancing the attribute revision. `attributeColumn`
  and `attributeNames` resolve built-in and derived columns with provenance.

- Trajectories (Phase 12). New experimental `createTrajectory`,
  `validateTrajectory`, `validateTrajectoryFrame`, `frameAtTime` and
  `trajectoryFromModels`, with the `TrajectoryData`, `TrajectoryInput`,
  `TrajectoryFrame`, `FrameSource` and `TrajectoryTimeUnit` types. A
  `FrameSource` decodes frames on demand; `trajectoryFromModels` plays a
  multi-model structure as frames over its first model through `atomMap`.
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
