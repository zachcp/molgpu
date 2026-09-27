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

| Name                         | Stability    | Description                                                                                                                                                                                        |
| ---------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Molecule`                   | stable       | Compositional boundary; owns no canvas or device.                                                                                                                                                  |
| `Structure`                  | stable       | Provides one structure (preloaded `data` or loaded `src`) to its subtree.                                                                                                                          |
| `StructureProps`             | stable       | `<Structure>` props: preloaded or loaded, mutually exclusive.                                                                                                                                      |
| `PreloadedStructureProps`    | stable       | `<Structure data>` props.                                                                                                                                                                          |
| `LoadedStructureProps`       | stable       | `<Structure src>` props, with `loader`/`loading`/`error`.                                                                                                                                          |
| `StructureLoader`            | stable       | Cancellable `(src, cancelled) => StructureData` loader.                                                                                                                                            |
| `Spacefill`                  | stable       | Atoms as world-space shaded spheres.                                                                                                                                                               |
| `Bonds`                      | stable       | Bonds as world-space sticks; vertex positions follow the nearest coordinate provider.                                                                                                              |
| `BallAndStick`               | stable       | Spacefill balls plus Bonds sticks over one selection.                                                                                                                                              |
| `Tube`                       | stable       | Backbone as a GPU-extruded tube.                                                                                                                                                                   |
| `Ribbon`                     | stable       | Backbone as an oriented ribbon mesh.                                                                                                                                                               |
| `Surface`                    | stable       | Molecular (solvent-excluded) surface.                                                                                                                                                              |
| `Volume`                     | experimental | Own one scalar volume (`data` or CCP4/MRC `src`); one shared GPU copy per volume identity.                                                                                                         |
| `VolumeProps`                | experimental | `<Volume>` props: `data` or `src`, with `loader`/`loading`/`error`.                                                                                                                                |
| `VolumeLoader`               | experimental | Cancellable `(src, cancelled) => VolumeData` loader.                                                                                                                                               |
| `Isosurface`                 | experimental | CPU marching-cubes isosurface of the nearest `<Volume>` at an absolute or sigma `level`.                                                                                                           |
| `VolumeSlice`                | experimental | Per-fragment planar cross-section of the nearest `<Volume>` through a colour ramp.                                                                                                                 |
| `Trajectory`                 | experimental | Coordinate provider that plays a `TrajectoryData` (`data`) or a DCD/XTC/TRR URL (`src`) over the nearest coordinates; `frame` is a number or timeline curve; `interpolate`, `pbc="minimum-image"`. |
| `useTrajectoryFrame`         | experimental | What the nearest `<Trajectory>` shows: requested frame, displayed pair, interpolated box; null outside one.                                                                                        |
| `UnitCell`                   | experimental | Lines along the displayed frame's periodic box.                                                                                                                                                    |
| `TrajectoryProps`            | experimental | `PreloadedTrajectoryProps                                                                                                                                                                          |
| `PreloadedTrajectoryProps`   | experimental | `<Trajectory data>` props.                                                                                                                                                                         |
| `LoadedTrajectoryProps`      | experimental | `<Trajectory src>` props, with an optional `loader`.                                                                                                                                               |
| `TrajectoryPlayback`         | experimental | Props shared by both `<Trajectory>` forms: `frame`, `interpolate`, `pbc`, `children`.                                                                                                              |
| `TrajectoryLoader`           | experimental | Cancellable `(src, cancelled) => TrajectoryData` loader.                                                                                                                                           |
| `TrajectoryFrameState`       | experimental | Return type of `useTrajectoryFrame`.                                                                                                                                                               |
| `SlicePlane`                 | experimental | A grid plane `{ axis, index }` or a world plane `{ normal, point }`.                                                                                                                               |
| `SliceStops`                 | experimental | `[t, color]` stops over 0–1 for `<VolumeSlice>`.                                                                                                                                                   |
| `TimelineProvider`           | stable       | Provides caller-owned global time in seconds.                                                                                                                                                      |
| `ViewerElement`              | experimental | Opaque rendered scene element (owned alias).                                                                                                                                                       |
| `ViewerComponent`            | experimental | A component: `(props) => ViewerElement` (owned alias).                                                                                                                                             |
| `TypedArray`                 | experimental | Any numeric typed array.                                                                                                                                                                           |
| `VectorLike`                 | experimental | Plain or typed numeric vector.                                                                                                                                                                     |
| `ColorLike`                  | experimental | Colour as number, vector, `{ rgb }`/`{ rgba }` or CSS string.                                                                                                                                      |
| `BlendMode`                  | experimental | Blend-mode names for layer and outline options.                                                                                                                                                    |
| `Translucency`               | stable       | `opacity` (0–1, a uniform) and `mode`, shared by every representation.                                                                                                                             |
| `DrawMode`                   | stable       | `'opaque' \| 'transparent'`; transparent is chosen automatically when colour alpha × opacity < 1.                                                                                                  |
| `PointLayerOptions`          | experimental | Point-layer flags `<Spacefill>` forwards.                                                                                                                                                          |
| `StructureResource`          | experimental | CPU-side owner of one structure's shared values.                                                                                                                                                   |
| `StructureBounds`            | experimental | Ångström extent of a structure or selection.                                                                                                                                                       |
| `createStructureResource`    | experimental | Create a StructureResource outside a `<Structure>`.                                                                                                                                                |
| `useStructureResource`       | experimental | The nearest `<Structure>`'s `StructureResource`, for `focusSelection` and other resource-taking APIs.                                                                                              |
| `useCoordinateSnapshot`      | experimental | Shared, throttled CPU positions below a GPU provider; `null` until first readback.                                                                                                                 |
| `CoordinateSnapshot`         | experimental | Published structure data, revisioned resource and source generation.                                                                                                                               |
| `useCoordinateSelection`     | experimental | Re-resolve position-dependent queries against a published snapshot.                                                                                                                                |
| `useCoordinateBounds`        | experimental | Asynchronous GPU bounds and centroid of the nearest stream.                                                                                                                                        |
| `CoordinateBounds`           | experimental | GPU-reduced min, max, centroid, count and generation.                                                                                                                                              |
| `useCoordinateFocus`         | experimental | Nonblocking selection focus from GPU bounds; starts with root framing.                                                                                                                             |
| `MaterialType`               | experimental | Material `type` names for a `material` spec.                                                                                                                                                       |
| `MaterialSpec`               | experimental | A representation's `material` prop.                                                                                                                                                                |
| `MaterialProps`              | experimental | Props shared by the material wrappers.                                                                                                                                                             |
| `PBRMaterial`                | experimental | PBR material; matte, non-metallic defaults.                                                                                                                                                        |
| `PBRMaterialProps`           | experimental | `<PBRMaterial>` props.                                                                                                                                                                             |
| `BasicMaterial`              | experimental | Unlit flat colour.                                                                                                                                                                                 |
| `BasicMaterialProps`         | experimental | `<BasicMaterial>` props.                                                                                                                                                                           |
| `NormalMaterial`             | experimental | Surface-normal debug material.                                                                                                                                                                     |
| `NormalMaterialProps`        | experimental | `<NormalMaterial>` props.                                                                                                                                                                          |
| `FresnelMaterialEffect`      | experimental | Fresnel rim effect over another material.                                                                                                                                                          |
| `FresnelMaterialEffectProps` | experimental | `<FresnelMaterialEffect>` props.                                                                                                                                                                   |
| `materialTypes`              | experimental | The accepted material `type` names.                                                                                                                                                                |
| `withMaterial`               | experimental | Wrap an element in a material spec.                                                                                                                                                                |
| `KEY_LIGHT_DIRECTION`        | experimental | Shared world-space key-light direction.                                                                                                                                                            |
| `ShadowMapOptions`           | experimental | Shadow-map settings for a light.                                                                                                                                                                   |
| `AmbientLight`               | experimental | Soft fill light (intensity 0.3).                                                                                                                                                                   |
| `AmbientLightProps`          | experimental | `<AmbientLight>` props.                                                                                                                                                                            |
| `DirectionalLight`           | experimental | Key light along `KEY_LIGHT_DIRECTION`.                                                                                                                                                             |
| `DirectionalLightProps`      | experimental | `<DirectionalLight>` props.                                                                                                                                                                        |
| `PointLight`                 | experimental | Positioned falloff light.                                                                                                                                                                          |
| `PointLightProps`            | experimental | `<PointLight>` props.                                                                                                                                                                              |
| `SpotLight`                  | experimental | Positioned cone light.                                                                                                                                                                             |
| `SpotLightProps`             | experimental | `<SpotLight>` props.                                                                                                                                                                               |
| `DomeLight`                  | experimental | Sky/ground gradient dome light.                                                                                                                                                                    |
| `DomeLightProps`             | experimental | `<DomeLight>` props.                                                                                                                                                                               |
| `Environment`                | experimental | Image-based lighting from a named preset.                                                                                                                                                          |
| `EnvironmentProps`           | experimental | `<Environment>` props.                                                                                                                                                                             |
| `Pass`                       | experimental | Scene render pass; lights on by default; ssao/outline/oit.                                                                                                                                         |
| `PassProps`                  | experimental | `<Pass>` props.                                                                                                                                                                                    |
| `SSAOOptions`                | experimental | `<Pass ssao>` options.                                                                                                                                                                             |
| `OutlineOptions`             | experimental | `<Pass outline>` options.                                                                                                                                                                          |
| `OverscanOptions`            | experimental | `<Pass overscan>` options.                                                                                                                                                                         |
| `PickingProvider`            | experimental | Owns the picking registry.                                                                                                                                                                         |
| `usePicking`                 | experimental | Hovered and picked atom.                                                                                                                                                                           |
| `PickHit`                    | experimental | An atom resolved from a picking hit.                                                                                                                                                               |
| `tooltipFields`              | experimental | Evaluate fields for one atom, for a tooltip.                                                                                                                                                       |
| `Label`                      | experimental | Text label anchored to a selection centroid.                                                                                                                                                       |
| `Distance`                   | experimental | Line and label between two selection centroids.                                                                                                                                                    |
| `centroid`                   | experimental | Mean atom position of a selection.                                                                                                                                                                 |
| `useAnnotation`              | experimental | Join annotation records onto the structure as a field.                                                                                                                                             |
| `useTimelineTime`            | experimental | Current timeline time.                                                                                                                                                                             |
| `useTimelineSample`          | experimental | Sample a curve at the timeline time.                                                                                                                                                               |
| `CameraPose`                 | experimental | Orbit-camera target/radius/bearing/pitch.                                                                                                                                                          |
| `CameraFrame`                | experimental | Explicit camera keyframe.                                                                                                                                                                          |
| `FocusCameraFrame`           | experimental | Camera keyframe that frames a selection query.                                                                                                                                                     |
| `CameraCurve`                | experimental | Sequence of camera keyframes.                                                                                                                                                                      |
| `FocusOptions`               | experimental | Framing options for focusing a selection.                                                                                                                                                          |
| `FocusResult`                | experimental | Target, radius and bounds from `focusSelection`.                                                                                                                                                   |
| `focusSelection`             | experimental | Frame a selection query on a resource.                                                                                                                                                             |
| `createCameraCurve`          | experimental | Validate camera keyframes.                                                                                                                                                                         |
| `sampleCamera`               | experimental | Sample a camera curve at a time.                                                                                                                                                                   |
| `useCameraCurve`             | experimental | Sample a camera curve at the timeline time.                                                                                                                                                        |
| `StructureContext`           | advanced     | Live context carrying the nearest structure's resource and sources.                                                                                                                                |
| `StructureContextValue`      | advanced     | `{ resource, sources }` from the structure context.                                                                                                                                                |
| `StructureSources`           | advanced     | Shared positions/radii shader sources.                                                                                                                                                             |
| `useStructure`               | advanced     | Read the nearest `<Structure>`'s resource and sources.                                                                                                                                             |
| `CoordinatesContext`         | advanced     | Live context carrying the nearest GPU coordinate stream.                                                                                                                                           |
| `Coordinates`                | advanced     | GPU positions source, atom count, content generation and owning resource.                                                                                                                          |
| `useCoordinates`             | advanced     | Read the nearest coordinate stream; an empty structure returns null.                                                                                                                               |
| `IdentityCoordinates`        | advanced     | Forward the nearest coordinates without allocating a GPU buffer.                                                                                                                                   |
| `WobbleCoordinates`          | advanced     | Example GPU coordinate transform driven by a phase and amplitude.                                                                                                                                  |
| `TimelineContext`            | advanced     | Live context carrying timeline time.                                                                                                                                                               |
| `TrajectoryContext`          | advanced     | Live context carrying the nearest `<Trajectory>` state.                                                                                                                                            |
| `VolumeContext`              | advanced     | Live context carrying the nearest `<Volume>`'s data and GPU samples.                                                                                                                               |
| `VolumeContextValue`         | advanced     | `{ volume, source }` from the volume context.                                                                                                                                                      |
| `useVolume`                  | advanced     | Read the nearest `<Volume>`; throws without one.                                                                                                                                                   |
| `FlatMaterial`               | advanced     | Custom unlit fragment-shader material.                                                                                                                                                             |
| `LitMaterial`                | advanced     | Custom lit shader material.                                                                                                                                                                        |
| `WorldSpacePointLayer`       | advanced     | PointLayer with GPU radii source and Ångström size conversion in a shader.                                                                                                                         |
| `useField`                   | advanced     | Lower a field to a use.gpu shader source.                                                                                                                                                          |

## Volumes

`<Volume>` sits beside `<Structure>`, not inside it: a structure never owns a
volume. Its samples upload once per `VolumeData` identity to a GPU buffer that
`<Isosurface>`, `<VolumeSlice>` and any `volumeSample` field share; the last
consumer to unmount destroys it. `<Isosurface>` meshes on the CPU through the
volume's full index-to-world affine and remeshes only when the volume or the
resolved level changes. `<VolumeSlice>` samples per fragment, so moving its
plane, range or opacity updates uniforms only. Colour atoms from a map with
`color={colormap(volumeSample(map), stops)}`: the field reads the atoms'
positions and the shared samples, with no per-atom colour upload.

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
