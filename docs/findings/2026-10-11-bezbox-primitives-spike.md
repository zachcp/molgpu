# Bezbox primitives and the use.gpu Math/Frame split

Date: 2026-10-11. Spike: `molgpu-sept-d90`, claimed by Codex. Branch:
`codex/bezbox-primitive-spike`, based on freshly fetched `origin/main`
`0fb2734`. Research and executable contract probes only; production source,
package manifests, API snapshots and the dependency lock remain unchanged.

## Decision

**Adopt the separation of concerns and the small primitive vocabulary. Pilot it
in FieldArrows on the existing 0.20.0 pin. Keep explicit molecular prop types
and scientific data contracts. Use native schemas where there is actual
attribute adaptation to do; do not introduce a schema engine for every
provider.**

The useful shape is:

1. An explicit props declaration with units and defaults.
2. Small strict normalization functions, or a small trait composition when
   multiple consumers actually share the parsing.
3. A private storage/binding description, only where needed.
4. A component that reads the nearest scope and connects those values to the
   existing native rendering or compute primitive.

This can make trajectory and volume code easier to read. It does not make their
loading, scientific validation, asynchronous publication or buffer ownership
responsibilities disappear. Those should remain named, separately readable
modules rather than being encoded into an elaborate trait collection.

The Math/Frame migration is a separate decision. There is concrete source
support for the split, but the reviewed source and release-candidate artifacts
are not the same version of that split. Do not upgrade merely to adopt this
organization.

## Evidence and reproducibility

Sources were read directly from public Git repositories and package tarballs.
The web reader could not fetch the supplied GitLab tree URLs; Git clone
succeeded. No upstream build scripts were run.

| Source                     | Exact evidence                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Bezbox                     | `9f93175c5d762835fe09b599abb4afab5aeee499`, author Steven Wittens, commit subject `oob point`                            |
| use.gpu upstream source    | `092812757a796123488ee90e58e95a63d1a2cb6b`, subject `hash bigints`                                                       |
| Current installed baseline | `@use-gpu/core`, `workbench`, `live`, `traits` at `0.20.0`                                                               |
| Bezbox package resolution  | `package.json` requests `0.21.0-rc.1`; `.npmrc` points to GitLab project `27922731`; `yarn.lock` records artifact hashes |

Pinned starting points:

- [Bezbox Canvas](https://gitlab.com/unconed/bezbox/-/blob/9f93175c5d762835fe09b599abb4afab5aeee499/src/canvas-2d/dom/canvas.ts),
  [Arrow](https://gitlab.com/unconed/bezbox/-/blob/9f93175c5d762835fe09b599abb4afab5aeee499/src/plot-2d/shape/arrow.ts),
  [traits](https://gitlab.com/unconed/bezbox/-/blob/9f93175c5d762835fe09b599abb4afab5aeee499/src/plot-2d/traits.ts),
  [schemas](https://gitlab.com/unconed/bezbox/-/blob/9f93175c5d762835fe09b599abb4afab5aeee499/src/plot-2d/schemas.ts).
- [GPU Arrow](https://gitlab.com/unconed/use.gpu/-/blob/092812757a796123488ee90e58e95a63d1a2cb6b/packages/plot/src/shape/arrow.ts),
  [GPU traits](https://gitlab.com/unconed/use.gpu/-/blob/092812757a796123488ee90e58e95a63d1a2cb6b/packages/plot/src/traits.ts),
  [VirtualLayers](https://gitlab.com/unconed/use.gpu/-/blob/092812757a796123488ee90e58e95a63d1a2cb6b/packages/workbench/src/layers/virtual-layers.ts),
  [aggregator](https://gitlab.com/unconed/use.gpu/-/blob/092812757a796123488ee90e58e95a63d1a2cb6b/packages/workbench/src/hooks/useAggregator.ts),
  [RawArrows](https://gitlab.com/unconed/use.gpu/-/blob/092812757a796123488ee90e58e95a63d1a2cb6b/packages/workbench/src/primitives/raw-arrows.ts).
- [Math entry](https://gitlab.com/unconed/use.gpu/-/blob/092812757a796123488ee90e58e95a63d1a2cb6b/packages/math/src/index.ts),
  [Frame entry](https://gitlab.com/unconed/use.gpu/-/blob/092812757a796123488ee90e58e95a63d1a2cb6b/packages/frame/src/index.ts),
  [Core entry](https://gitlab.com/unconed/use.gpu/-/blob/092812757a796123488ee90e58e95a63d1a2cb6b/packages/core/src/index.ts),
  [traits implementation](https://gitlab.com/unconed/use.gpu/-/blob/092812757a796123488ee90e58e95a63d1a2cb6b/packages/traits/src/useTrait.ts),
  [schema implementation](https://gitlab.com/unconed/use.gpu/-/blob/092812757a796123488ee90e58e95a63d1a2cb6b/packages/core/src/archetype.ts).

The exact rc.1 tarballs were downloaded from the registry recorded in Bezbox's
lockfile. Their SHA-1 values match that lockfile:

| Artifact  | SHA-1                                      |
| --------- | ------------------------------------------ |
| core      | `ed044b5fab1cd2459b13a8c8cd556837f003457d` |
| frame     | `9d6882adfd39294002fd851d087651f826165878` |
| plot      | `fee42237d886b6c2e0decaf75aac9e2290b481db` |
| workbench | `8e0feb745d82ce5b510b7bc53679a0343ec35733` |
| traits    | `ac15e213b1a1e053dd21fb9d415bc58412ef7996` |
| parse     | `b39744357ffebeb8c1c1cfa06e48befccb6c20f8` |

For example, the plot artifact is
[plot-0.21.0-rc.1.tgz](https://gitlab.com/api/v4/projects/27922731/packages/npm/@use-gpu/plot/-/@use-gpu/plot-0.21.0-rc.1.tgz).
Its emitted Arrow implementation confirms the same parse → emitters → archetype
→ layer-record path described below. This is source inspection, not execution of
the rc renderer.

## What the linked implementation actually does

### Canvas 2D and GPU are distinct backends

Bezbox `canvas-2d/dom/canvas.ts` calls `canvas.getContext('2d')`. It provides a
render context and uses Frame's Queue/SyncLoop to collect and flush work.
`plot-2d/plot.ts` gathers renderables, orders them by `zIndex`, and invokes
their `draw` callbacks. Picking visits the reverse draw order where a picker
exists. The arrow callback transforms points with `gl-matrix`, strokes paths,
and fills an arrowhead with Canvas 2D calls. It is not a WebGPU arrow buffer
implementation.

The architectural value is that the same Live composition concepts and similar
props/schema vocabulary can serve this backend. This is evidence for separating
host-independent scheduling from GPU machinery, not a reason to add a Canvas
backend to molgpu.

### Trace of one arrow

| Stage           | Canvas 2D implementation                                  | GPU plot implementation                                                                                                          |
| --------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Caller contract | `ArrowProps = TraitProps<typeof ArrowTraits>`             | Same pattern                                                                                                                     |
| Normalize       | `makeUseTrait(ArrowTraits)`                               | Same pattern, with bindable GPU sources                                                                                          |
| Shape           | Nested positions become chunks; colors become CSS strings | Segments, slices, anchors, trims and unwelds support line/head topology                                                          |
| Layout          | `adjustSchema(ARROW_SCHEMA, formats)`                     | Same schema adjustment                                                                                                           |
| Attributes      | `schemaToAttributes` selects supplied data                | `schemaToEmitters` supports spread, unwelding and JS emitters                                                                    |
| Publication     | A quoted `yeet({ draw, zIndex })`                         | A quoted `yeet({ arrow: { count, archetype, attributes, flags, material, refs, schema, scissor, sources, transform, zIndex } })` |
| Consumer        | Plot invokes Canvas drawing                               | Plot wraps VirtualLayers; compatible shape records are partitioned and aggregated                                                |
| Native draw     | Canvas path/stroke/fill                                   | ArrowLayer composes RawLines and RawArrows; shader sources feed instanced vertex generation and `useDraw`                        |

The GPU Arrow is concise because batching, allocation, packing, source binding,
material handling, picking and draw construction live in reusable upstream
modules. `useAggregator` calls `schemaToAggregate`, `toGPUAggregate`, then
updates and uploads aggregate contents. These costs still exist. A short
component is not evidence of zero upload cost or of correct retirement during
replacement.

### Four concepts worth keeping distinct

**Props** describe what the caller can supply. `TraitProps` infers input types
from parsers and their defaults. It can eliminate repeated optional/default
bookkeeping for visual options.

**Traits** parse inputs and write normalized output. `combine` runs traits in
order, so shared keys can overwrite earlier results. `makeUseTrait` returns the
same mutable parsed object across renders; upstream explicitly says to unpack or
clone before memoizing. Depending on `[parsed]` would miss changes. `parseTrait`
creates a new object for a one-shot parse; context-dependent plot traits are not
therefore ordinary pure validators.

**Schemas** describe attribute representation. The compact declarations expand
plural arrays and singular values into an `ArchetypeSchema`. For example,
`widths: { format: 'f32', single: 'width' }` describes both an array-valued
width channel and its singular alternative. `name` aliases the target attribute;
`spread` supports values per slice. Nested `array<...>` describes composite
data; `ref`, `index`, `unwelded`, and `js` express distinct adaptation rules.
This is not a general scientific object validator.

**Archetypes** identify compatible layout/flags/source combinations for
batching. `schemaToArchetype` does not hash sample contents. Two scalar arrays
with different values produce the same archetype when their layout is the same.
Shader-source identity can participate separately. Neither outcome is a content
generation or a GPU completion signal.

### What to borrow and what to avoid copying

Borrow semantic file names, explicit props, centralized defaults, small reusable
normalizers, and native uniform-or-source bindings. Borrow compact schemas when
they replace repeated attribute adaptation. Keep the component's main path easy
to follow: read scope → normalize → bind → draw.

Do not copy the entire traits collection. Bezbox's traits file is 620 lines;
upstream plot's is 821, while its Arrow component is 106. The complexity is
shared, not eliminated. Bezbox also contains adaptation residue: its DataTrait
allocates a sources record but never fills it; the GPU equivalent explicitly
recognizes shader bindings. The Canvas arrow computes schema attributes but its
draw callback directly reads parsed positions. These are source observations,
not independently reproduced upstream bugs. Treat the code as a design example,
not a drop-in implementation template.

Do not adopt permissive parsing for scientific inputs. Upstream `parseNumber`
coerces and falls back to zero (`+value || 0`); it does not enforce finite,
positive spacing, valid affine transforms, atom count or sample count. The probe
uses a strict parser and verifies rejection of zero, negative, NaN and infinity.

## Applying this to molgpu

### FieldArrows is the best initial pilot

[Current FieldArrows](../../packages/viewer/src/volume/representations/field-arrows.ts)
already uses `ArrowLayer`, `useArrowSegmentsSource`, `useShader`, and
`useShaderRef`. Positions are shader functions of lattice index, plane uniforms
and the nearest volume samples. Widths and colors are shader functions too.
There is no need to materialize an endpoint array or add a Plot ancestor.

Its present readability cost is that WGSL construction, option validation,
plane/lattice derivation and Live wiring share one file. A bounded layout could
be `field-arrows.ts`, `field-arrows-options.ts`, and `field-arrows-shaders.ts`,
kept together under the existing volume representation folder. Use an explicit
props declaration and document the result of normalization. Reuse existing
plane, ramp, opacity and source helpers. Avoid a new folder taxonomy or generic
manager.

The binding contract is already small:

| Input                          | Meaning                                | Change behavior to preserve                 |
| ------------------------------ | -------------------------------------- | ------------------------------------------- |
| volume source                  | Live scalar samples                    | Read current GPU samples; no CPU repacking  |
| center, U, V                   | Plane in Å                             | Uniform updates                             |
| style                          | scale, cap, threshold, pixel width     | Uniform updates                             |
| tint/range                     | Appearance                             | Uniform updates for existing shader variant |
| grid/side                      | Sampler and lattice specialization     | May rebuild modules                         |
| stops / enabling a color range | Ramp specialization                    | May rebuild modules                         |
| segment sources                | Two endpoints per arrow, head topology | Rebuild only when lattice topology changes  |

The distinction around enabling a color range matters: current module
memoization depends on whether the range is present, as well as the stops. Do
not promise that every possible style transition is a uniform-only operation.

A schema adds little to this direct binding path. Native schemas are useful for
CPU attributes destined for aggregation; a descriptive binding table and named
shader module inputs are clearer here. Introducing a schema that no runtime
consumer reads would create another thing to keep synchronized.

### Trajectory: small contracts, specialized playback

[TrajectoryProps](../../packages/viewer/src/types.ts) already expresses a useful
`data` versus `src` union, `frame: number | Curve<number>`, interpolation, PBC
and status. [TrajectoryData](../../packages/table/src/trajectory-types.ts)
already separates immutable frames from a cancellable lazy source. These are
good small contracts; their placement and readability can improve without
changing them.

Move the caller-facing trajectory declarations into a feature-local contract
module and keep entry exports unchanged. The existing trajectory, player,
frame-cache and frame-window modules are already a meaningful split. Preserve
that work from the completed cleanup rather than restarting a broad refactor.

A storage schema can describe frame samples, but the current player stores
packed XYZ as `f32` and computes `(slot * frameAtoms + atom) * 3`. A generic
`array<vec3<f32>>` GPU allocation has alignment/padding concerns and must not be
substituted for this layout. The probe's vec3 schema only extracts CPU data; it
does not upload it.

The following belong outside attribute schemas:

- `atomMap` preserves topology rows and passes unmapped rows through from the
  nearest upstream coordinates.
- IO time units (`ps`, `step`, `index`) remain separate from timeline seconds.
- Source opening, failed frame reads, displayed versus requested frame and
  cancellation retain their current policies.
- The player owns its bounded GPU window and inverse map; CoordinateKernel owns
  output publication. Owner/source/layout and local generation remain explicit.
- Minimum-image interpolation and its scientific checks stay in the specialized
  kernel; trait uniformity is no reason to replace the algorithm.

Use a compact, documented shader argument contract if later work finds
link-order duplication problematic. Do not create a generic schema compiler
merely to hide this one ordered argument list.

### Volume: distinguish the grid, sample storage and publication

[VolumeGrid / VolumeData](../../packages/table/src/volume-types.ts) are already
small renderer-free declarations. `createVolume` validates dimensions, sample
counts, component count, finite values and an invertible affine. The
[Volume component](../../packages/viewer/src/volume/volume.ts) is already a
modest source/presentation adapter over a provider and shared buffer hook.

A private `{ values: { format: 'array<f32>', separate: true } }` is enough to
illustrate scalar storage. It is not enough to describe a molecular volume:
x-fastest order, units, components and index-to-world transform remain domain
metadata. The current GPU path only accepts scalar volumes even though the table
contract permits one or three components. Keep that distinction visible.

[NearestVolume](../../packages/viewer/src/volume/volume-context.ts) unifies
loaded and computed volumes while distinguishing live GPU samples from CPU
snapshots. Loaded values and EField output must continue serving the same
consumers without making GPU-only data pretend to be an available CPU array.
Stable grid identity avoids rebuilding samplers when only sample contents
change.

Move VolumeProps/loader declarations next to this feature, preserving their
union. Do not flatten loading/error props and data/src into an all-optional
trait bag. Do not replace shared per-device volume storage with a RawData per
visual: that would lose sharing and require a new lifetime proof. The current
buffer adapter records its retained-draw rationale explicitly.

### Keep ordinary JSX simple

The [compile-only consumer](../../test/spikes/bezbox-primitives/consumer.tsx)
uses current public exports: Volume contains VolumeSlice and FieldArrows,
alongside Structure → Trajectory → Spacefill. No packed rows, source objects,
schemas, resource owners or revisions appear in those props. Negative type
examples ensure invalid source combinations remain rejected.

This is the desired public simplicity. Native traits/schema types can remain
private viewer implementation details. Exporting `TraitProps<typeof Traits>`
would expose an upstream implementation dependency to our ordinary API and must
not bypass H3/H5. An explicit local props type also gives JSR readers a useful
place for units, defaults and status descriptions.

## Math and Frame: what changes, and what remains uncertain

The checked-out source separates pure easing/math/polynomial utilities into
`@use-gpu/math`. Core still owns GPU/data layout, buffers, formats, archetypes
and aggregation. Frame owns Live scheduling, queues,
time/loop/data/event/range/layout contexts, inspection, routing and generic
rendering context. Workbench retains GPU device, shader, compute, draw,
material, transform and specialized render adaptation. Frame is not a trajectory
frame and not a replacement for our seconds-based timeline values.

There are three distinct states:

| State                           | Math                                                                     | Frame                                           |
| ------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| Installed 0.20.0                | Easing lives in Core                                                     | Scheduling/context APIs imported from Workbench |
| Exact Bezbox rc.1 artifacts     | Core still exports `ease.mjs`; no Math entry in Bezbox lock              | Separate Frame package exists                   |
| Reviewed upstream source commit | Separate math/ease/polynomial package; Core entry no longer exports ease | Frame split present                             |

The source package manifests still say `0.20.0`, so those manifest strings
cannot identify the reviewed source as a published 0.21 release. The rc.1 Math
tarball returned 404 from the configured GitLab registry; a public npm rc.1
metadata request also returned 404. This establishes availability only for the
specific URLs checked, not the status of every version or registry. Bezbox's
source imports Math despite the older lock artifact set. A clean build of Bezbox
was not run.

Concrete migration targets:

| Current use                                               | Candidate destination in reviewed source                              | Scope                                                                                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Timeline's eight easing helpers from `core/mjs/ease.mjs`  | Math (`ease` plus `math`; choose verified published entry)            | One private adapter; public timeline API stays pure                                                                     |
| `LoopContext`                                             | Frame                                                                 | Seven viewer files: trajectory, coordinate-kernel, elastic-network, attribute-producer, EField, FieldLines, use-repaint |
| `Queue`, `QueueReconciler`                                | Frame                                                                 | Scene/harness setup; Workbench retains deprecated wrappers for selected components such as Queue                        |
| Mouse/wheel/event hooks                                   | Frame                                                                 | Site viewer and interaction code; verify each exported symbol against chosen artifact                                   |
| `StorageSource`, schemas, format utilities                | Core                                                                  | Do not globally replace Core imports                                                                                    |
| `useDeviceContext`, `ArrowLayer`, `RawData`, shader hooks | Workbench                                                             | Do not globally replace Workbench imports                                                                               |
| RenderContext                                             | Specialized Workbench context or generic Frame context as appropriate | Their types differ; avoid a blind import rewrite                                                                        |

Migration must update root and affected package Deno imports, lock resolution,
browser bundler/consumer assumptions, tests with pinned import paths, and the
hardening dependency policy. Timeline currently has an explicit private-Core
exception; authorize and check pure Math there without allowing Frame/Live into
lower packages. Check one resolved copy of Live/Frame so context identity is
shared. Merely compiling renamed imports does not establish this.

A future upgrade should run timeline parity, component/site type checking,
hardening and reviewed API snapshots, JSR dry run and isolated consumer tests,
plus trajectory/volume/EField, invalidation and relevant retirement browser
suites. A coherent artifact set and its actual exports are prerequisites. The
present spike does not claim 0.21 compatibility.

## Alternatives considered

| Option                                                               | Benefit                                          | Cost / decision                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Feature-local explicit props, strict helpers, existing native layers | Readability with current ownership and data flow | Recommended first pilot                                                                                                     |
| Private upstream traits for repeatedly shared visual parsing         | Inferred defaults and cached parsing             | Try only where duplication justifies it; preserve strict validators and explicit public props                               |
| Plot/VirtualLayers for all molecular representations                 | Declarative batching                             | Adds aggregation/packing policy and broader lifecycle questions; no measured need for the already shader-driven FieldArrows |
| One generic trajectory/volume schema and context                     | Uniform-looking components                       | Hides incompatible source, scope and publication semantics; reject                                                          |
| Upgrade first, then reorganize everything                            | One large transition                             | Conflates artifact compatibility with a readability experiment; reject                                                      |

## Executable acceptance and limits

[acceptance.test.ts](../../test/spikes/bezbox-primitives/acceptance.test.ts)
executes five tests against the installed 0.20.0 baseline: strict trait
defaults, borrowed arrays, archetype versus content identity, separate volume
validation, and preservation of trajectory mapping/time metadata. The schema
functions are native Core functions, not a reimplementation. The trait
experiment uses the installed package's CommonJS export because its ESM entry
fails under direct Deno execution with missing Live `useOne`; that failure was
reproduced. This is a probe accommodation, not a proposed production
module-loading strategy.

To avoid adding a direct traits entry to the project's lock for a research-only
probe, use a temporary copy of the existing lock:

```sh
cp deno.lock /private/tmp/molgpu-bezbox-acceptance.lock
deno test -A --lock=/private/tmp/molgpu-bezbox-acceptance.lock --frozen=false test/spikes/bezbox-primitives/acceptance.test.ts
deno check --frozen test/spikes/bezbox-primitives/consumer.tsx
```

Fresh results: **5 tests passed; public JSX and negative prop checks passed.**
Scoped Deno formatting and lint passed; all eight local report links resolve;
all four created beads pass template validation. These establish CPU/schema/type
behavior only. No rc renderer, GPU lifetime, performance, full browser gate or
full-repository test result is claimed. The style/replacement requirements for a
production pilot remain acceptance work in the follow-up bead. This research
does not modify a public API, so it does not claim a new hardening or publish
gate.

## Bounded follow-ups

Existing open issues and the completed architecture/cleanup notes were
inspected. The `0vs` and `ktr` epics are closed; this spike does not reopen
their historical findings or alter unrelated claimed work.

| Bead              | Scope                                     | Completion evidence required                                                                                                                                         |
| ----------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `molgpu-sept-erf` | FieldArrows readability pilot             | Feature-local props/options/shaders; existing native layers; style invalidation, EField and replacement/unmount browser evidence; API gates if exported props change |
| `molgpu-sept-gvq` | Colocate trajectory/volume prop contracts | Same public unions/exports/signatures; component checks, hardening, dry run; no provider behavior change                                                             |
| `molgpu-sept-mik` | Verify coherent Math/Frame artifacts      | Exact artifact provenance, symbol map, pure timeline parity and isolated consumer proof before selecting a new production pin                                        |

All three are unclaimed follow-ups discovered from `d90`; none is required to
implement the research recommendation in this branch. Prefer the single
FieldArrows pilot before extending the pattern. Its acceptance should
demonstrate that a reader can find the props, normalization, shader contract and
native draw without following a generic framework, while all existing scientific
and invalidation behavior remains intact.
