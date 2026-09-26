# Changelog

All notable changes to `@molgpu/select` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- `within` looks up seed atoms through `@molgpu/table`'s `spatialGrid` instead
  of comparing every atom with every seed. Results are unchanged (corpus and
  randomized brute-force checks); 1a4y queries run in about half the time.
- Source is TypeScript (`src/index.ts`); the hand-written `index.d.ts` is gone.
  The public API is unchanged, and `SelectionQuery` stays opaque.

First public release (0.1.0). APIs marked _experimental_ in the README may still
change in 0.x minor releases.

- Pure selection queries (`all`, `where`, `element`, `comp`, `within`), dataset-
  and revision-bound `resolve`, set operations and atom/residue/bond domain
  conversions. `SelectionQuery` is opaque: only `type`, `domain`, `label` and
  `deps` are public.
- `@molgpu/table` is a peer dependency, so an app holds one shared copy
  (structure identity is module-private).
