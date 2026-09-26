# Changelog

All notable changes to `@molgpu/table` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- Source is TypeScript (`src/*.ts`); the hand-written `index.d.ts` is gone. The
  public API is unchanged.

First public release (0.1.0). APIs marked _experimental_ in the README may still
change in 0.x minor releases.

- Validated, frozen columnar structures (`createStructure`), coordinate updates
  that keep identity (`withPositions`), the `activeAtoms` default view policy,
  bond topology/inference and polymer and secondary-structure traces.
- `LICENSE` includes the Mol* MIT notice for the ported code.
