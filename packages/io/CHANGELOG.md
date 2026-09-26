# Changelog

All notable changes to `@molgpu/io` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

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
