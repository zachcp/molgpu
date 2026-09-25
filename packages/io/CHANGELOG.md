# Changelog

All notable changes to `@molgpu/io` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

## [0.1.0] - Unreleased

First public release. APIs marked *experimental* in the README may still change
in 0.x minor releases.

- The Mol* import boundary: BinaryCIF to `StructureData` and molecular surface fields to owned plain data, with Mol* as an optional peer.
- `@molgpu/table` is a peer dependency, so an app holds one shared copy (structure identity is module-private).
- `LICENSE` includes the Mol* MIT notice for the ported code.
