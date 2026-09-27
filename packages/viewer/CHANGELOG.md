# Changelog

All notable changes to `@molgpu/viewer` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- `<Structure src>` and `<Volume src>` default loaders pass the URL to
  `@molgpu/io`, so a failed fetch surfaces as an `IoError` (`FETCH_FAILED`).

- **Changed (advanced):** `./advanced` exposes hooks and one provider-authoring
  component, not raw contexts.
  - Added: `CoordinateKernel` and `CoordinateKernelProps`, the supported way to
    write a GPU coordinate transform (previously internal).
  - Removed: `CoordinatesContext`, `StructureContext`, `TimelineContext`,
    `TrajectoryContext`, `VolumeContext`, `AttributesContext`, `Attributes`,
    `ProducedAttribute`; read through `useCoordinates`, `useStructure`,
    `useTimelineTime`, `useTrajectoryFrame`, `useVolume` and
    `useAttributeSnapshot`.
  - Renamed: `StructureContextValue` to `NearestStructure`, `VolumeContextValue`
    to `NearestVolume`.
  - Removed: `gpuDssp`, `GpuDsspOptions`, `GpuDsspResult` (use `<GpuDssp>`), and
    the demo transforms `WobbleCoordinates` and `IdentityCoordinates` (a worked
    example lives in `site/src/demos/coordinates.ts`).

- **Changed (experimental):** the `.` entry holds components and the hooks an
  application composes with, listed explicitly (no `export type *`).
  - Moved to `./advanced`: `useCoordinateSnapshot`, `CoordinateSnapshot`,
    `useVolumeSnapshot`, `useCoordinateSelection`, `useCoordinateBounds`,
    `CoordinateBounds`, `StructureResource`, `StructureBounds`,
    `useStructureResource`, `createStructureResource`, `useTimelineTime`.
    `useAttributeSnapshot` and `AttributeSnapshot` are now only on `./advanced`.
  - Moved to `.`: `GpuDsspOverflowError`, which `<GpuDssp>` can throw.
  - Removed: `useTimelineSample` (use `sample(curve, time)` from
    `@molgpu/timeline`), `centroid`, `tooltipFields`, `useAnnotation` (load the
    records yourself and use `joinAnnotation` from `@molgpu/fields`),
    `focusSelection` (use `useCoordinateFocus`), `createCameraCurve`,
    `sampleCamera`, `ColorLike`, `TypedArray`, `PreloadedStructureProps`,
    `LoadedStructureProps`, `PreloadedTrajectoryProps`, `LoadedTrajectoryProps`
    and `TrajectoryPlayback` (`StructureProps` and `TrajectoryProps` keep both
    forms).

- **Removed (experimental):** the scene-level wrappers over
  `@use-gpu/workbench`. Build the pass, lights and camera from workbench
  directly (`<Pass lights>`, `AmbientLight`, `DirectionalLight`, …), as the site
  does. Removed from `.`: `Pass`, `PassProps`, `SSAOOptions`, `OutlineOptions`,
  `OverscanOptions`, `AmbientLight`, `DirectionalLight`, `PointLight`,
  `SpotLight`, `DomeLight`, `Environment` and their `*Props`,
  `ShadowMapOptions`, `KEY_LIGHT_DIRECTION`, `PBRMaterial`, `BasicMaterial`,
  `NormalMaterial`, `FresnelMaterialEffect` and their `*Props`, `MaterialProps`,
  `materialTypes`, `withMaterial` and `Molecule`. Removed from `./advanced`:
  `FlatMaterial`, `LitMaterial`.
- **Changed (experimental):** `MaterialType` is `"pbr" | "basic" | "normal"`.
  Use the function form of `material` for shader materials (upstream
  `ShaderFlatMaterial` / `ShaderLitMaterial`). The `pbr` spec keeps its matte,
  non-metallic defaults.

- `<GpuDssp>` freezes each coordinate generation before its first GPU submit,
  keeps one run in flight (latest generation wins) during playback, waits for a
  kernel stream's first dispatch, and holds its last codes for up to 1 s while a
  newer generation runs. `<Ribbon secondaryStructure="model">` draws those held
  codes for the same dataset instead of flipping back to file codes.
- **Changed (experimental):** `GpuDsspStatus` / `GpuDsspResult`
  `nearThresholdResidues` is renamed `nearThresholdCenters` (acceptor and
  bend-centre rows only, not dependent residues), and both gain `fallbackReason`
  (`"cell list"` or `"sparse cell grid"`).

- **Changed (advanced):** kernel-backed coordinate streams (`Trajectory`,
  `Transform`, `NormalMode`, `WobbleCoordinates`) now publish `ready: false`
  until their kernel's first dispatch lands, then advance `generation` again.
  `generation` is an opaque, increasing content counter: do not map it to a
  frame index. `<Superpose>`, `<Unwrap>` and `<EField>` wait for `ready` instead
  of computing from a zero-filled buffer; `Coordinates.mayStartUnfilled` and
  EField's settling timers are removed.

- Add experimental `<EField>`: the Coulomb potential of the nearest coordinates
  and a charge column (default `partialCharge`), summed exactly on the GPU onto
  a locked grid and provided as a live Volume in kT/e. Vacuum, ε = 4r (default)
  and Debye–Hückel models; `maxSamples` and `maxPairs` budgets throw before
  allocation. It recomputes per coordinate generation, one computation at a time
  (latest wins), with no readback.
- Add experimental `<FieldLines>` (RK4 streamlines of E = −∇φ, integrated on the
  GPU per volume generation) and `<FieldArrows>` (E arrows in a slice plane;
  moving the plane is a uniform write).
- `<Surface color>` accepts a position-only Field, such as `byPotential()`,
  sampled `sampleOffset` Å (default 1.4) along each vertex normal.
- Add `useVolumeSnapshot()`: CPU samples of the nearest volume, throttled for a
  computed one. `<Isosurface>` meshes from it.
- **Changed (advanced):** `VolumeContextValue` is now
  `{ grid, source,
  generation, range, volume, snapshot, subscribe }`; `volume`
  is null for a computed volume, and `grid` keeps its identity for an equal
  grid, so `<VolumeSlice>` no longer recompiles for a new `VolumeData` on the
  same grid. `VolumeContext` defaults to null instead of being required.
- Coordinate snapshots use a shared `ThrottledReadback`; behaviour and counter
  names are unchanged.

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
- Add experimental `<Unwrap box center onStatus>`. It makes each covalent
  component whole on the displayed frame of a periodic system, with exact
  nearest images in triclinic cells. A spanning forest is built once per
  topology, and the frame is traversed by GPU pointer jumping in the same
  submission as the upstream frame. `box` defaults to the nearest
  `<Trajectory>`'s displayed box. `center` moves components into the primary
  cell. `onStatus` reports ring edges that do not close, and a missing or
  invalid box, where positions pass through.
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
