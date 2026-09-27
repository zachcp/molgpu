# Changelog

All notable changes to `@molgpu/viewer` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- Add experimental `<Transform matrix select>` with a CPU reference in
  `@molgpu/dynamics`. Matrix curves update the GPU output without re-uploading
  structure positions; selection masks stay in topology atom order.
- Add experimental `<Superpose to select translate>`. It fits the nearest
  coordinates onto a fixed array, a `StructureData`, or frame 0 of the nearest
  `<Trajectory>` (`to="first"`), and moves every atom by the fitted proper
  rotation. The fit runs on the GPU in the same submission as the upstream frame
  it moves, so there is no readback and no stale fit. Fit RMSD matches the CPU
  `fitKabsch` oracle within 1e-5 Å while scrubbing. A nearly collinear frame
  passes through.
- Add experimental `<NormalMode mode amplitude frequency phase>` for precomputed
  guide-node modes. Its animation changes a uniform and composes with
  Trajectory. Only a zero `amplitude` passes through; an animated scale that
  lands on zero keeps the kernel and its mode buffers mounted (9g3.10).
- `<Ribbon secondaryStructure="dssp">` runs DSSP on each coordinate snapshot it
  draws, so codes always come from the displayed coordinates (under a
  `<Trajectory>` or any coordinate provider). DSSP covers every model the drawn
  atoms belong to, so a selection of model 2 (or of several models) gets its own
  models' codes (efv.10). The default, `"model"`, draws the structure's `ssCode`
  (Phase 15, efv.8).
- `<Ribbon>` and `<Tube>` key their trace on topology and coordinates only, so
  an attribute edit (charges, a new `ssCode`) no longer rebuilds it. `<Ribbon>`
  rebuilds its mesh only when the cartoon projection of `ssCode` changes.
- Derived attribute channels (Phase 10): shared GPU column uploads across
  representations, an advanced `AttributeProducer` for kernel-written columns,
  and demand-driven `useAttributeSnapshot` CPU readback. `byChain()` now reads
  the table resolver correctly in Spacefill and Bonds.

- Trajectories (Phase 12). New experimental `<Trajectory data|src frame>`
  coordinate provider, `useTrajectoryFrame` and `<UnitCell>`, with the
  `TrajectoryProps`, `PreloadedTrajectoryProps`, `LoadedTrajectoryProps`,
  `TrajectoryPlayback`, `TrajectoryLoader` and `TrajectoryFrameState` types; new
  advanced `TrajectoryContext`. Frames stream through a byte-capped CPU cache
  with prefetch into a four-slot GPU window; one kernel interpolates the
  displayed pair (`interpolate`, `pbc="minimum-image"`) and scatters a subset
  through `atomMap`. `frame` takes a timeline curve.
- Fixed: a snapshot readback in flight when a new coordinate generation landed
  never rescheduled, so `<Ribbon>`, `<Tube>`, `<Surface>` and annotations below
  a provider could stay empty until the next change.
- Volumes (Phase 11). New experimental `<Volume data|src>`, `<Isosurface level>`
  and `<VolumeSlice plane>`, with the `VolumeProps`, `VolumeLoader`,
  `SlicePlane` and `SliceStops` types; new advanced `VolumeContext` and
  `useVolume`. A volume uploads once per `VolumeData` identity to a refcounted
  GPU buffer shared by every consumer. Isosurfaces remesh only on a new volume
  or level, and slices move by uniforms.
- `useField` binds `volumeSample` inputs: `volume:<n>` to the shared volume
  buffer, and `positions` to the drawn rows' positions (`<Spacefill>` and
  `<Bonds>` supply them).
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
