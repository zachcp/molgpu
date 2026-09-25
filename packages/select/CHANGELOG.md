# Changelog

All notable changes to `@molgpu/select` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

## [0.1.0] - Unreleased

First public release. APIs marked *experimental* in the README may still change
in 0.x minor releases.

- Pure selection queries (`all`, `where`, `element`, `comp`, `within`), dataset- and revision-bound `resolve`, set operations and atom/residue/bond domain conversions. `SelectionQuery` is opaque: only `type`, `domain`, `label` and `deps` are public.
- `@molgpu/table` is a peer dependency, so an app holds one shared copy (structure identity is module-private).
