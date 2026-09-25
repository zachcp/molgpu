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
npm install @molgpu/viewer @molgpu/table @use-gpu/live@0.20.0 @use-gpu/workbench@0.20.0 @use-gpu/shader@0.20.0 @use-gpu/core@0.20.0
```

### Peer dependencies

The use.gpu packages are peers, pinned exactly (their APIs move between
releases): `@use-gpu/live`, `@use-gpu/workbench`, `@use-gpu/shader` and
`@use-gpu/core`, all `0.20.0`. An application also needs `@use-gpu/webgpu`
(for `<WebGPU>`/`<AutoCanvas>`), and `@use-gpu/glyph` if it uses `<Label>` or
`<Distance>`. `@molgpu/table` is also a peer, so the app and every
`@molgpu/*` package share one copy (structure identity is module-private). The
other `@molgpu/*` packages are regular dependencies.

## Example

```jsx
import { React, render } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera } from '@use-gpu/workbench';
import { Structure, Spacefill, Pass, AmbientLight, DirectionalLight } from '@molgpu/viewer';

render(
  <WebGPU>
    <AutoCanvas selector="#root" samples={4}>
      <OrbitCamera radius={40} target={[10.6, 10.2, 6.1]}>
        <Pass>
          <AmbientLight />
          <DirectionalLight />
          <Structure src="/1crn.bcif">
            <Spacefill material={{ type: 'pbr', roughness: 0.4 }} />
          </Structure>
        </Pass>
      </OrbitCamera>
    </AutoCanvas>
  </WebGPU>,
);
```

Working, runnable examples: the typed consumer
[`test/tsx/consumer.tsx`](test/tsx/consumer.tsx), the gallery in
[`spikes/examples`](../../spikes/examples/README.md) (one page per
representation), and [`spikes/examples/figure.mjs`](../../spikes/examples/figure.mjs),
which composes materials, postprocessing, picking, labels and a timeline camera
on one structure.

## Transparency

Every representation takes `opacity` (0–1), which is multiplied into the
colour's alpha. That works the same whether `color` is a flat colour or a
`@molgpu/fields` Field. When the result is below 1, the representation draws
in transparent mode on its own. Add `oit` to the `<Pass>` so overlapping
translucent geometry composites correctly:

```js
use(Pass, { oit: true, children: use(Structure, { data, children: [
  use(BallAndStick, { color: byElement() }),
  use(Surface, { opacity: 0.3 }),
] }) });
```

`opacity` is a uniform, so animating it never rebuilds or re-uploads geometry.
Pass `mode: 'opaque'` or `mode: 'transparent'` to override the automatic
choice.

## Entries

- **`@molgpu/viewer`** (`.`) carries **no use.gpu types**. Components are typed
  with owned aliases (`ViewerComponent`, `ViewerElement`, `VectorLike`,
  `ColorLike`, and owned prop interfaces for the material, light and pass
  wrappers). Upstream-only props (texture maps, `render` callbacks, a custom
  environment `map`) still forward at runtime but are not typed here.
- **`@molgpu/viewer/advanced`** exposes the use.gpu-shaped escape hatches: shader
  sources, Live contexts and shader-module materials. Its declarations name
  `@use-gpu/*` types directly, so code using it is tied to the pinned use.gpu
  version.

## API

Stability: *stable* — relied on by the examples and settled; *experimental* —
may change before 0.1.0; *advanced* — only from `@molgpu/viewer/advanced`.

| Name | Stability | Description |
| --- | --- | --- |
| `Molecule` | stable | Compositional boundary; owns no canvas or device. |
| `Structure` | stable | Provides one structure (preloaded `data` or loaded `src`) to its subtree. |
| `StructureProps` | stable | `<Structure>` props: preloaded or loaded, mutually exclusive. |
| `PreloadedStructureProps` | stable | `<Structure data>` props. |
| `LoadedStructureProps` | stable | `<Structure src>` props, with `loader`/`loading`/`error`. |
| `StructureLoader` | stable | Cancellable `(src, cancelled) => StructureData` loader. |
| `Spacefill` | stable | Atoms as world-space shaded spheres. |
| `Bonds` | stable | Bonds as world-space sticks. |
| `BallAndStick` | stable | Spacefill balls plus Bonds sticks over one selection. |
| `Tube` | stable | Backbone as a GPU-extruded tube. |
| `Ribbon` | stable | Backbone as an oriented ribbon mesh. |
| `Surface` | stable | Molecular (solvent-excluded) surface. |
| `TimelineProvider` | stable | Provides caller-owned global time in seconds. |
| `ViewerElement` | experimental | Opaque rendered scene element (owned alias). |
| `ViewerComponent` | experimental | A component: `(props) => ViewerElement` (owned alias). |
| `TypedArray` | experimental | Any numeric typed array. |
| `VectorLike` | experimental | Plain or typed numeric vector. |
| `ColorLike` | experimental | Colour as number, vector, `{ rgb }`/`{ rgba }` or CSS string. |
| `BlendMode` | experimental | Blend-mode names for layer and outline options. |
| `Translucency` | stable | `opacity` (0–1, a uniform) and `mode`, shared by every representation. |
| `DrawMode` | stable | `'opaque' \| 'transparent'`; transparent is chosen automatically when colour alpha × opacity < 1. |
| `PointLayerOptions` | experimental | Point-layer flags `<Spacefill>` forwards. |
| `StructureProvider` | experimental | The provider `<Structure>` wraps; prefer `<Structure>`. |
| `StructureResource` | experimental | CPU-side owner of one structure's shared values. |
| `StructureBounds` | experimental | Ångström extent of a structure or selection. |
| `AtomSelection` | experimental | Resource-bound resolved atom set. |
| `createStructureResource` | experimental | Create a StructureResource outside a `<Structure>`. |
| `MaterialType` | experimental | Material `type` names for a `material` spec. |
| `MaterialSpec` | experimental | A representation's `material` prop. |
| `MaterialProps` | experimental | Props shared by the material wrappers. |
| `PBRMaterial` | experimental | PBR material; matte, non-metallic defaults. |
| `PBRMaterialProps` | experimental | `<PBRMaterial>` props. |
| `BasicMaterial` | experimental | Unlit flat colour. |
| `BasicMaterialProps` | experimental | `<BasicMaterial>` props. |
| `NormalMaterial` | experimental | Surface-normal debug material. |
| `NormalMaterialProps` | experimental | `<NormalMaterial>` props. |
| `FresnelMaterialEffect` | experimental | Fresnel rim effect over another material. |
| `FresnelMaterialEffectProps` | experimental | `<FresnelMaterialEffect>` props. |
| `materialTypes` | experimental | The accepted material `type` names. |
| `withMaterial` | experimental | Wrap an element in a material spec. |
| `KEY_LIGHT_DIRECTION` | experimental | Shared world-space key-light direction. |
| `ShadowMapOptions` | experimental | Shadow-map settings for a light. |
| `AmbientLight` | experimental | Soft fill light (intensity 0.3). |
| `AmbientLightProps` | experimental | `<AmbientLight>` props. |
| `DirectionalLight` | experimental | Key light along `KEY_LIGHT_DIRECTION`. |
| `DirectionalLightProps` | experimental | `<DirectionalLight>` props. |
| `PointLight` | experimental | Positioned falloff light. |
| `PointLightProps` | experimental | `<PointLight>` props. |
| `SpotLight` | experimental | Positioned cone light. |
| `SpotLightProps` | experimental | `<SpotLight>` props. |
| `DomeLight` | experimental | Sky/ground gradient dome light. |
| `DomeLightProps` | experimental | `<DomeLight>` props. |
| `Environment` | experimental | Image-based lighting from a named preset. |
| `EnvironmentProps` | experimental | `<Environment>` props. |
| `Pass` | experimental | Scene render pass; lights on by default; ssao/outline/oit. |
| `PassProps` | experimental | `<Pass>` props. |
| `SSAOOptions` | experimental | `<Pass ssao>` options. |
| `OutlineOptions` | experimental | `<Pass outline>` options. |
| `OverscanOptions` | experimental | `<Pass overscan>` options. |
| `PickingProvider` | experimental | Owns the picking registry. |
| `usePicking` | experimental | Hovered and picked atom. |
| `PickHit` | experimental | An atom resolved from a picking hit. |
| `tooltipFields` | experimental | Evaluate fields for one atom, for a tooltip. |
| `Label` | experimental | Text label anchored to a selection centroid. |
| `Distance` | experimental | Line and label between two selection centroids. |
| `centroid` | experimental | Mean atom position of a selection. |
| `useAnnotation` | experimental | Join annotation records onto the structure as a field. |
| `useTimelineTime` | experimental | Current timeline time. |
| `useTimelineSample` | experimental | Sample a curve at the timeline time. |
| `CameraPose` | experimental | Orbit-camera target/radius/bearing/pitch. |
| `CameraFrame` | experimental | Explicit camera keyframe. |
| `FocusCameraFrame` | experimental | Camera keyframe that frames a selection query. |
| `CameraCurve` | experimental | Sequence of camera keyframes. |
| `FocusOptions` | experimental | Framing options for focusing a selection. |
| `FocusResult` | experimental | Target, radius and bounds from `focusSelection`. |
| `focusSelection` | experimental | Frame a selection query on a resource. |
| `createCameraCurve` | experimental | Validate camera keyframes. |
| `sampleCamera` | experimental | Sample a camera curve at a time. |
| `useCameraCurve` | experimental | Sample a camera curve at the timeline time. |
| `ViewScale` | experimental | Pixel/view/world scale for size conversion. |
| `pointSizeForRadius` | experimental | Ångström radius to PointLayer size. |
| `pointSizeForCameraRadius` | experimental | Ångström radius to size for a camera. |
| `pointSizesForRadii` | experimental | Batch `pointSizeForRadius`. |
| `lineRadiusForWidth` | experimental | World radius of a shaded LineLayer stroke. |
| `GridBudget` | experimental | Grid byte budget options. |
| `assertGridBudget` | experimental | Throw before allocating an oversize grid. |
| `geometryDeps` | experimental | Geometry-only dependency key for a resource. |
| `copyOwned` | experimental | Copy a typed array the caller will own. |
| `runGeometryJob` | experimental | Run a cancellable geometry kernel. |
| `useGeometryJob` | experimental | Schedule a cancellable geometry build. |
| `StructureContext` | advanced | Live context carrying the nearest structure's resource and sources. |
| `StructureContextValue` | advanced | `{ resource, sources }` from the structure context. |
| `StructureSources` | advanced | Shared positions/radii shader sources. |
| `useStructure` | advanced | Read the nearest `<Structure>`'s resource and sources. |
| `TimelineContext` | advanced | Live context carrying timeline time. |
| `FlatMaterial` | advanced | Custom unlit fragment-shader material. |
| `LitMaterial` | advanced | Custom lit shader material. |
| `WorldSpacePointLayer` | advanced | PointLayer with Ångström radii over shader sources. |
| `useField` | advanced | Lower a field to a use.gpu shader source. |

## Place in the dependency graph

`viewer` is the top of the graph. It depends on `@molgpu/table`, `io`, `select`,
`fields`, `geo` and `timeline`; nothing in the workspace depends on it. It is the
only package that imports `@use-gpu/live`, `@use-gpu/workbench` or
`@use-gpu/shader`, and the only one allowed to expose use.gpu types (from
`./advanced` only). It must not import `molstar` at runtime: Mol* parsing goes
through `@molgpu/io`, which `<Structure src>` loads lazily. Consumers must not
reach into `src/internal`.

## Browser smoke check

The package cannot be imported in Node, so the hardening checker only resolves
its entries. The browser proof is `npm run test:components`
(`test/run-components.mjs`): it typechecks `test/tsx/consumer.tsx` against the
published types, builds it with vite, and drives it in Chrome with WebGPU
(preloaded, empty, sibling, loaded, missing and cancelled structures, with no
uncaptured WebGPU errors). `npm run test:examples` additionally renders every
gallery page in `spikes/examples`.
