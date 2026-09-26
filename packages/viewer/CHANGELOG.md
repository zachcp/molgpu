# Changelog

All notable changes to `@molgpu/viewer` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- Source is TypeScript (`src/**/*.ts`); the hand-written `index.d.ts` and
  `advanced.d.ts` are gone. The public API is unchanged.
- Fix: `Pickable` now removes its picking-registry entry on unmount (the
  cleanup was returned from `useResource` instead of registered via `dispose`).
- Fix: `useAnnotation` no longer re-runs the join on every render; it depends on
  each option value instead of a rest-spread object rebuilt per render.

First public release (0.1.0). APIs marked *experimental* in the README may still change
in 0.x minor releases.

- use.gpu Live components for molecular scenes: `<Molecule>`, `<Structure>` (preloaded or loaded), Spacefill, Bonds, BallAndStick, Tube, Ribbon and Surface representations with a shared `opacity` prop, materials, lights, `<Pass>` postprocessing (SSAO, outline, OIT), picking, annotations, timeline-driven cameras and `useStructureResource()`. use.gpu-typed escape hatches live in `@molgpu/viewer/advanced`.
- `@molgpu/table` is a peer dependency, so an app holds one shared copy (structure identity is module-private).
