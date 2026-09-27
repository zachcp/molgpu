# @molgpu/viewer

use.gpu Live components for molecular scenes. A `<Structure>` owns one
structure's CPU resource and its shared GPU columns; representations beneath it
(`<Spacefill>`, `<Bonds>`, `<BallAndStick>`, `<Tube>`, `<Ribbon>`, `<Surface>`)
draw it, coloured by flat colours or `@molgpu/fields` fields and restricted by
`@molgpu/select` selections. The package also provides picking, anchored labels
and timeline-driven cameras. It never owns a canvas, GPU device, camera, pass or
lights: those come from `@use-gpu/webgpu` and `@use-gpu/workbench`, and
everything here composes inside that caller-owned scene. It runs in a browser
with WebGPU only.

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
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
} from "@use-gpu/workbench";
import { Spacefill, Structure } from "@molgpu/viewer";

render(
  <WebGPU>
    <AutoCanvas selector="#root" samples={4}>
      <OrbitCamera radius={40} target={[10.6, 10.2, 6.1]}>
        <Pass lights>
          <AmbientLight intensity={0.3} />
          <DirectionalLight direction={[-1, -2, -1.5]} />
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
transparent mode on its own. Add `oit` to the workbench `<Pass>` so overlapping
translucent geometry composites correctly:

```js
use(Pass, {
  lights: true,
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
  with owned aliases (`ViewerComponent`, `ViewerElement`, `VectorLike`). A
  representation's `material` prop takes a spec
  (`{ type: "pbr" | "basic" | "normal", ...props }`, PBR by default with matte,
  non-metallic defaults) or a `(children) => element` function that wraps the
  representation in any workbench material, including shader materials.
- **`@molgpu/viewer/advanced`** holds the escape hatches for custom
  representations and providers: CPU coordinate, volume and attribute snapshots,
  the structure resource, GPU bounds, and use.gpu-shaped exports (shader
  sources, Live contexts, coordinate providers). Declarations that name
  `@use-gpu/*` types tie code using them to the pinned use.gpu version.

## API

Stability: _stable_ — relied on by the examples and settled; _experimental_ —
may change before 0.1.0; _advanced_ — only from `@molgpu/viewer/advanced`.

| Name                      | Stability    | Description                                                                                                                                                                                                             |
| ------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Structure`               | stable       | Provides one structure (preloaded `data` or loaded `src`) to its subtree.                                                                                                                                               |
| `StructureProps`          | stable       | `<Structure>` props: preloaded `data` or loaded `src` (with `loader`/`loading`/`error`), mutually exclusive.                                                                                                            |
| `StructureLoader`         | stable       | Cancellable `(src, cancelled) => StructureData` loader.                                                                                                                                                                 |
| `Spacefill`               | stable       | Atoms as world-space shaded spheres.                                                                                                                                                                                    |
| `Bonds`                   | stable       | Bonds as world-space sticks; vertex positions follow the nearest coordinate provider.                                                                                                                                   |
| `BallAndStick`            | stable       | Spacefill balls plus Bonds sticks over one selection.                                                                                                                                                                   |
| `Tube`                    | stable       | Backbone as a GPU-extruded tube.                                                                                                                                                                                        |
| `Ribbon`                  | stable       | Oriented backbone ribbon with widened, pointed beta-sheet ends.                                                                                                                                                         |
| `GpuDssp`                 | experimental | Computes DSSP from the nearest GPU coordinate stream for one model and publishes generation-tagged `ssCode` to descendant fields and ribbons.                                                                           |
| `Surface`                 | stable       | Molecular (solvent-excluded) surface.                                                                                                                                                                                   |
| `Volume`                  | experimental | Own one scalar volume (`data` or CCP4/MRC `src`); one shared GPU copy per volume identity.                                                                                                                              |
| `VolumeProps`             | experimental | `<Volume>` props: `data` or `src`, with `loader`/`loading`/`error`.                                                                                                                                                     |
| `VolumeLoader`            | experimental | Cancellable `(src, cancelled) => VolumeData` loader.                                                                                                                                                                    |
| `Isosurface`              | experimental | CPU marching-cubes isosurface of the nearest `<Volume>` at an absolute or sigma `level`.                                                                                                                                |
| `VolumeSlice`             | experimental | Per-fragment planar cross-section of the nearest `<Volume>` through a colour ramp.                                                                                                                                      |
| `EField`                  | experimental | GPU Coulomb potential (vacuum, ε = 4r or Debye–Hückel) of the nearest coordinates and a charge column, provided as a live Volume in kT/e.                                                                               |
| `EFieldProps`             | experimental | `<EField>` props: selection, charge column, dielectric model, grid and budgets.                                                                                                                                         |
| `FieldLines`              | experimental | RK4 streamlines of E = −∇φ through the nearest volume, integrated on the GPU per volume generation.                                                                                                                     |
| `FieldArrows`             | experimental | E = −∇φ arrows on a lattice in a slice plane; moving the plane is a uniform write.                                                                                                                                      |
| `Trajectory`              | experimental | Coordinate provider that plays a `TrajectoryData` (`data`) or a DCD/XTC/TRR URL (`src`) over the nearest coordinates; `frame` is a number or timeline curve; `interpolate`, `pbc="minimum-image"`.                      |
| `Transform`               | experimental | Coordinate provider applying a column-major 4×4 affine matrix (or vector curve) to all atoms or `select` rows. Other rows pass through.                                                                                 |
| `TransformProps`          | experimental | Matrix, optional atom selection, and children for `<Transform>`.                                                                                                                                                        |
| `Superpose`               | experimental | Coordinate provider fitting the nearest coordinates onto a reference (`to`: array, structure, or `"first"` trajectory frame) by a GPU Kabsch fit; `select` picks fit atoms and every atom moves.                        |
| `SuperposeProps`          | experimental | Reference, optional fit selection, `translate`, asynchronous `onStatus`, and children for `<Superpose>`.                                                                                                                |
| `SuperposeStatus`         | experimental | Solved or collinear passthrough, fitted RMSD when solved, and coordinate generation.                                                                                                                                    |
| `Unwrap`                  | experimental | Coordinate provider making covalent components whole on the displayed periodic frame (GPU pointer jumping over a covalent forest); `box` defaults to the trajectory's, `center` moves components into the primary cell. |
| `UnwrapProps`             | experimental | Box, optional center selection, `onStatus`, and children for `<Unwrap>`.                                                                                                                                                |
| `UnwrapStatus`            | experimental | `ok`, `ambiguous` (ring edges that do not close), `search-limit`, `missing-box` or `invalid-box`, with a generation.                                                                                                    |
| `NormalMode`              | experimental | Add a precomputed guide-node mode to nearest upstream coordinates; animation changes a scalar uniform.                                                                                                                  |
| `NormalModeProps`         | experimental | Mode vectors/mapping, amplitude, frequency, phase, and children.                                                                                                                                                        |
| `useTrajectoryFrame`      | experimental | What the nearest `<Trajectory>` shows: requested frame, displayed pair, interpolated box; null outside one.                                                                                                             |
| `UnitCell`                | experimental | Lines along the displayed frame's periodic box.                                                                                                                                                                         |
| `TrajectoryProps`         | experimental | `<Trajectory>` props: `frame`, `interpolate`, `pbc`, plus exactly one of `data` or `src` (with an optional `loader`).                                                                                                   |
| `TrajectoryLoader`        | experimental | Cancellable `(src, cancelled) => TrajectoryData` loader.                                                                                                                                                                |
| `TrajectoryFrameState`    | experimental | Return type of `useTrajectoryFrame`.                                                                                                                                                                                    |
| `SlicePlane`              | experimental | A grid plane `{ axis, index }` or a world plane `{ normal, point }`.                                                                                                                                                    |
| `ColorStops`              | experimental | RGBA colour stops over a normalised 0–1 range, shared with `<VolumeSlice>`.                                                                                                                                             |
| `SliceStops`              | experimental | `[t, color]` stops over 0–1 for `<VolumeSlice>`.                                                                                                                                                                        |
| `TimelineProvider`        | stable       | Provides caller-owned global time in seconds.                                                                                                                                                                           |
| `ViewerElement`           | experimental | Opaque rendered scene element (owned alias).                                                                                                                                                                            |
| `ViewerComponent`         | experimental | A component: `(props) => ViewerElement` (owned alias).                                                                                                                                                                  |
| `VectorLike`              | experimental | Plain or typed numeric vector; the flat-colour type of every representation.                                                                                                                                            |
| `BlendMode`               | experimental | Blend-mode names for `<Spacefill>` point-layer options.                                                                                                                                                                 |
| `Translucency`            | stable       | `opacity` (0–1, a uniform) and `mode`, shared by every representation.                                                                                                                                                  |
| `DrawMode`                | stable       | `'opaque' \| 'transparent'`; transparent is chosen automatically when colour alpha × opacity < 1.                                                                                                                       |
| `PointLayerOptions`       | experimental | Point-layer flags `<Spacefill>` forwards.                                                                                                                                                                               |
| `useCoordinateFocus`      | experimental | Nonblocking selection focus from GPU bounds; starts with root framing.                                                                                                                                                  |
| `MaterialType`            | experimental | `pbr`, `basic` or `normal`: the `type` of a `material` spec.                                                                                                                                                            |
| `MaterialSpec`            | experimental | A representation's `material` prop.                                                                                                                                                                                     |
| `PickingProvider`         | experimental | Owns the picking registry.                                                                                                                                                                                              |
| `usePicking`              | experimental | Hovered and picked atom.                                                                                                                                                                                                |
| `PickHit`                 | experimental | An atom resolved from a picking hit.                                                                                                                                                                                    |
| `Label`                   | experimental | Text label anchored to a selection centroid.                                                                                                                                                                            |
| `Distance`                | experimental | Line and label between two selection centroids.                                                                                                                                                                         |
| `CameraPose`              | experimental | Orbit-camera target/radius/bearing/pitch.                                                                                                                                                                               |
| `CameraFrame`             | experimental | Explicit camera keyframe.                                                                                                                                                                                               |
| `FocusCameraFrame`        | experimental | Camera keyframe that frames a selection query.                                                                                                                                                                          |
| `CameraCurve`             | experimental | Sequence of camera keyframes.                                                                                                                                                                                           |
| `FocusOptions`            | experimental | Framing options for focusing a selection.                                                                                                                                                                               |
| `FocusResult`             | experimental | Target, radius and bounds from `useCoordinateFocus`.                                                                                                                                                                    |
| `useCameraCurve`          | experimental | Sample a camera curve at the timeline time.                                                                                                                                                                             |
| `StructureResource`       | advanced     | CPU-side owner of one structure's shared values.                                                                                                                                                                        |
| `StructureBounds`         | advanced     | Ångström extent of a structure or selection.                                                                                                                                                                            |
| `createStructureResource` | advanced     | Create a StructureResource outside a `<Structure>`.                                                                                                                                                                     |
| `useStructureResource`    | advanced     | The nearest `<Structure>`'s `StructureResource`, for `useCameraCurve` and other resource-taking APIs.                                                                                                                   |
| `useCoordinateSnapshot`   | advanced     | Shared, throttled CPU positions below a GPU provider; `null` until first readback.                                                                                                                                      |
| `useVolumeSnapshot`       | advanced     | CPU samples of the nearest volume: at once for `<Volume>`, throttled readback for a computed one.                                                                                                                       |
| `CoordinateSnapshot`      | advanced     | Published structure data, revisioned resource and source generation.                                                                                                                                                    |
| `useCoordinateSelection`  | advanced     | Re-resolve position-dependent queries against a published snapshot.                                                                                                                                                     |
| `useCoordinateBounds`     | advanced     | Asynchronous GPU bounds and centroid of the nearest stream.                                                                                                                                                             |
| `CoordinateBounds`        | advanced     | GPU-reduced min, max, centroid, count and generation.                                                                                                                                                                   |
| `useTimelineTime`         | advanced     | Current timeline time.                                                                                                                                                                                                  |
| `useAttributeSnapshot`    | advanced     | Demand-driven CPU copy of a GPU-produced attribute, with its source generation.                                                                                                                                         |
| `AttributeSnapshot`       | advanced     | Published structure data and attribute producer generation.                                                                                                                                                             |
| `CoordinateKernel`        | advanced     | Write a GPU coordinate transform: run a WGSL kernel over the upstream positions and publish the owned output with generations and snapshots.                                                                            |
| `CoordinateKernelProps`   | advanced     | Upstream coordinates, WGSL module, args, extra storage sources, `parameterKey` and children.                                                                                                                            |
| `NearestStructure`        | advanced     | `{ resource, sources }` returned by `useStructure`.                                                                                                                                                                     |
| `NearestVolume`           | advanced     | Grid, GPU samples, generation, display range and CPU snapshot access returned by `useVolume`.                                                                                                                           |
| `StructureSources`        | advanced     | Shared positions/radii shader sources.                                                                                                                                                                                  |
| `useStructure`            | advanced     | Read the nearest `<Structure>`'s resource and sources.                                                                                                                                                                  |
| `AttributeProducer`       | advanced     | Compute a live scalar or code column for descendant fields.                                                                                                                                                             |
| `Coordinates`             | advanced     | GPU positions source, atom count, opaque content generation, `ready` and owning resource.                                                                                                                               |
| `useCoordinates`          | advanced     | Read the nearest coordinate stream; an empty structure returns null.                                                                                                                                                    |
| `useVolume`               | advanced     | Read the nearest `<Volume>` or `<EField>`; throws without one.                                                                                                                                                          |
| `WorldSpacePointLayer`    | advanced     | PointLayer with GPU radii source and Ångström size conversion in a shader.                                                                                                                                              |
| `useField`                | advanced     | Lower a field to a use.gpu shader source.                                                                                                                                                                               |

| Export                 | Stability    | Purpose                                                                      |
| ---------------------- | ------------ | ---------------------------------------------------------------------------- |
| `GpuDsspProps`         | experimental | Model, overflow policy, status callback and children.                        |
| `GpuDsspStatus`        | experimental | Generation, directly flagged threshold centres, bridges and fallback reason. |
| `GpuDsspOverflowError` | experimental | Named static-path error for bounded GPU work.                                |

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
- **Grid.** The grid is placed around selected atoms with nonzero CPU charges,
  padded by 8 Å at 1 Å spacing, or set with `box`. GPU-produced charges use all
  selected active atoms for bounds. It stays fixed while coordinates move.
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
provider. It is opt-in and experimental; CPU DSSP on throttled snapshots remains
the default. It publishes `ssCode` to descendant fields and a CPU copy to
ribbons. During playback, the most recent GPU codes remain visible for up to one
second while the next generation runs. Only one run is in flight, and a pending
run uses the latest generation. `model` selects one model (the first by
default). An overflow on a live coordinate stream reads one full frozen frame
and reruns CPU DSSP; an overflow on a static `<Structure>` raises
`GpuDsspOverflowError`. Set `overflow` explicitly to override this policy.
`onStatus` reports the bridge count, direct near-threshold acceptor and bend
centres (excluding dependent residues), and the fallback reason if any.

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
camera targets. `useCameraCurve()` remains a CPU resource operation; pass a
snapshot resource when using it under a coordinate provider. The snapshot,
selection and bounds hooks are on `@molgpu/viewer/advanced`.

The [coordinate-stream gallery page](../../site/README.md) scrubs a wobble
transform with live atoms and bonds, snapshot ribbon, and GPU focus.

## Authoring a coordinate provider

`<CoordinateKernel>` from `@molgpu/viewer/advanced` is the supported way to
write a GPU coordinate transform. Give it the upstream coordinates
(`useCoordinates()`), a WGSL compute module and its `args`, and a `parameterKey`
that changes whenever the args change the output. It owns one packed output
buffer (destroyed on unmount), advances the published generation per dispatch,
reports `ready: false` until the first dispatch lands, and publishes CPU
snapshots to descendants. The kernel links `getSize()`, one getter per arg, one
per extra `sources` entry, then `getInput(i) -> vec3<f32>`, and writes
`output[i * 3u + k]`.
[`site/src/demos/coordinates.ts`](../../site/src/demos/coordinates.ts) is a
complete example.

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
