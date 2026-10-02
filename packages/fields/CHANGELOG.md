# Changelog

All notable changes to `@molgpu/fields` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- Generated WGSL for `linear(..., { overflow: "wrap" })` preserves both domain
  endpoints like the CPU evaluator, including reversed domains, and wraps only
  outside the closed domain. Curve wrap retains its periodic endpoint behavior.

- `evaluate` and a compiled annotation binding's `fill` reject an annotation
  whose row count differs from the structure's, instead of reading past it.
- Trim evaluator constants, identity accessors and `columnRange` from the
  package entry; keep field constructors and types needed by public signatures.
- `volumeSample()` without an argument samples the nearest viewer volume
  (`volume:nearest`). `compile` takes its grid as `options.volume`, and
  `evaluate` takes CPU samples as `{ volume }`. Add `readsNearestVolume`.
- Add `byPotential({ range, stops, volume })`, red-white-blue electrostatic
  potential, and `sampleVolumeGradientWgsl`.
- `sampleVolumeWgsl` accepts a samples-free `VolumeGrid`.

- `bySecondaryStructure(fallback)` colours atoms by their residue's `ssCode`
  with Mol*'s secondary-structure theme colours (Phase 15, efv.6).
- `byCharge(options)` colours by charge on Mol*'s partial-charge scale
  (red-white-blue over `[-1, 1]` e). By default it reads `partialCharge`;
  `column` reads another charge column (Phase 14, 1to.6).
- `attribute(name, { domain: "atom", lift: true })` lifts a custom residue
  column onto atoms through `atoms.residue`, as built-in residue columns already
  lift.
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
