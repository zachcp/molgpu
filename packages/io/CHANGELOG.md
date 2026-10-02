# Changelog

All notable changes to `@molgpu/io` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- Clarify package usage and data ownership, add complete examples, and remove
  internal planning references from public documentation.

- Update Mol* to 5.12.0 (exact pin). Inherited behavior changes: BinaryCIF field
  lookup is case-insensitive; `volumeFromCcp4` treats cell angles outside
  (0, 180) degrees as 90 and computes sigma when the header RMS is negative
  (e.g. IMOD-written MRC maps).

- `structureFromBcif(input, { assembly })` expands a `pdbx_struct_assembly` into
  `topology.instances` rows (chain × operator, Mol*'s operator-expression
  expansion; `operatorId` lists the `pdbx_struct_oper_list` ids). New error code
  `UNKNOWN_ASSEMBLY`. The default output is unchanged.

- Add AbortSignal and fetch options to whole-file importers; cooperate with
  parser/model cancellation. Validate HTTP Range offsets, totals and object
  validators; abort cached header scans. Pin Mol* to the tested version
  (currently 5.12.0).

- **Changed (stable):** one error type. `IoError` (with `format` and `code`,
  plus `IoErrorCode` and `IoFormat`) replaces `BcifParseError`, `PqrParseError`,
  `VolumeParseError`, `TrajectoryParseError`, `SurfaceFieldError`,
  `SelectionParseError` and the five `*ErrorCode` unions. Existing code strings
  are unchanged. Selection failures use codes `INVALID_SELECTION` and
  `UNSUPPORTED_SYMBOL` and no longer carry `language`/`text` properties (both
  are in the message).
- **Changed:** `structureFromBcif` and `volumeFromCcp4` take a `FileInput`:
  bytes, a `Blob`/`File`, or a URL fetched once. A failed fetch is
  `FETCH_FAILED`; a string input is now a URL.
- **Changed (experimental):** `openTrajectory` is the one trajectory entry, with
  `OpenTrajectoryOptions`. No longer exported: `trajectoryFromDcd`,
  `trajectoryFromXtc`, `trajectoryFromTrr`, `trajectoryFormat`, `byteSource`,
  `urlByteSource`, `MAX_FULL_DOWNLOAD`, `AKMA_PS`, `TrajectoryFormat`,
  `TrajectoryReadOptions` and `ParseSelectionOptions` (now inline in the
  `parseSelection` signature). Types are exported by name (no `export type *`).

- Imported secondary structure keeps its finer types: `pdbx_PDB_helix_class` 5 →
  G (3-10) and 3 → I (pi), then `conf_type_id` (3-10 and pi helix types,
  `TURN_*` → T, `STRN` → B, `BEND` → S), with sheet ranges applied last, in
  Mol*'s order. Every corpus entry matches Mol*'s model secondary structure per
  residue. Helix classes other than 3 and 5 read as H.
- **Changed:** `structureFromBcif` writes secondary structure as the derived
  `ssCode` attribute (helix H, sheet E) instead of
  `residues.secondaryStructure`. Its provenance is `imported:mmcif` when the
  file has `struct_conf` or `struct_sheet_range`, and otherwise it holds zeros
  marked `default`, as Mol* always has model secondary structure.
- PQR import. New experimental `structureFromPqr`, `applyPqr` and
  `PqrParseError`, with the `PqrErrorCode`, `PqrStructureReport` and
  `PqrApplyReport` types. Records are tokenised by whitespace, so PDB2PQR output
  with widened fields reads correctly; Mol*'s fixed-column PQR reader stays the
  test oracle. PDB2PQR force-field names (CYX, CYM, N/C terminal variants, AMBER
  nucleotides) classify as polymer residues in PQR structures only. `applyPqr`
  folds a PQR hydrogen into each model and altloc copy that lacks it, and
  `residueDelta` lists every model and conformer copy (with `model` and
  `altloc`) whose charge still differs from the PQR residue. Chain-less records
  raise `AMBIGUOUS_CHAIN` only for residues that are in the PQR.
- **Changed:** `structureFromBcif` no longer writes
  `topology.atoms.formalCharge`. Formal charge is now the derived `formalCharge`
  attribute (read it with `attributeColumn(data,
  "formalCharge")`). Its
  provenance is `imported:mmcif` when at least one `pdbx_formal_charge` row has
  a value, and otherwise it holds zeros with provenance `default`. Every
  structure from io therefore resolves `formalCharge`, and
  `pdbx_formal_charge = 0` selects uncharged atoms instead of throwing, as Mol*
  does.
- Trajectories. New experimental `openTrajectory`, `trajectoryFromDcd`,
  `trajectoryFromXtc`, `trajectoryFromTrr`, `trajectoryFormat`, `byteSource`,
  `urlByteSource`, `MAX_FULL_DOWNLOAD`, `AKMA_PS` and `TrajectoryParseError`,
  with the `TrajectoryErrorCode`, `TrajectoryFormat`, `TrajectoryReadOptions`
  and `ByteSource` types. Readers stream frames over bytes, Blobs or HTTP Range
  requests from a header index; XTC frames decode through Mol*, DCD and TRR
  frames here (TRR velocities are opt-in).
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
- `@molgpu/table` is a regular JSR dependency. Align compatible versions to
  share module-private structure identity state.
- `LICENSE` includes the Mol* MIT notice for the ported code.
