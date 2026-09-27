# @molgpu/viewer

use.gpu Live components for molecular scenes. A `<Structure>` owns one
structure's CPU resource and its shared GPU columns; representations beneath it
(`<Spacefill>`, `<Bonds>`, `<BallAndStick>`, `<Tube>`, `<Ribbon>`, `<Surface>`)
draw it, coloured by flat colours or `@molgpu/fields` fields and restricted by
`@molgpu/select` selections. Thin wrappers add molecular defaults to use.gpu's
materials, lights and `<Pass>`, and the package also provides picking, anchored
labels, annotation joins, and timeline-driven cameras. It never owns a canvas or
GPU device: everything composes inside a caller-owned use.gpu scene. It runs in
a browser with WebGPU only.

## Install

```sh
deno add jsr:@molgpu/viewer jsr:@molgpu/table npm:@use-gpu/live@0.20.0 npm:@use-gpu/workbench@0.20.0 npm:@use-gpu/shader@0.20.0 npm:@use-gpu/core@0.20.0
```

### Peer dependencies

The use.gpu packages are peers, pinned exactly (their APIs move between
releases): `@use-gpu/live`, `@use-gpu/workbench`, `@use-gpu/shader` and
`@use-gpu/core`, all `0.20.0`. An application also needs `@use-gpu/webgpu` (for
`<WebGPU>`/`<AutoCanvas>`), and `@use-gpu/glyph` if it uses `<Label>` or
`<Distance>`. `@molgpu/table` is also a peer, so the app and every `@molgpu/*`
package share one copy (structure identity is module-private). The other
`@molgpu/*` packages are regular dependencies.

## Example

```jsx
import { React, render } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import { OrbitCamera } from "@use-gpu/workbench";
import {
  AmbientLight,
  DirectionalLight,
  Pass,
  Spacefill,
  Structure,
} from "@molgpu/viewer";

render(
  <WebGPU>
    <AutoCanvas selector="#root" samples={4}>
      <OrbitCamera radius={40} target={[10.6, 10.2, 6.1]}>
        <Pass>
          <AmbientLight />
          <DirectionalLight />
          <Structure src="/1crn.bcif">
            <Spacefill material={{ type: "pbr", roughness: 0.4 }} />
          </Structure>
        </Pass>
      </OrbitCamera>
    </AutoCanvas>
  </WebGPU>,
);
```

Working, runnable examples: the typed consumer
[`test/tsx/consumer.tsx`](test/tsx/consumer.tsx) and the project
[`site`](../../site/README.md), whose maintained TSX demo composes public viewer
components under an application-owned render tree.

## Transparency

Every representation takes `opacity` (0–1), which is multiplied into the
colour's alpha. That works the same whether `color` is a flat colour or a
`@molgpu/fields` Field. When the result is below 1, the representation draws in
transparent mode on its own. Add `oit` to the `<Pass>` so overlapping
translucent geometry composites correctly:

```js
use(Pass, {
  oit: true,
  children: use(Structure, {
    data,
    children: [
      use(BallAndStick, { color: byElement() }),
      use(Surface, { opacity: 0.3 }),
    ],
  }),
});
```

`opacity` is a uniform, so animating it never rebuilds or re-uploads geometry.
Pass `mode: 'opaque'` or `mode: 'transparent'` to override the automatic choice.

## Entries

- **`@molgpu/viewer`** (`.`) carries **no use.gpu types**. Components are typed
  with owned aliases (`ViewerComponent`, `ViewerElement`, `VectorLike`,
  `ColorLike`, and owned prop interfaces for the material, light and pass
  wrappers). Upstream-only props (texture maps, `render` callbacks, a custom
  environment `map`) still forward at runtime but are not typed here.
- **`@molgpu/viewer/advanced`** exposes the use.gpu-shaped escape hatches:
  shader sources, Live contexts and shader-module materials. Its declarations
  name `@use-gpu/*` types directly, so code using it is tied to the pinned
  use.gpu version.

## API

Stability: _stable_ — relied on by the examples and settled; _experimental_ —
may change before 0.1.0; _advanced_ — only from `@molgpu/viewer/advanced`.

| Name                         | Stability    | Description                                                                                                                                                                                                             |
| ---------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Molecule`                   | stable       | Compositional boundary; owns no canvas or device.                                                                                                                                                                       |
| `Structure`                  | stable       | Provides one structure (preloaded `data` or loaded `src`) to its subtree.                                                                                                                                               |
| `StructureProps`             | stable       | `<Structure>` props: preloaded or loaded, mutually exclusive.                                                                                                                                                           |
| `PreloadedStructureProps`    | stable       | `<Structure data>` props.                                                                                                                                                                                               |
| `LoadedStructureProps`       | stable       | `<Structure src>` props, with `loader`/`loading`/`error`.                                                                                                                                                               |
| `StructureLoader`            | stable       | Cancellable `(src, cancelled) => StructureData` loader.                                                                                                                                                                 |
| `Spacefill`                  | stable       | Atoms as world-space shaded spheres.                                                                                                                                                                                    |
| `Bonds`                      | stable       | Bonds as world-space sticks; vertex positions follow the nearest coordinate provider.                                                                                                                                   |
| `BallAndStick`               | stable       | Spacefill balls plus Bonds sticks over one selection.                                                                                                                                                                   |
| `Tube`                       | stable       | Backbone as a GPU-extruded tube.                                                                                                                                                                                        |
| `Ribbon`                     | stable       | Backbone as an oriented ribbon mesh.                                                                                                                                                                                    |
| `GpuDssp`                    | experimental | Computes DSSP from the nearest GPU coordinate stream for one model and publishes generation-tagged `ssCode` to descendant fields and ribbons.                                                                           |
| `Surface`                    | stable       | Molecular (solvent-excluded) surface.                                                                                                                                                                                   |
| `Volume`                     | experimental | Own one scalar volume (`data` or CCP4/MRC `src`); one shared GPU copy per volume identity.                                                                                                                              |
| `VolumeProps`                | experimental | `<Volume>` props: `data` or `src`, with `loader`/`loading`/`error`.                                                                                                                                                     |
| `VolumeLoader`               | experimental | Cancellable `(src, cancelled) => VolumeData` loader.                                                                                                                                                                    |
| `Isosurface`                 | experimental | CPU marching-cubes isosurface of the nearest `<Volume>` at an absolute or sigma `level`.                                                                                                                                |
| `VolumeSlice`                | experimental | Per-fragment planar cross-section of the nearest `<Volume>` through a colour ramp.                                                                                                                                      |
| `EField`                     | experimental | GPU Coulomb potential (vacuum, ε = 4r or Debye–Hückel) of the nearest coordinates and a charge column, provided as a live Volume in kT/e.                                                                               |
| `EFieldProps`                | experimental | `<EField>` props: selection, charge column, dielectric model, grid and budgets.                                                                                                                                         |
| `FieldLines`                 | experimental | RK4 streamlines of E = −∇φ through the nearest volume, integrated on the GPU per volume generation.                                                                                                                     |
| `FieldArrows`                | experimental | E = −∇φ arrows on a lattice in a slice plane; moving the plane is a uniform write.                                                                                                                                      |
| `Trajectory`                 | experimental | Coordinate provider that plays a `TrajectoryData` (`data`) or a DCD/XTC/TRR URL (`src`) over the nearest coordinates; `frame` is a number or timeline curve; `interpolate`, `pbc="minimum-image"`.                      |
| `Transform`                  | experimental | Coordinate provider applying a column-major 4×4 affine matrix (or vector curve) to all atoms or `select` rows. Other rows pass through.                                                                                 |
| `TransformProps`             | experimental | Matrix, optional atom selection, and children for `<Transform>`.                                                                                                                                                        |
| `Superpose`                  | experimental | Coordinate provider fitting the nearest coordinates onto a reference (`to`: array, structure, or `"first"` trajectory frame) by a GPU Kabsch fit; `select` picks fit atoms and every atom moves.                        |
| `SuperposeProps`             | experimental | Reference, optional fit selection, `translate`, asynchronous `onStatus`, and children for `<Superpose>`.                                                                                                                |
| `SuperposeStatus`            | experimental | Solved or collinear passthrough, fitted RMSD when solved, and coordinate generation.                                                                                                                                    |
| `Unwrap`                     | experimental | Coordinate provider making covalent components whole on the displayed periodic frame (GPU pointer jumping over a covalent forest); `box` defaults to the trajectory's, `center` moves components into the primary cell. |
| `UnwrapProps`                | experimental | Box, optional center selection, `onStatus`, and children for `<Unwrap>`.                                                                                                                                                |
| `UnwrapStatus`               | experimental | `ok`, `ambiguous` (ring edges that do not close), `search-limit`, `missing-box` or `invalid-box`, with a generation.                                                                                                    |
| `NormalMode`                 | experimental | Add a precomputed guide-node mode to nearest upstream coordinates; animation changes a scalar uniform.                                                                                                                  |
| `NormalModeProps`            | experimental | Mode vectors/mapping, amplitude, frequency, phase, and children.                                                                                                                                                        |
| `useTrajectoryFrame`         | experimental | What the nearest `<Trajectory>` shows: requested frame, displayed pair, interpolated box; null outside one.                                                                                                             |
| `UnitCell`                   | experimental | Lines along the displayed frame's periodic box.                                                                                                                                                                         |
| `TrajectoryProps`            | experimental | `PreloadedTrajectoryProps                                                                                                                                                                                               |
| `PreloadedTrajectoryProps`   | experimental | `<Trajectory data>` props.                                                                                                                                                                                              |
| `LoadedTrajectoryProps`      | experimental | `<Trajectory src>` props, with an optional `loader`.                                                                                                                                                                    |
| `TrajectoryPlayback`         | experimental | Props shared by both `<Trajectory>` forms: `frame`, `interpolate`, `pbc`, `children`.                                                                                                                                   |
| `TrajectoryLoader`           | experimental | Cancellable `(src, cancelled) => TrajectoryData` loader.                                                                                                                                                                |
| `TrajectoryFrameState`       | experimental | Return type of `useTrajectoryFrame`.                                                                                                                                                                                    |
| `SlicePlane`                 | experimental | A grid plane `{ axis, index }` or a world plane `{ normal, point }`.                                                                                                                                                    |
| `SliceStops`                 | experimental | `[t, color]` stops over 0–1 for `<VolumeSlice>`.                                                                                                                                                                        |
| `TimelineProvider`           | stable       | Provides caller-owned global time in seconds.                                                                                                                                                                           |
| `ViewerElement`              | experimental | Opaque rendered scene element (owned alias).                                                                                                                                                                            |
| `ViewerComponent`            | experimental | A component: `(props) => ViewerElement` (owned alias).                                                                                                                                                                  |
| `TypedArray`                 | experimental | Any numeric typed array.                                                                                                                                                                                                |
| `VectorLike`                 | experimental | Plain or typed numeric vector.                                                                                                                                                                                          |
| `ColorLike`                  | experimental | Colour as number, vector, `{ rgb }`/`{ rgba }` or CSS string.                                                                                                                                                           |
| `BlendMode`                  | experimental | Blend-mode names for layer and outline options.                                                                                                                                                                         |
| `Translucency`               | stable       | `opacity` (0–1, a uniform) and `mode`, shared by every representation.                                                                                                                                                  |
| `DrawMode`                   | stable       | `'opaque' \| 'transparent'`; transparent is chosen automatically when colour alpha × opacity < 1.                                                                                                                       |
| `PointLayerOptions`          | experimental | Point-layer flags `<Spacefill>` forwards.                                                                                                                                                                               |
| `StructureResource`          | experimental | CPU-side owner of one structure's shared values.                                                                                                                                                                        |
| `StructureBounds`            | experimental | Ångström extent of a structure or selection.                                                                                                                                                                            |
| `createStructureResource`    | experimental | Create a StructureResource outside a `<Structure>`.                                                                                                                                                                     |
| `useStructureResource`       | experimental | The nearest `<Structure>`'s `StructureResource`, for `focusSelection` and other resource-taking APIs.                                                                                                                   |
| `useCoordinateSnapshot`      | experimental | Shared, throttled CPU positions below a GPU provider; `null` until first readback.                                                                                                                                      |
| `useVolumeSnapshot`          | experimental | CPU samples of the nearest volume: at once for `<Volume>`, throttled readback for a computed one.                                                                                                                       |
| `CoordinateSnapshot`         | experimental | Published structure data, revisioned resource and source generation.                                                                                                                                                    |
| `useAttributeSnapshot`       | experimental | Demand-driven CPU copy of a GPU-produced attribute, with its source generation.                                                                                                                                         |
| `AttributeSnapshot`          | experimental | Published structure data and attribute producer generation.                                                                                                                                                             |
| `useCoordinateSelection`     | experimental | Re-resolve position-dependent queries against a published snapshot.                                                                                                                                                     |
| `useCoordinateBounds`        | experimental | Asynchronous GPU bounds and centroid of the nearest stream.                                                                                                                                                             |
| `CoordinateBounds`           | experimental | GPU-reduced min, max, centroid, count and generation.                                                                                                                                                                   |
| `useCoordinateFocus`         | experimental | Nonblocking selection focus from GPU bounds; starts with root framing.                                                                                                                                                  |
| `MaterialType`               | experimental | Material `type` names for a `material` spec.                                                                                                                                                                            |
| `MaterialSpec`               | experimental | A representation's `material` prop.                                                                                                                                                                                     |
| `MaterialProps`              | experimental | Props shared by the material wrappers.                                                                                                                                                                                  |
| `PBRMaterial`                | experimental | PBR material; matte, non-metallic defaults.                                                                                                                                                                             |
| `PBRMaterialProps`           | experimental | `<PBRMaterial>` props.                                                                                                                                                                                                  |
| `BasicMaterial`              | experimental | Unlit flat colour.                                                                                                                                                                                                      |
| `BasicMaterialProps`         | experimental | `<BasicMaterial>` props.                                                                                                                                                                                                |
| `NormalMaterial`             | experimental | Surface-normal debug material.                                                                                                                                                                                          |
| `NormalMaterialProps`        | experimental | `<NormalMaterial>` props.                                                                                                                                                                                               |
| `FresnelMaterialEffect`      | experimental | Fresnel rim effect over another material.                                                                                                                                                                               |
| `FresnelMaterialEffectProps` | experimental | `<FresnelMaterialEffect>` props.                                                                                                                                                                                        |
| `materialTypes`              | experimental | The accepted material `type` names.                                                                                                                                                                                     |
| `withMaterial`               | experimental | Wrap an element in a material spec.                                                                                                                                                                                     |
| `KEY_LIGHT_DIRECTION`        | experimental | Shared world-space key-light direction.                                                                                                                                                                                 |
| `ShadowMapOptions`           | experimental | Shadow-map settings for a light.                                                                                                                                                                                        |
| `AmbientLight`               | experimental | Soft fill light (intensity 0.3).                                                                                                                                                                                        |
| `AmbientLightProps`          | experimental | `<AmbientLight>` props.                                                                                                                                                                                                 |
| `DirectionalLight`           | experimental | Key light along `KEY_LIGHT_DIRECTION`.                                                                                                                                                                                  |
| `DirectionalLightProps`      | experimental | `<DirectionalLight>` props.                                                                                                                                                                                             |
| `PointLight`                 | experimental | Positioned falloff light.                                                                                                                                                                                               |
| `PointLightProps`            | experimental | `<PointLight>` props.                                                                                                                                                                                                   |
| `SpotLight`                  | experimental | Positioned cone light.                                                                                                                                                                                                  |
| `SpotLightProps`             | experimental | `<SpotLight>` props.                                                                                                                                                                                                    |
| `DomeLight`                  | experimental | Sky/ground gradient dome light.                                                                                                                                                                                         |
| `DomeLightProps`             | experimental | `<DomeLight>` props.                                                                                                                                                                                                    |
| `Environment`                | experimental | Image-based lighting from a named preset.                                                                                                                                                                               |
| `EnvironmentProps`           | experimental | `<Environment>` props.                                                                                                                                                                                                  |
| `Pass`                       | experimental | Scene render pass; lights on by default; ssao/outline/oit.                                                                                                                                                              |
| `PassProps`                  | experimental | `<Pass>` props.                                                                                                                                                                                                         |
| `SSAOOptions`                | experimental | `<Pass ssao>` options.                                                                                                                                                                                                  |
| `OutlineOptions`             | experimental | `<Pass outline>` options.                                                                                                                                                                                               |
| `OverscanOptions`            | experimental | `<Pass overscan>` options.                                                                                                                                                                                              |
| `PickingProvider`            | experimental | Owns the picking registry.                                                                                                                                                                                              |
| `usePicking`                 | experimental | Hovered and picked atom.                                                                                                                                                                                                |
| `PickHit`                    | experimental | An atom resolved from a picking hit.                                                                                                                                                                                    |
| `tooltipFields`              | experimental | Evaluate fields for one atom, for a tooltip.                                                                                                                                                                            |
| `Label`                      | experimental | Text label anchored to a selection centroid.                                                                                                                                                                            |
| `Distance`                   | experimental | Line and label between two selection centroids.                                                                                                                                                                         |
| `centroid`                   | experimental | Mean atom position of a selection.                                                                                                                                                                                      |
| `useAnnotation`              | experimental | Join annotation records onto the structure as a field.                                                                                                                                                                  |
| `useTimelineTime`            | experimental | Current timeline time.                                                                                                                                                                                                  |
| `useTimelineSample`          | experimental | Sample a curve at the timeline time.                                                                                                                                                                                    |
| `CameraPose`                 | experimental | Orbit-camera target/radius/bearing/pitch.                                                                                                                                                                               |
| `CameraFrame`                | experimental | Explicit camera keyframe.                                                                                                                                                                                               |
| `FocusCameraFrame`           | experimental | Camera keyframe that frames a selection query.                                                                                                                                                                          |
| `CameraCurve`                | experimental | Sequence of camera keyframes.                                                                                                                                                                                           |
| `FocusOptions`               | experimental | Framing options for focusing a selection.                                                                                                                                                                               |
| `FocusResult`                | experimental | Target, radius and bounds from `focusSelection`.                                                                                                                                                                        |
| `focusSelection`             | experimental | Frame a selection query on a resource.                                                                                                                                                                                  |
| `createCameraCurve`          | experimental | Validate camera keyframes.                                                                                                                                                                                              |
| `sampleCamera`               | experimental | Sample a camera curve at a time.                                                                                                                                                                                        |
| `useCameraCurve`             | experimental | Sample a camera curve at the timeline time.                                                                                                                                                                             |
| `StructureContext`           | advanced     | Live context carrying the nearest structure's resource and sources.                                                                                                                                                     |
| `StructureContextValue`      | advanced     | `{ resource, sources }` from the structure context.                                                                                                                                                                     |
| `StructureSources`           | advanced     | Shared positions/radii shader sources.                                                                                                                                                                                  |
| `useStructure`               | advanced     | Read the nearest `<Structure>`'s resource and sources.                                                                                                                                                                  |
| `CoordinatesContext`         | advanced     | Live context carrying the nearest GPU coordinate stream.                                                                                                                                                                |
| `AttributesContext`          | advanced     | Live context carrying GPU-produced attribute sources.                                                                                                                                                                   |
| `Attributes`                 | advanced     | Name-to-source map of produced attributes.                                                                                                                                                                              |
| `ProducedAttribute`          | advanced     | GPU source, domain, kind, provenance and generation for one attribute.                                                                                                                                                  |
| `AttributeProducer`          | advanced     | Compute a live scalar or code column for descendant fields.                                                                                                                                                             |
| `Coordinates`                | advanced     | GPU positions source, atom count, content generation and owning resource.                                                                                                                                               |
| `useCoordinates`             | advanced     | Read the nearest coordinate stream; an empty structure returns null.                                                                                                                                                    |
| `IdentityCoordinates`        | advanced     | Forward the nearest coordinates without allocating a GPU buffer.                                                                                                                                                        |
| `WobbleCoordinates`          | advanced     | Example GPU coordinate transform driven by a phase and amplitude.                                                                                                                                                       |
| `TimelineContext`            | advanced     | Live context carrying timeline time.                                                                                                                                                                                    |
| `TrajectoryContext`          | advanced     | Live context carrying the nearest `<Trajectory>` state.                                                                                                                                                                 |
| `VolumeContext`              | advanced     | Live context carrying the nearest `<Volume>`'s data and GPU samples.                                                                                                                                                    |
| `VolumeContextValue`         | advanced     | `{ grid, source, generation, range, volume, snapshot, subscribe }` from the volume context.                                                                                                                             |
| `useVolume`                  | advanced     | Read the nearest `<Volume>` or `<EField>`; throws without one.                                                                                                                                                          |
| `FlatMaterial`               | advanced     | Custom unlit fragment-shader material.                                                                                                                                                                                  |
| `LitMaterial`                | advanced     | Custom lit shader material.                                                                                                                                                                                             |
| `WorldSpacePointLayer`       | advanced     | PointLayer with GPU radii source and Ångström size conversion in a shader.                                                                                                                                              |
| `useField`                   | advanced     | Lower a field to a use.gpu shader source.                                                                                                                                                                               |

| Export                 | Stability    | Purpose                                                              |
| ---------------------- | ------------ | -------------------------------------------------------------------- |
| `GpuDsspProps`         | experimental | Model, overflow policy, status callback and children.                |
| `GpuDsspStatus`        | experimental | Generation, near-threshold residue count, bridge count and fallback. |
| `gpuDssp`              | advanced     | Compute DSSP from a packed GPU coordinate buffer.                    |
| `GpuDsspOverflowError` | advanced     | Named static-path error for bounded GPU work.                        |
| `GpuDsspOptions`       | advanced     | Layout, rows, generation and overflow policy.                        |
| `GpuDsspResult`        | advanced     | Owned code buffer, CPU copy, memory counters and fallback.           |

## Volumes

`<Volume>` sits beside `<Structure>`, not inside it: a structure never owns a
volume. (A computed volume, `<EField>`, sits inside the structure it reads; see
Electric fields below.) Its samples upload once per `VolumeData` identity to a
GPU buffer that `<Isosurface>`, `<VolumeSlice>` and any `volumeSample` field
share; the last consumer to unmount destroys it. `<Isosurface>` meshes on the
CPU through the volume's full index-to-world affine and remeshes only when the
volume or the resolved level changes. `<VolumeSlice>` samples per fragment, so
moving its plane, range or opacity updates uniforms only. Colour atoms from a
map with `color={colormap(volumeSample(map), stops)}`: the field reads the
atoms' positions and the shared samples, with no per-atom colour upload.

## Electric fields

`<EField>` is a computed volume. It sums the Coulomb potential of the nearest
coordinates and a charge column on the GPU, so the representations below it work
as they do under `<Volume>`:

```tsx
<Structure data={withAttributes(data, { partialCharge })}>
  <EField select={protein}>
    <Surface color={byPotential()} />
    <Isosurface level={5} color={[0.3, 0.4, 1, 1]} />
    <FieldLines seeds={{ spacing: 4 }} colorRange={[0, 2]} />
  </EField>
</Structure>;
```

Assign charges first with `templateCharges` (@molgpu/dynamics), `applyPqr` or
`structureFromPqr`; a missing column throws by name. Only the first model's
primary-conformer atoms are summed. Pass a `select` that leaves out water if the
charges include it.

- **Physics.** The default model is a distance-dependent dielectric (ε = 4r,
  ChimeraX's coulombic default). `model="debye"` screens with an ionic strength,
  and `model="vacuum"` is plain Coulomb. Values are in kT/e at 298.15 K, which
  makes the default display range ±15 (±2 for Debye). This is not
  Poisson–Boltzmann: import an APBS map with `<Volume>` for that.
- **Grid.** The grid is placed around the structure's own positions, padded by 8
  Å at 1 Å spacing, or set with `box`. It stays fixed while coordinates move.
- **Cost.** Direct summation runs at about 2e10 pairs per second on an Apple
  silicon laptop. `maxPairs` (samples × charged atoms, default 2³⁴) refuses
  larger sums and names a spacing that fits.
- **Live updates.** Each coordinate generation recomputes on the GPU, one
  computation at a time. Slices, `volumeSample()` colours, field lines and
  arrows follow live. `<Isosurface>` follows CPU snapshots.
- **Colouring and glyphs.** `byPotential()` colours a surface `sampleOffset` Å
  (default 1.4) off each vertex. `<FieldLines>` and `<FieldArrows>` read E = −∇φ
  from the same grid.

## Attribute channels

`<AttributeProducer>` from `@molgpu/viewer/advanced` computes one `f32` atom or
residue column from a WGSL kernel and makes it available to descendant fields as
`attribute(name, { domain })`. Pass `parameterKey` when kernel parameters change
so its generation advances. `useAttributeSnapshot(name)` subscribes to a
throttled CPU copy for a tooltip or analysis; it returns `null` until the first
readback. The snapshot contains a revised table with the produced column and the
producer generation.

`<GpuDssp><Ribbon secondaryStructure="model" /></GpuDssp>` computes secondary
structure from the nearest GPU coordinate stream. Put it below the coordinate
provider. It publishes `ssCode` to descendant fields and a CPU copy to ribbons
only for the matching coordinate generation. `model` selects one model (the
first by default). An overflow on a live coordinate stream reads one full frame
and reruns CPU DSSP; an overflow on a static `<Structure>` raises
`GpuDsspOverflowError`. Set `overflow` explicitly to override this policy.
`onStatus` reports the bridge count, near-threshold residue count and whether
fallback ran.

## Coordinate consumers

`<Spacefill>` and `<Bonds>` read the nearest GPU coordinate source each draw.
`<Ribbon>`, `<Tube>`, `<Surface>`, `<Label>`, and `<Distance>` rebuild from the
latest `useCoordinateSnapshot()` result. Snapshots are shared below each
provider, default to 4 Hz during motion, and publish once more after a pause.
They are asynchronous; CPU geometry is absent until the first snapshot arrives.
`useCoordinateSelection()` resolves `within` and other position-dependent
queries against that snapshot. Topology-only queries resolve directly against
the root data. Picking keeps atom-row IDs, so its result follows live geometry.
`useCoordinateBounds()` reduces min/max/centroid on the GPU and reads back only
the partials; `useCoordinateFocus()` applies radius and assembly padding for
camera targets. The explicit `focusSelection()` and `useCameraCurve()` APIs
remain CPU resource operations; pass a snapshot resource when using them under a
coordinate provider.

The [coordinate-stream gallery page](../../site/README.md) scrubs a
`WobbleCoordinates > IdentityCoordinates` chain with live atoms and bonds,
snapshot ribbon, and GPU focus.

## Place in the dependency graph

`viewer` is the top of the graph. It depends on `@molgpu/table`, `io`, `select`,
`fields`, `geo` and `timeline`; nothing in the workspace depends on it. It is
the only package that imports `@use-gpu/live`, `@use-gpu/workbench` or
`@use-gpu/shader`, and the only one allowed to expose use.gpu types (from
`./advanced` only). It must not import `molstar` at runtime: Mol* parsing goes
through `@molgpu/io`, which `<Structure src>` loads lazily. Consumers must not
reach into `src/internal`.

## Browser smoke check

The package cannot be imported in Node, so the hardening checker only resolves
its entries. The browser proof is `deno task test:components`
(`test/run-components.mjs`): it typechecks `test/tsx/consumer.tsx` against the
published types, builds it with vite, and drives it in Chrome with WebGPU
(preloaded, empty, sibling, loaded, missing and cancelled structures, with no
uncaptured WebGPU errors). `deno task test:site` additionally checks the project
landing page and maintained demo route.
