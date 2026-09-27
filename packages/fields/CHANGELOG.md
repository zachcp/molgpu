# Changelog

All notable changes to `@molgpu/fields` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- `attribute` and `columnRange` now use the shared table resolver. Namespaced
  custom columns require a domain; residue columns can be lifted to atoms.

- `volumeSample(volume)`: the scalar value of a `VolumeData` at each atom's
  position. It evaluates on the CPU and compiles to WGSL that agrees within 1e-5
  (relative) at interior, face and outside points. `sampleVolumeWgsl` exposes
  the shared WGSL sampler, and `Binding.volume` names the volume behind a
  `volume:<n>` input.
- Source is TypeScript (`src/*.ts`); the hand-written `index.d.ts` is gone. The
  public API is unchanged, and `Field` stays opaque.

First public release (0.1.0). APIs marked _experimental_ in the README may still
change in 0.x minor releases.

- Typed per-row colour, scalar and label fields over molecular tables, a pure
  CPU evaluator and a renderer-free WGSL code generator.
- `@molgpu/table` is a peer dependency, so an app holds one shared copy
  (structure identity is module-private).
