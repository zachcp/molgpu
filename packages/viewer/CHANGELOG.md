# Changelog

All notable changes to `@molgpu/viewer` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

## [0.1.0] - Unreleased

First public release. APIs marked *experimental* in the README may still change
in 0.x minor releases.

- use.gpu Live components for molecular scenes: `<Molecule>`, `<Structure>` (preloaded or loaded), Spacefill, Bonds, BallAndStick, Tube, Ribbon and Surface representations with a shared `opacity` prop, materials, lights, `<Pass>` postprocessing (SSAO, outline, OIT), picking, annotations, timeline-driven cameras and `useStructureResource()`. use.gpu-typed escape hatches live in `@molgpu/viewer/advanced`.
- `@molgpu/table` is a peer dependency, so an app holds one shared copy (structure identity is module-private).
