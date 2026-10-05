# @molgpu/viewer

use.gpu Live components for molecular scenes. A `<Structure>` owns one
structure's CPU resource and its shared GPU columns; representations beneath it
(`<Spacefill>`, `<Bonds>`, `<BallAndStick>`, `<Tube>`, `<Ribbon>`, `<Cartoon>`,
`<Surface>`) draw it, coloured by flat colours or `@molgpu/fields` fields and
restricted by `@molgpu/select` selections. The package also provides picking,
anchored labels and timeline-driven cameras. It never owns a canvas, GPU device,
camera, pass or lights: those come from `@use-gpu/webgpu` and
`@use-gpu/workbench`, and everything here composes inside that caller-owned
scene. It runs in a browser with WebGPU only.

## Install

```sh
deno add jsr:@molgpu/viewer jsr:@molgpu/table npm:@use-gpu/live@0.20.0 npm:@use-gpu/webgpu@0.20.0 npm:@use-gpu/workbench@0.20.0 npm:@use-gpu/shader@0.20.0 npm:@use-gpu/core@0.20.0
```

### Dependency resolution

The use.gpu packages are exact npm dependencies, all `0.20.0`. Match that
version in the application, including `@use-gpu/webgpu` for
`<WebGPU>`/`<AutoCanvas>` and `@use-gpu/glyph` for `<Label>` or `<Distance>`.
Multiple Live copies do not share contexts and can cause type or runtime
failures.

JSR publishes internal dependencies as caret ranges (for example,
`jsr:@molgpu/table@^0.2.0`). Keep compatible versions so the application
resolves one shared copy: identity and revision state are module-private. Values
from divergent copies can be rejected by identity-dependent operations. Use
`deno info` and the lockfile to find duplicate versions, then align the
application and package dependency ranges.

Bundle the viewer for the browser (for example, with Vite or `deno bundle`).
Direct execution under Deno cannot link the pinned workbench's CommonJS entry:
its re-exports do not expose `LoopContext` to Deno. Bundlers resolve the ESM
`module` entry. Public entries still type-check under Deno.

## Example

Create an HTML element with `id="root"` and serve a BinaryCIF file at
`/1crn.bcif`. Use the classic JSX transform with `React.createElement` from
`@use-gpu/live` (imported below), then bundle and serve the application.

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
  <WebGPU fallback={null}>
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

Working examples: the
[typed consumer](https://github.com/zachcp/molgpu/blob/main/packages/viewer/test/tsx/consumer.tsx)
and the project
[site examples](https://github.com/zachcp/molgpu/blob/main/site/README.md),
whose maintained TSX demo composes public viewer components under an
application-owned render tree.

## Default view and selections

A structure can retain several models and alternate conformers. Without a
`select`, every molecular consumer (`<Spacefill>`, `<Bonds>`, `<Tube>`,
`<Ribbon>`, `<Surface>`, `<EField>`, `<Label>` anchors and empty-focus
fallbacks) uses one default view: the first model, with each residue's primary
(highest-occupancy) conformer, as `activeAtoms` returns it. `select` is the one
override and is taken exactly. It can reach another model or every conformer,
for example `select={model(2)}`, and it is never intersected with the default
view. An empty selection draws nothing; a missing or `null` selection is the
default view, never every retained row. Coordinate providers (`<Transform>`,
`<Superpose>`, and so on) move every row, and their `select` chooses the
transformed or fitted rows. `<GpuDssp>` takes its own `model`, defaulting to the
first model. The resource's `bounds` cover every retained row.

See [Query selections in JSX](#query-selections-in-jsx) for reusable queries and
selection status callbacks.

## Transparency

Every representation takes `opacity` (0–1), which is multiplied into the
colour's alpha, for both flat colours and `@molgpu/fields` Fields. Automatic
transparent mode considers the flat colour alpha and the `opacity` prop. It does
not inspect per-row Field alpha or alpha introduced by a material wrapper: use
`mode="transparent"` for those translucent inputs. This limitation is tracked by
`molgpu-sept-0vs.8`. Add `oit` to the workbench `<Pass>` so overlapping
translucent geometry composites correctly:

```tsx
import { byElement } from "@molgpu/fields";
import { BallAndStick, Structure, Surface } from "@molgpu/viewer";
import { Pass } from "@use-gpu/workbench";

// Inside the application-owned WebGPU, canvas and camera:
<Pass lights oit>
  <Structure src="/1crn.bcif">
    <BallAndStick color={byElement()} />
    <Surface opacity={0.3} />
  </Structure>
</Pass>;
```

`opacity` is a uniform, so animating it never rebuilds or re-uploads geometry.
Pass `mode: 'opaque'` or `mode: 'transparent'` to override the automatic choice.

### Scoped trajectory metadata

`<Trajectory>` publishes its displayed frame and periodic box only within its
own `<Structure>`. A nested `<Structure>` starts without trajectory metadata,
even if it has the same atom count; a sibling structure also sees none.
`<UnitCell>` and `<Unwrap>` therefore need a trajectory within the nearest
structure (or an explicit `box` for `<Unwrap>`), and `<Superpose to="first">`
requires one. A surrounding `<Volume>` and `<TimelineProvider>` remain available
through nested structures because their data and time are independent of a
structure's topology.

## Query selections in JSX

A `SelectionInput` is a reusable `SelectionQuery`, an exact resolved atom
`Selection`, or null. Every representation, EField, Label, Distance (`a`/`b`),
Transform/Superpose (`select`), Unwrap (`center`) and focus accepts it. Omitted
or null retains each consumer's default. Representation, EField, label/distance
and focus queries refine the first model's primary conformers. Coordinate
provider queries evaluate all rows by default; Unwrap without `center` does no
centering. Explicit query scopes override those defaults:

```tsx
import {
  allConformers,
  allModels,
  and,
  comp,
  model,
  within,
} from "@molgpu/select";
import { Spacefill } from "@molgpu/viewer";

<Spacefill select={within(5, comp(["HEM"]))} />;
<Spacefill select={and(model(2), allConformers())} />;
<Spacefill select={and(allModels(), allConformers())} />;
```

The view applies throughout evaluation, including proximity seeds and
complements. Residue/bond queries become atom membership. Resolved values stay
exact even if resolved over every model/conformer: they must match the nearest
dataset, atom domain and topology revision. Positions or attribute changes do
not re-evaluate fixed membership. Use queries for changing membership.
Ribbon/Tube include a residue only when its guide atom is selected; partial
selections do not expand into whole residues, and missing guides break trace
runs.

Queries read the nearest `<Structure>` and any coordinate or attribute providers
above the consumer. A GPU-produced column overrides the same CPU column. For
custom `where` predicates, declare dependencies such as positions or attributes
so membership updates when those inputs change.

Queries that read GPU results evaluate CPU snapshots, published on demand at **4
Hz and on pause**. Membership can lag live atoms and bonds; combined
coordinate/attribute queries can use snapshots from different frames.
`useCoordinateFocus` uses this membership with GPU bounds and returns null while
membership or bounds are unavailable. `useCameraCurve` instead reads the CPU
resource passed to it. See [Coordinate consumers](#coordinate-consumers) for
which representations use live positions or snapshots.

Use `onSelectionStatus` to handle `pending`, `ready` or `error`. A ready report
includes the atom `count` (zero is valid) and `updating`, which indicates that a
new snapshot is pending. Reports also contain the prop slot, query label and
source identities with local generations; those generations are comparable only
within the same source. Reports change when resolution inputs change, rather
than on every draw. Distance reports `a` and `b` separately.

Pending or failed selections hide that consumer's representation or label;
coordinate providers pass upstream positions through, and EField exposes no
computed volume. Empty selections stay empty. Siblings continue rendering.
`warnEmptySelection` opts into warnings for stable empty queries; it defaults
false and excludes position-dependent or produced-column queries.

## Entries

- **`@molgpu/viewer`**: scene components, selection diagnostics, picking and
  camera hooks. `ViewerElement` is compatible with the pinned use.gpu
  `LiveElement`; `VectorLike` accepts plain or typed numeric arrays.
- **`@molgpu/viewer/advanced`**: custom coordinate/attribute providers, GPU
  sources, CPU snapshots and resource access. These APIs require familiarity
  with the pinned use.gpu version.

### Material constants and wrappers

`material` accepts these constant settings:

| Kind                      | Settings                                                                 | Defaults                                                 |
| ------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------- |
| `pbr` (or omitted `type`) | `metalness`, `roughness`: numbers; `albedo`, `emissive`: numeric vectors | metalness 0, roughness 0.6, white albedo, black emissive |
| `basic`                   | `color`: numeric vector                                                  | white                                                    |
| `normal`                  | no settings                                                              | normal debug shading                                     |

```tsx
import { PBRMaterial } from "@use-gpu/workbench";
import { Spacefill } from "@molgpu/viewer";

<Spacefill material={{ roughness: 0.8, metalness: 0 }} />;
<Spacefill
  material={(children) => (
    <PBRMaterial roughness={() => 0.8}>{children}</PBRMaterial>
  )}
/>;
```

A PBR `albedo` or basic `color` multiplies the representation's color, including
alpha; it does not replace a per-atom color field. White preserves that color.
Normal shading visualizes normals instead. This follows the pinned workbench
material shaders. Native wrappers can supply lazy values, shader maps, render
callbacks and the full upstream color syntax. Native wrappers use upstream
material defaults (PBR roughness 0.5 unless specified).

## API

Stability: _stable_ — relied on by the examples and settled; _experimental_ —
may change in 0.x minor releases; _advanced_ — only from
`@molgpu/viewer/advanced`.

| Name                      | Stability    | Description                                                                                                                                                                                                             |
| ------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Structure`               | stable       | Provides one structure (preloaded `data` or loaded `src`) to its subtree.                                                                                                                                               |
| `StructureProps`          | stable       | `<Structure>` props: preloaded `data` or loaded `src` (with `loader`/`loading`/`error`), mutually exclusive.                                                                                                            |
| `StructureLoader`         | stable       | Cancellable `(src, cancelled) => StructureData` loader.                                                                                                                                                                 |
| `Spacefill`               | stable       | Atoms as world-space shaded spheres.                                                                                                                                                                                    |
| `Bonds`                   | stable       | Bonds as world-space sticks; vertex positions follow the nearest coordinate provider.                                                                                                                                   |
| `BallAndStick`            | stable       | Spacefill balls plus Bonds sticks over one selection.                                                                                                                                                                   |
| `Tube`                    | stable       | Backbone as a GPU-extruded tube.                                                                                                                                                                                        |
| `Ribbon`                  | stable       | Polymer trace as Mol*'s cartoon trace: helix ribbons, coil tubes, sheet arrows, flat nucleic strands.                                                                                                                   |
| `Cartoon`                 | experimental | Mol*'s default Cartoon: the `Ribbon` trace plus nucleotide rings and dashed polymer gaps, in one mesh.                                                                                                                  |
| `RibbonProps`             | stable       | Props shared by `<Ribbon>` and `<Cartoon>`.                                                                                                                                                                             |
| `GpuDssp`                 | experimental | Computes DSSP from the nearest GPU coordinate stream for one model and publishes generation-tagged `ssCode` to descendant fields and ribbons.                                                                           |
| `Surface`                 | stable       | Molecular (solvent-excluded) surface.                                                                                                                                                                                   |
| `Volume`                  | experimental | Own one scalar volume (`data` or CCP4/MRC `src`); one shared GPU copy per volume identity.                                                                                                                              |
| `VolumeProps`             | experimental | `<Volume>` props: `data` or `src`, with `loader`/`loading`/`error`.                                                                                                                                                     |
| `VolumeLoader`            | experimental | Cancellable `(src, cancelled) => VolumeData` loader.                                                                                                                                                                    |
| `Isosurface`              | experimental | CPU marching-cubes isosurface of the nearest `<Volume>` at an absolute or sigma `level`.                                                                                                                                |
| `VolumeSlice`             | experimental | Per-fragment planar cross-section of the nearest `<Volume>` through a colour ramp.                                                                                                                                      |
| `EField`                  | experimental | GPU Coulomb potential (vacuum, ε = 4r or Debye–Hückel) of the nearest coordinates and a charge column, provided as a live Volume in kT/e.                                                                               |
| `EFieldProps`             | experimental | `<EField>` props: selection, charge column, dielectric model, optional cutoff, grid and budgets.                                                                                                                        |
| `FieldLines`              | experimental | RK4 streamlines of E = −∇φ through the nearest volume, integrated on the GPU per volume generation.                                                                                                                     |
| `FieldArrows`             | experimental | E = −∇φ arrows on a lattice in a slice plane; moving the plane is a uniform write.                                                                                                                                      |
| `Trajectory`              | experimental | Coordinate provider that plays a `TrajectoryData` (`data`) or a DCD/XTC/TRR URL (`src`) over the nearest coordinates; `frame` is a number or timeline curve; `interpolate`, `pbc="minimum-image"`.                      |
| `Transform`               | experimental | Coordinate provider applying a column-major 4×4 affine matrix (or vector curve) to all atoms or `select` rows. Other rows pass through.                                                                                 |
| `TransformProps`          | experimental | Matrix, optional atom selection, and children for `<Transform>`.                                                                                                                                                        |
| `Superpose`               | experimental | Coordinate provider fitting the nearest coordinates onto a reference (`to`: array, structure, or `"first"` trajectory frame) by a GPU Kabsch fit; `select` picks fit atoms and every atom moves.                        |
| `SuperposeProps`          | experimental | Reference, optional fit selection, `translate`, asynchronous `onStatus`, and children for `<Superpose>`.                                                                                                                |
| `SuperposeStatus`         | experimental | Reference pending/error or solved/collinear passthrough, fitted RMSD when solved, and coordinate generation.                                                                                                            |
| `Unwrap`                  | experimental | Coordinate provider making covalent components whole on the displayed periodic frame (GPU pointer jumping over a covalent forest); `box` defaults to the trajectory's, `center` moves components into the primary cell. |
| `UnwrapProps`             | experimental | Box, optional center selection, `onStatus`, and children for `<Unwrap>`.                                                                                                                                                |
| `UnwrapStatus`            | experimental | `ok`, `ambiguous` (ring edges that do not close), `search-limit`, `missing-box` or `invalid-box`, with a generation.                                                                                                    |
| `NormalMode`              | experimental | Add a precomputed guide-node mode to nearest upstream coordinates; animation changes a scalar uniform.                                                                                                                  |
| `NormalModeProps`         | experimental | Mode vectors/mapping, amplitude, frequency, phase, and children.                                                                                                                                                        |
| `ElasticNetwork`          | experimental | Langevin dynamics of an elastic network toward a caller-owned target `step`; publishes upstream plus guide-node displacement.                                                                                           |
| `ElasticNetworkProps`     | experimental | Network data, target step (number or curve), seed, temperature, γ, dt, per-frame step budget, tug and status callback.                                                                                                  |
| `pointerToPlane`          | experimental | World point under pointer `(u, v)` on the plane through an anchor, normal to the view axis, from a projection-view matrix.                                                                                              |
| `projectToPointer`        | experimental | Pointer `(u, v)` and NDC depth of a world point; the inverse of `pointerToPlane` on its plane.                                                                                                                          |
| `ElasticNetworkStatus`    | experimental | Completed and target steps, `lagging` and `perturbed`.                                                                                                                                                                  |
| `useTrajectoryFrame`      | experimental | What the nearest `<Trajectory>` shows: requested frame, displayed pair, interpolated box; null outside one.                                                                                                             |
| `UnitCell`                | experimental | Lines along the displayed frame's periodic box.                                                                                                                                                                         |
| `TrajectoryProps`         | experimental | `<Trajectory>` props: `frame`, `interpolate`, `pbc`, `onStatus`, plus exactly one of `data` or `src` (with an optional `loader`).                                                                                       |
| `TrajectoryStatus`        | experimental | `onStatus` value: `opening`, `ready` (frame count), or `error` with phase `source`/`frame`; failures pass upstream coordinates through.                                                                                 |
| `TrajectoryLoader`        | experimental | Cancellable `(src, cancelled) => TrajectoryData` loader.                                                                                                                                                                |
| `TrajectoryFrameState`    | experimental | Return type of `useTrajectoryFrame`.                                                                                                                                                                                    |
| `SlicePlane`              | experimental | A grid plane `{ axis, index }` or a world plane `{ normal, point }`.                                                                                                                                                    |
| `ColorStops`              | experimental | RGBA colour stops over a normalised 0–1 range, shared with `<VolumeSlice>`.                                                                                                                                             |
| `SliceStops`              | experimental | `[t, color]` stops over 0–1 for `<VolumeSlice>`.                                                                                                                                                                        |
| `TimelineProvider`        | stable       | Provides caller-owned global time in seconds.                                                                                                                                                                           |
| `ViewerElement`           | experimental | Pinned native LiveElement for scene composition.                                                                                                                                                                        |
| `ViewerComponent`         | experimental | A component: `(props) => ViewerElement` (owned alias).                                                                                                                                                                  |
| `VectorLike`              | experimental | Plain or typed numeric vector; the flat-colour type of every representation.                                                                                                                                            |
| `BlendMode`               | experimental | Blend-mode names for `<Spacefill>` point-layer options.                                                                                                                                                                 |
| `Translucency`            | stable       | `opacity` (0–1, a uniform) and `mode`, shared by every representation.                                                                                                                                                  |
| `DrawMode`                | stable       | `'opaque' \| 'transparent'`; transparent is chosen automatically when colour alpha × opacity < 1.                                                                                                                       |
| `PointLayerOptions`       | experimental | Point-layer flags `<Spacefill>` forwards.                                                                                                                                                                               |
| `useCoordinateFocus`      | experimental | Focus nearest coordinates using GPU bounds; returns null while inputs are pending.                                                                                                                                      |
| `SelectionInput`          | experimental | Query, exact resolved atom selection, or default/null membership.                                                                                                                                                       |
| `SelectionSource`         | experimental | Opaque input owner/source and local generation diagnostics.                                                                                                                                                             |
| `SelectionStatus`         | experimental | Pending, ready(count/updating), or named selection error with source tuple.                                                                                                                                             |
| `SelectionDiagnostics`    | experimental | Optional status callback and opt-in stable-empty warning.                                                                                                                                                               |
| `MaterialType`            | experimental | `pbr`, `basic` or `normal`: the `type` of a `material` spec.                                                                                                                                                            |
| `MaterialSpec`            | experimental | Discriminated material constants or native Live wrapper.                                                                                                                                                                |
| `PickingProvider`         | experimental | Owns the picking registry.                                                                                                                                                                                              |
| `usePicking`              | experimental | Hovered and picked atom.                                                                                                                                                                                                |
| `PickHit`                 | experimental | An atom resolved from a picking hit.                                                                                                                                                                                    |
| `Label`                   | experimental | Text label anchored to a selection centroid.                                                                                                                                                                            |
| `Distance`                | experimental | Line and label between two selection centroids.                                                                                                                                                                         |
| `CameraPose`              | experimental | Orbit-camera target/radius/bearing/pitch.                                                                                                                                                                               |
| `CameraFrame`             | experimental | Explicit camera keyframe.                                                                                                                                                                                               |
| `FocusCameraFrame`        | experimental | Camera keyframe that frames a selection query.                                                                                                                                                                          |
| `CameraCurve`             | experimental | Sequence of at least two keyframes with increasing times; validated once per curve object when first sampled, so treat it as immutable.                                                                                 |
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
| `useCoordinateBounds`     | advanced     | Asynchronous GPU bounds and centroid of the nearest stream; atom-domain selections only.                                                                                                                                |
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

`<Spacefill>`, `<Bonds>`, `<Surface>`, `<Ribbon>` and `<Tube>` resolve a colour
field's inputs the same way, over all atoms or a `select` subset. An
argument-free `volumeSample()` samples the nearest `<Volume>` or `<EField>`
ancestor (and fails without one); atom and lifted residue attributes read the
shared attribute columns; an annotation, such as a `joinAnnotation` result,
uploads its own atom rows once when the field is first applied. Surface vertices
read atom inputs through their nearest source atom; Ribbon and Tube vertices
read them through their residue's guide atom (CA, or the nucleic trace atom), so
`byChain()`, `bySecondaryStructure()`, `bySeq()` and `byBfactor()` colour a
cartoon without rebuilding its geometry. A residue-domain annotation
(`lift: false`) or one joined against another structure's rows is rejected.

## Electric fields

`<EField>` is a computed volume. It sums the Coulomb potential of the nearest
coordinates and a charge column on the GPU, so the representations below it work
as they do under `<Volume>`:

```tsx
import { withAttributes } from "@molgpu/table";
import { protein } from "@molgpu/select";
import { byPotential } from "@molgpu/fields";
import {
  EField,
  FieldLines,
  Isosurface,
  Structure,
  Surface,
} from "@molgpu/viewer";

// `data` is StructureData; `charges` has one Float32 value per atom, in elementary charges.
const charged = withAttributes(data, {
  partialCharge: {
    domain: "atom",
    kind: "scalar",
    values: charges,
    provenance: "user",
  },
});

<Structure data={charged}>
  <EField select={protein()}>
    <Surface color={byPotential()} />
    <Isosurface level={5} color={[0.3, 0.4, 1, 1]} />
    <FieldLines seeds={{ spacing: 4 }} colorRange={[0, 2]} />
  </EField>
</Structure>;
```

Assign charges first with `templateCharges` (@molgpu/dynamics), `applyPqr` or
`structureFromPqr`; a missing column throws by name. By default, only the first
model's primary conformers are summed. An explicit `select` overrides this view.
Exclude water if its charges should not contribute.

- **Physics.** The default model is a distance-dependent dielectric (ε = 4r,
  ChimeraX's coulombic default). `model="debye"` screens with an ionic strength,
  and `model="vacuum"` is plain Coulomb. Values are in kT/e at 298.15 K, which
  makes the default display range ±15 (±2 for Debye). This is not
  Poisson–Boltzmann: import an APBS map with `<Volume>` for that.
- **Grid.** The grid is placed around selected atoms with nonzero CPU charges,
  padded by 8 Å at 1 Å spacing, or set with `box`. GPU-produced charges use all
  selected atoms for bounds. It stays fixed while coordinates move.
- **Cost.** `maxPairs` (samples × charged atoms, default 2³⁴) refuses larger
  sums and names a spacing that fits.
- **Live updates.** Each coordinate generation recomputes on the GPU, one
  computation at a time. Slices, `volumeSample()` colours, field lines and
  arrows follow live. `<Isosurface>` follows CPU snapshots.
- **Colouring and glyphs.** `byPotential()` colours a surface `sampleOffset` Å
  (default 1.4) off each vertex. `<FieldLines>` and `<FieldArrows>` read E = −∇φ
  from the same grid.

## Elastic network dynamics

`<ElasticNetwork>` integrates BAOAB Langevin dynamics of an elastic network and
re-provides coordinates: each atom moves with its residue's guide node.

```tsx
import { elasticNetworkData } from "@molgpu/dynamics";
import { frameCurve } from "@molgpu/timeline";
import { ElasticNetwork, Spacefill } from "@molgpu/viewer";

// `data` is your reference StructureData; put this provider beneath Structure
// and TimelineProvider. `setStatus` is the application's status callback.
const network = elasticNetworkData(data.positions, data.topology, {
  version: 1,
}); // CA guides, 15 Å springs, k = 1 kcal/mol/Å²

<ElasticNetwork
  network={network}
  step={frameCurve({ frames: 600_000, fps: 600 })} // 600 steps/s
  seed={7}
  onStatus={setStatus}
>
  <Spacefill />
</ElasticNetwork>;
```

The reference is whatever positions the application passes; the provider never
reads root positions itself. Time stays caller-owned: holding `step` pauses (no
dispatch, no repaint), and a lower `step` replays from step 0, so a run is a
function of the network, parameters, seed and step on one device. Velocities are
projected off rigid-body motion, so the molecule neither drifts nor rotates. A
residue moves rigidly with its CA, so side chains do not rotate and peptide
bonds stretch with neighbouring node displacements. Live representations
(`<Spacefill>`, `<BallAndStick>`) follow every generation; `<Ribbon>`, `<Tube>`
read coordinate snapshots and follow at the snapshot rate. `<Surface>` uses GPU
updates where supported, otherwise snapshots. `status.lagging` reports when the
integration budget trails the target; performance depends on the network and
GPU.

## Computed attributes

`<AttributeProducer>` from `@molgpu/viewer/advanced` computes one `f32` atom or
residue column from a WGSL kernel and makes it available to descendant fields as
`attribute(name, { domain })`. Pass `parameterKey` when kernel parameters change
so its generation advances. `useAttributeSnapshot(name)` subscribes to a
throttled CPU copy for a tooltip or analysis; it returns `null` until the first
submitted dispatch and mapped readback. The snapshot contains a revised table
with the produced column and the producer generation. It can retain the latest
completed generation while a new one is pending. A new owner, buffer or column
layout starts without a snapshot. A new parameter revision remains pending until
its dispatch submits; dependent fields and EField wait for that revision instead
of reading an uninitialized buffer.

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

## Ribbon and cartoon

`<Ribbon>` is a port of the polymer-trace visual of Mol*'s default Cartoon: one
segment per residue, helices as flat elliptical ribbons, coil as a round tube,
sheets as flat boxes whose last residue forms an arrowhead, and nucleic strands
as flat boxes, with Mol*'s sizes (0.2 Å, aspect ratio 5, arrow factor 1.5).
`<Cartoon>` is the complete composition: the same trace plus, for each
nucleotide, a stick from the trace atom to the base and the base ring(s) as a
slab, and dashed cylinders across polymer gaps. A gap is a run of residues
missing from the model within one chain; a break made only by `select` is not
drawn as a gap. Both are one snapshot-based mesh coloured per residue, so color
and opacity stay bound styling inputs; coordinates, selection, `smooth` and
cartoon secondary-structure codes rebuild geometry. Not ported: tubular helices,
rounded profiles and cyclic polymers.

```tsx
<Structure data={dna}>
  <Cartoon color={byChain()} />
</Structure>;
```

## Coordinate consumers

| Consumer                       | Coordinate input                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Spacefill, Bonds, BallAndStick | Nearest GPU coordinates on every draw.                                                          |
| Ribbon, Tube, Label, Distance  | Shared CPU snapshots, normally 4 Hz during motion and once more on pause.                       |
| Surface                        | GPU geometry updates for supported moving grids; CPU snapshots for static or unsupported cases. |
| useCoordinateFocus             | GPU bounds with selection membership from published inputs.                                     |
| useCameraCurve                 | CPU data from the resource explicitly passed to the hook.                                       |

Snapshots and geometry jobs are asynchronous. Geometry can be absent until the
first result arrives. During updates to the same source, the last completed
result can remain visible; replacing the source buffer or structure starts
pending again. Surface runs one job at a time, with the latest request winning.
Picking returns atom-row identities for the geometry being drawn.

The snapshot, selection and bounds hooks are in `@molgpu/viewer/advanced`.
`useCoordinateSelection` reads published positions and root CPU attributes; use
a component `select` prop to query GPU-produced attributes. To use
`useCameraCurve` below a coordinate provider, pass a snapshot resource.

### Assembly copies

Representations draw one copy per assembly operator in `topology.instances`,
using only that copy's chains. Identity-only tables draw as supplied. Operators
apply after coordinate providers, so every copy follows the nearest positions
without duplicating atoms. Ribbon, Tube and Surface share geometry among copies
with the same chains.

Camera framing covers every copy. A picked atom reports its `operatorId`. Label
and Distance draw once per copy containing their selected atoms; a label with an
explicit `at` draws once.

The
[coordinate examples](https://github.com/zachcp/molgpu/blob/main/site/README.md)
scrub a transform with live atoms and bonds, snapshot ribbon and GPU focus.

## Authoring a coordinate provider

`<CoordinateKernel>` from `@molgpu/viewer/advanced` is the supported way to
write a GPU coordinate transform. Give it the upstream coordinates
(`useCoordinates()`), a WGSL compute module and its `args`, and a `parameterKey`
that changes whenever the args change the output. It owns one packed output
buffer (destroyed on unmount). Its generation identifies requested content;
`ready` becomes true only after that revision's dispatch submits. Dependent work
then follows queue order, while CPU snapshots appear after a mapped copy. The
kernel links `getSize()`, one getter per arg, one per extra `sources` entry,
then `getInput(i) -> vec3<f32>`, and writes `output[i * 3u + k]`.
[coordinate provider example](https://github.com/zachcp/molgpu/blob/main/site/src/demos/coordinates.ts)
is a complete example.

## Dependencies

The viewer combines the renderer-free `@molgpu/*` packages with use.gpu Live,
workbench and shader APIs. BinaryCIF parsing loads lazily through `@molgpu/io`;
preloaded `<Structure data={data}>` does not load a parser. Use the main or
advanced public entry instead of importing source files.

## Source replacement and cancellation

Structure, Volume and Trajectory loaders receive `(src, cancelled, signal)`. The
optional third argument preserves existing two-argument loaders. Default loaders
forward the request signal through IO transport and supported decoding.
Replacement, switching to preloaded data and unmount abort the old request; late
results and errors are ignored. Custom loaders that ignore the signal still have
stale publication suppressed, but their work is not necessarily aborted.

During replacement, Structure/Volume show their loading value and Trajectory
renders children against upstream coordinates until the new source opens. Old
trajectory metadata and old source errors are withdrawn immediately. A Superpose
first-frame request follows the same replacement/cancellation rule. An opening
or failed inner Trajectory shadows outer trajectory metadata; its coordinates
still pass through from upstream. `useTrajectoryFrame()` returns null until the
nearest source opens. Frame failures belong to their player and do not carry
into a replacement.

### Presentation and retry

Structure and Volume wait for a dataset: while a `src` request is pending they
render `loading`, on failure they render `error(failure)`, and their subtree
mounts only with the loaded data. Trajectory layers coordinates over an existing
structure, so it renders its children with upstream coordinates while opening. A
failed source open or frame read is not thrown (use.gpu Live has no error
boundary): upstream coordinates keep passing through and `onStatus` receives a
`TrajectoryStatus` (`opening`, `ready`, or `error` with phase `source` or
`frame`). Without `onStatus`, each failure is logged once with `console.error`.
`<Superpose to="first">` also passes upstream coordinates through while the
nearest trajectory or its first-reference read is pending or failed. Its
`onStatus` reports `pending` or `error` (with `phase: "source"` for trajectory
opening/playback, or `"reference"` for the separate frame-0 read); `rmsd` is
null and `generation` identifies the upstream generation at that state
transition. A reference failure without a callback is logged once. Retry by
replacing or remounting the source. A missing Trajectory ancestor, missing
reference fit rows and a collinear reference remain errors.

To own opening and its presentation, call `openTrajectory` from `@molgpu/io` and
pass the result as `<Trajectory data>`, which is playback only.

A failure is kept until something changes the request: a new `src`, a new
`loader` identity, or a remount. Re-rendering with the same props does not
retry. To retry an unchanged `src`, remount with a new `key`. Live honours `key`
only among array siblings, so return the keyed element in an array:

```tsx
return [<Structure key={`attempt-${attempt}`} src={src} error={onFailure} />];
```

Switching the same element between `src` and `data` mounts `data` immediately
and cancels any pending request; switching back to `src` shows `loading`.
