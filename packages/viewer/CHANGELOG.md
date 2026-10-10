# Changelog

All notable changes to `@molgpu/viewer` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[release guide](https://github.com/zachcp/molgpu/blob/main/docs/RELEASING.md)
for the procedure.

## [Unreleased]

- Organize viewer source around dataset scopes, coordinate/attribute pipelines,
  visual features and named shared mechanics. Public imports and behavior are
  unchanged; add a source reading guide and a visual-import hardening guard.

- Correct public JSDoc for scope composition, dispatch readiness and shared
  snapshot scheduling. Restore full Isosurface/EFieldProps descriptions in
  generated docs and add missing summaries for four public exports.

- Coordinate snapshots retain their readback staging buffers and rate limit
  across dispatch readiness changes, keeping snapshot geometry at its requested
  cadence during playback.
- Tube, Bonds and BallAndStick accept `shadow`; BallAndStick casts stick shadows
  only. ElasticNetwork is covered by the coordinate retirement memory matrix.

- Clarify published documentation, correct public-entry examples and add JSR
  module summaries. Documentation changes only.

- `<Superpose to="first">` passes upstream coordinates through during trajectory
  opening/replacement and first-reference read failures. `SuperposeStatus` now
  reports `pending` and `error` with source/reference phases. An opening or
  failed inner Trajectory shadows outer metadata; cancelled reads cannot publish
  a late reference. Missing ancestors and invalid scientific references still
  throw.

- `<Ribbon>` geometry is now a port of Mol*'s default cartoon trace: per-residue
  half-shifted segments with terminal extension and overhang, flat box sheets
  with a 1.5× arrowhead on the last residue, elliptical helix and round coil
  tubes, and flat nucleic strands. A single-residue run is drawn as a sphere
  instead of being dropped.

- `<Cartoon>` (experimental) composes the `<Ribbon>` trace with nucleotide base
  rings and dashed polymer-gap cylinders in one mesh; `RibbonProps` types both.

- `pointerToPlane` and `projectToPointer` map a pointer to the view-normal plane
  through an anchor and back, from a projection-view matrix, for dragging an
  `<ElasticNetwork tug>` target. The site gains an elastic network demo: the
  timeline drives the step, checkpoints make it scrubbable, and a right-drag
  tugs an atom.

- `<ElasticNetwork record={{ every }}>` keeps a GPU ring of integrator
  checkpoints (x, v, f; 64 MiB by default). Seeks inside the retained range
  restore the nearest checkpoint and integrate fewer than `every` steps, bitwise
  equal to the continuous run; tugged history replays as recorded and a new
  perturbation branches. `ElasticNetworkStatus` gains `evicted`, `firstStep` and
  `lastStep`.

- `<ElasticNetwork network step>` runs BAOAB Langevin dynamics of an elastic
  network (`elasticNetworkData` from `@molgpu/dynamics`) as a coordinate
  provider. The application owns progress: `step` is a target count or a
  timeline curve; holding it pauses with no dispatch or repaint, and lowering it
  replays from step 0 bitwise. Up to `maxStepsPerFrame` (20) steps run per frame
  in the provider's own submission; mapped atoms move with their guide node, and
  live representations follow every generation while snapshot consumers
  (`<Ribbon>`, `<Tube>`, `<Surface>`) follow at the snapshot rate. Per-node RMSF
  matches the analytic ANM fluctuations (Pearson 0.99 on 1crn, 0.96 on 1tqn);
  `run-elastic.mjs` is part of `deno task test:components`.

- `<Surface>` under live coordinates (a coordinate provider or trajectory)
  rebuilds its mesh on the GPU from each coordinate generation: a WGSL port of
  Mol*'s SES field, GPU marching cubes and nearest-atom attribution, matching
  the CPU build to f32 rounding. A 4k-atom protein rebuilds in about 40 ms
  instead of 1.15 s, with no coordinate readback. Root coordinates, and
  parameters the port does not cover, keep the CPU build.
- Ribbon, Tube and Surface draw biological assembly copies: geometry is built
  once per group of copies sharing the same chains, in model space, and drawn
  under each copy's operator through transformed position/normal getters.

- `<Label>` and `<Distance>` draw once per biological assembly copy holding
  their atoms, anchored with that copy's coordinates (an explicit `at` draws
  once).

- Picking and framing follow assembly copies: `PickHit.operatorId` names the
  copy hit, and camera framing covers every drawn copy under its operator.

- Spacefill, Bonds and BallAndStick draw biological assembly copies: one per
  operator in `topology.instances`, transforming the nearest live coordinates
  after every provider and drawing only that copy's chains. Identity-only
  instance tables (the asymmetric unit) draw exactly as before.

- `<EField>` accepts optional `cutoff` and `switchWidth`. The exact sum stays
  the default; with a cutoff, far atom tiles are skipped and pair terms are
  switched off smoothly (128³ × 50k atoms: 1.25 s → 0.42 s with a 12 Å cutoff).
  See docs/findings/2026-10-02-efield-cutoff.md for the error vs the exact sum.

- `<EField>` sums the potential about 4× faster on large grids (128³ × 50k
  atoms: 5.4 s → 1.25 s with the default distance model; Debye 5.5 s → 2.2 s).
  Each dispatch is bounded at 2³⁰ pairs, the same wall time as before.

- `<Ribbon>` and `<Tube>` accept a numeric colour Field such as `byChain()`,
  `bySecondaryStructure()` or `byBfactor()`. Each vertex reads its residue's
  guide atom; switching or restyling fields rebuilds no geometry and uploads no
  coordinates (the first field that needs atom rows uploads one index column).

- Before first publish, rename `PickHit.instance` to `drawIndex`: it is the
  drawn primitive's index within its layer, not an assembly instance.
  `StructureSources.positions` is no longer deprecated; it is documented as the
  root dataset's positions, guarded in development below a coordinate provider.

- `<Trajectory src>` no longer remounts its descendants when the file opens.
  While opening (or after a source failure) upstream coordinates are copied
  through the same coordinate kernel that playback later uses, so
  representations keep their geometry and GPU resources.

- Remove the internal `tooltip.ts` helper and its test, left behind when
  `tooltipFields` was removed from the API; use `evaluate` from
  `@molgpu/fields`.

- Camera framing (`focusSelection`, `useCameraCurve`, `useCoordinateFocus`)
  covers only drawn atoms. It no longer expands through `topology.instances`
  transforms, which no representation draws; the two framing paths previously
  disagreed on per-chain versus whole-selection operators.

- `<Trajectory>` no longer throws a failed source open or frame read. Upstream
  coordinates pass through and the failure is reported through the new
  `onStatus` callback (`TrajectoryStatus`: opening, ready, or error with phase
  `source`/`frame`); without a callback each failure is logged once with
  `console.error`. A frame failure is sticky until the trajectory changes. Prop
  misuse, a frame curve without a timeline and periodic-image limit errors still
  throw.

- Molecular selection props now accept queries through `SelectionInput`, resolve
  at the nearest coordinate/attribute scopes, and expose optional
  pending/ready/error diagnostics. Queries refine consumer view defaults;
  resolved atom values stay exact and now reject stale topology. CPU membership
  uses 4 Hz/on-pause latest-published snapshots and may trail live rendering.
  Produced attributes, including DSSP during warmup, shadow root columns.
  Empty/pending/error selections never fall back to default draw membership;
  selection errors leave sibling consumers mounted.

- Breaking types: `ViewerElement` now aliases pinned native `LiveElement`,
  rejecting arbitrary objects while permitting native scene composition.
  `ViewerComponent` keeps a checked element return type. `MaterialSpec` now
  accepts only discriminated PBR/basic/normal constants; use native material
  wrappers for lazy values, shader maps, render callbacks and upstream color
  syntax. Molecular PBR defaults remain metalness 0 and roughness 0.6.

- Status and coordinate-bounds staging survives pending GPU maps across owner
  replacement and unmount, then retires after completion without publishing a
  stale result. Retirement CI coverage now includes coordinate providers,
  picking/shadow consumers, DSSP cancellation and bounded memory churn.

- Source requests own pending/error state and abort on replacement,
  preloaded-data switching and unmount. Trajectory reloads withdraw stale
  metadata, retries withdraw stale errors, and frame failures belong to their
  player. Loaders receive an optional third AbortSignal argument.

- One default view for molecular consumers: without `select`, `<Spacefill>`,
  `<Bonds>` and `<Label>` now draw the first model's primary conformers like
  `<Tube>`, `<Ribbon>` and `<Surface>`, instead of every retained row.
  `<EField>` takes `select` exactly instead of intersecting it with the first
  model, so a model-2 selection works. An empty focus falls back to the default
  view.
- `<Spacefill>`, `<Bonds>` and `<Surface>` share one colour-field binding plan:
  argument-free `volumeSample()` binds the nearest `<Volume>`/`<EField>`,
  annotation fields upload their atom rows, and lifted residue attributes work
  on surfaces, for full structures and selections.
- Nested Structure boundaries shadow trajectory metadata while Volume and
  Timeline continue to scope independently.
- GPU attribute readbacks validate and convert code columns before publication;
  failed conversions surface an error without marking a generation successful.
- Coordinate snapshots preserve the source chemical graph for connected
  selections and no longer insert inferred display bonds into topology.

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
  lands on zero keeps the kernel and its mode buffers mounted.
- `<Ribbon secondaryStructure="dssp">` runs DSSP on each coordinate snapshot it
  draws, so codes always come from the displayed coordinates (under a
  `<Trajectory>` or any coordinate provider). DSSP covers every model the drawn
  atoms belong to, so a selection of model 2 (or of several models) gets its own
  models' codes. The default, `"model"`, draws the structure's `ssCode`.
- `<Ribbon>` and `<Tube>` key their trace on topology and coordinates only, so
  an attribute edit (charges, a new `ssCode`) no longer rebuilds it. `<Ribbon>`
  rebuilds its mesh only when the cartoon projection of `ssCode` changes.
- Derived attribute channels: shared GPU column uploads across representations,
  an advanced `AttributeProducer` for kernel-written columns, and demand-driven
  `useAttributeSnapshot` CPU readback. `byChain()` now reads the table resolver
  correctly in Spacefill and Bonds.

- Trajectories. New experimental `<Trajectory data|src frame>` coordinate
  provider, `useTrajectoryFrame` and `<UnitCell>`, with the `TrajectoryProps`,
  `PreloadedTrajectoryProps`, `LoadedTrajectoryProps`, `TrajectoryPlayback`,
  `TrajectoryLoader` and `TrajectoryFrameState` types; new advanced
  `TrajectoryContext`. Frames stream through a byte-capped CPU cache with
  prefetch into a four-slot GPU window; one kernel interpolates the displayed
  pair (`interpolate`, `pbc="minimum-image"`) and scatters a subset through
  `atomMap`. `frame` takes a timeline curve.
- Fixed: a snapshot readback in flight when a new coordinate generation landed
  never rescheduled, so `<Ribbon>`, `<Tube>`, `<Surface>` and annotations below
  a provider could stay empty until the next change.
- Volumes. New experimental `<Volume data|src>`, `<Isosurface level>` and
  `<VolumeSlice plane>`, with the `VolumeProps`, `VolumeLoader`, `SlicePlane`
  and `SliceStops` types; new advanced `VolumeContext` and `useVolume`. A volume
  uploads once per `VolumeData` identity to a refcounted GPU buffer shared by
  every consumer. Isosurfaces remesh only on a new volume or level, and slices
  move by uniforms.
- `useField` binds `volumeSample` inputs: `volume:<n>` to the shared volume
  buffer, and `positions` to the drawn rows' positions (`<Spacefill>` and
  `<Bonds>` supply them).
- `<Surface>` extracts its mesh through the field's full affine transform.
- Coordinate stream. Positions are a GPU stream that child providers re-provide
  without changing topology. New experimental `useCoordinateSnapshot`,
  `useCoordinateSelection`, `useCoordinateBounds` and `useCoordinateFocus`; new
  advanced `CoordinatesContext`, `useCoordinates`, `IdentityCoordinates` and
  `WobbleCoordinates`.
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
