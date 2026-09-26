# Changelog

All notable changes to `@molgpu/viewer` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- `<Surface>` extracts its mesh through the field's full affine transform.
- Coordinate stream (Phase 9). Positions are a GPU stream that child providers
  re-provide without changing topology. New experimental
  `useCoordinateSnapshot`, `useCoordinateSelection`, `useCoordinateBounds` and
  `useCoordinateFocus`; new advanced `CoordinatesContext`, `useCoordinates`,
  `IdentityCoordinates` and `WobbleCoordinates`.
- `<Bonds>` read endpoint positions from the nearest coordinate stream in the
  vertex shader. Moving coordinates no longer rebuild CPU bond columns.
- `<Ribbon>`, `<Tube>`, `<Surface>`, `<Label>` and `<Distance>` rebuild from a
  shared, throttled snapshot (4 Hz by default, plus one after motion stops)
  below a provider. Under a `<Structure>` alone they read root positions as
  before.
- Deprecated: `StructureSources.positions` (advanced). Read the nearest stream
  with `useCoordinates().source`.
- The root positions column is uploaded as `vec3to4<f32>`.

- `WorldSpacePointLayer` now reads GPU radii sources and derives point sizes in
  the shader. Camera and scale changes no longer build or upload a size column.
  Its advanced `radii` prop is a `ShaderSource` and `count` is required.
- Breaking (experimental API): removed `AtomSelection`,
  `StructureResource.selection()`/`accepts()`, the `maxSelections` prop on
  `<Structure>` and the `maxSelections` option of `createStructureResource`.
  Resolved atom sets are `@molgpu/select` `Selection`s; no representation read
  the resource's parallel selection cache.
- Fix: a structure without an `atoms.radius` column now draws with element
  default radii (`@molgpu/table` `atomRadii`). Previously `<Spacefill>` drew
  nothing, `<Surface>` failed, and camera framing ignored atom extents.
- Selected `<Spacefill>` and field-coloured `<Bonds>` read the shared structure
  positions and radii, and full per-atom attribute columns, through an uploaded
  `u32` row column on the GPU. A selection change uploads only its rows; a
  coordinate edit no longer regathers selected positions, and re-inferred bonds
  no longer regather endpoint attributes.
- Column uploads no longer copy each packed array before handing it to
  `RawData`, which already copies into its own staging array. Columns are
  immutable by contract; a changed column must be a new array.
- Source is TypeScript (`src/**/*.ts`); the hand-written `index.d.ts` and
  `advanced.d.ts` are gone. The public API is unchanged.
- Fix: `Pickable` now removes its picking-registry entry on unmount (the cleanup
  was returned from `useResource` instead of registered via `dispose`).
- Fix: `useAnnotation` no longer re-runs the join on every render; it depends on
  each option value instead of a rest-spread object rebuilt per render.

First public release (0.1.0). APIs marked _experimental_ in the README may still
change in 0.x minor releases.

- use.gpu Live components for molecular scenes: `<Molecule>`, `<Structure>`
  (preloaded or loaded), Spacefill, Bonds, BallAndStick, Tube, Ribbon and
  Surface representations with a shared `opacity` prop, materials, lights,
  `<Pass>` postprocessing (SSAO, outline, OIT), picking, annotations,
  timeline-driven cameras and `useStructureResource()`. use.gpu-typed escape
  hatches live in `@molgpu/viewer/advanced`.
- `@molgpu/table` is a peer dependency, so an app holds one shared copy
  (structure identity is module-private).
