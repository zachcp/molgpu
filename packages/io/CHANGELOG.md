# Changelog

All notable changes to `@molgpu/io` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- **Changed:** `structureFromBcif` no longer writes
  `topology.atoms.formalCharge`. Formal charge is now the derived `formalCharge`
  attribute (read it with `attributeColumn(data,
  "formalCharge")`). Its
  provenance is `imported:mmcif` when at least one `pdbx_formal_charge` row has
  a value, and otherwise it holds zeros with provenance `default`. Every
  structure from io therefore resolves `formalCharge`, and
  `pdbx_formal_charge = 0` selects uncharged atoms instead of throwing, as Mol*
  does (Phase 14, 1to.3).
- Trajectories (Phase 12). New experimental `openTrajectory`,
  `trajectoryFromDcd`, `trajectoryFromXtc`, `trajectoryFromTrr`,
  `trajectoryFormat`, `byteSource`, `urlByteSource`, `MAX_FULL_DOWNLOAD`,
  `AKMA_PS` and `TrajectoryParseError`, with the `TrajectoryErrorCode`,
  `TrajectoryFormat`, `TrajectoryReadOptions` and `ByteSource` types. Readers
  stream frames over bytes, Blobs or HTTP Range requests from a header index;
  XTC frames decode through Mol*, DCD and TRR frames here (TRR velocities are
  opt-in).
- `volumeFromCcp4(bytes, { maxSamples })` reads CCP4/MRC maps (modes 0, 1, 2;
  little- or big-endian) into `VolumeData`. It covers non-orthogonal cells,
  `MAPC/MAPR/MAPS` axis order, `N[CRS]START` and the MRC `ORIGIN` record.
  Failures throw `VolumeParseError` with a `VolumeErrorCode`.
- `SurfaceField` now extends `@molgpu/table`'s `VolumeData`: it adds `stats` and
  `components` and is frozen. `values`, `dims`, `transform`, `resolution`,
  `maxRadius` and `level` keep their meaning.
- Default atom radii come from `@molgpu/table`'s `elementRadius`; values are
  unchanged.
- Source is TypeScript (`src/index.ts`); the hand-written `index.d.ts` is gone.
  The public API is unchanged.
- `molstar` is now a regular dependency instead of an optional peer (JSR has no
  optional dependencies). It is still loaded lazily and bundled as separate
  chunks.

First public release (0.1.0). APIs marked _experimental_ in the README may still
change in 0.x minor releases.

- The Mol* import boundary: BinaryCIF to `StructureData` and molecular surface
  fields to owned plain data, with Mol* loaded lazily.
- `@molgpu/table` is a peer dependency, so an app holds one shared copy
  (structure identity is module-private).
- `LICENSE` includes the Mol* MIT notice for the ported code.
