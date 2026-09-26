# Coordinate-provider contract (Phase 9 plan)

Decision record for molgpu-sept-e99.1. It answers the seven questions on that
bead and the review notes attached to it. Build beads e99.3–e99.7 and the new
e99.11 point here. The counter-review (e99.2) attacks this note before any build
bead starts. The typed sketch in
`packages/viewer/test/tsx/coordinates-sketch.tsx` compiles under
`deno task typecheck:components`.

## What the code does today (evidence)

| Consumer                         | Reads                                                          | Notes                                                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Spacefill, BallAndStick atoms    | GPU `sources.positions` via `indexed()` (`spacefill.ts`)       | Already live.                                                                                                                                                      |
| Bonds                            | CPU `data.positions` (`internal/bond-columns.ts`)              | **Not live.** Endpoints and midpoints are copied on the CPU into a per-bond vertex column. The dynamic-data spec lists bonds as "follows for free"; that is wrong. |
| Ribbon, Tube, Surface            | CPU, scheduled by `geometryDeps()` on `positionsRevision`      | Rebuild on a new resource.                                                                                                                                         |
| Camera focus (`camera-curve.ts`) | CPU `displayBounds()`, cached per resource                     | Includes per-atom radii and every assembly instance transform.                                                                                                     |
| Annotation anchors               | CPU `centroidOf()`                                             |                                                                                                                                                                    |
| `@molgpu/select`                 | CPU `data.positions` for queries whose `reads` include it      | `within`, distance predicates and bond inference. Dependency tracking by revision stream already exists (`expr.ts`).                                               |
| Inferred bonds                   | `inferBonds`, keyed on `revision.positions` (`table/index.ts`) | A `withPositions()` snapshot would re-infer bonds each time.                                                                                                       |
| Picking                          | Pick id → atom row                                             | Position-free.                                                                                                                                                     |

use.gpu 0.20.0 facts that constrain the design:

- A `vec3<f32>` storage array is laid out with a 16-byte stride
  (`toGPUDims(3.5) = 4` in `@use-gpu/core`). **A coordinate buffer costs 16 B
  per atom whether it is declared `vec3` or `vec4`**, so the spec's "vec3: 12 MB
  per million atoms" is wrong; it is 16 MB either way.
- `<Kernel initial version={n}>` dispatches once per distinct `version`; without
  `initial` it dispatches every frame.
- `<ComputeBuffer>` sizes itself from the render context unless `width` and
  `height` are given, and flips `history` buffers on each dispatch.
- `<Readback>` allocates `buffers` (default 3) full-size staging buffers,
  dedupes on a numeric `shouldDispatch()` result, and cancels on unmount. It
  never blocks the frame: data arrives through `mapAsync`.

## 1. Shape

```ts
interface Coordinates {
  /** array<vec3<f32>> in topology atom order; 16-byte GPU stride. */
  readonly source: StorageSource;
  /** Always resource.data.topology.atoms.count. */
  readonly count: number;
  /** Content generation; see 3. */
  readonly generation: number;
  /** The topology owner these coordinates belong to. */
  readonly resource: StructureResource;
}
```

- Keep the `vec3<f32>` format at the boundary: it costs the same bytes as
  `vec4`, matches every current consumer, and needs no shader changes.
- Providers may declare `vec4<f32>` internally if a kernel measures faster; they
  convert at their output.
- `source` is a `StorageSource`, not a bare `ShaderSource`, because providers
  must be able to read it in a kernel and `<Readback>` must be able to copy it.
  It never crosses below `@molgpu/viewer` (INVARIANT 2).

## 2. Where it lives

A new `CoordinatesContext`, separate from `StructureContext`.

- `StructureContext` keeps `resource` and `radii`. `StructureSources.positions`
  moves to `useCoordinates().source` in e99.3;
  `useStructure().sources.positions` stays as a deprecated alias for one
  release.
- `<Structure>` provides the root `Coordinates` from the existing `ColumnSource`
  upload, with `generation = resource.positionsRevision`.
- A provider re-provides only `CoordinatesContext`, so topology consumers,
  attribute columns and radii are never re-provided by a coordinate change.

## 3. Generation, dispatch and render count

`generation` is a **content generation**, not a render count. It is a CPU-side
integer owned by each provider:

- It advances exactly when the provider's output would change: the upstream
  generation changes, or one of its own output-affecting params changes (frame
  index, matrix, mode amplitude). A re-render with equal inputs keeps it.
- Each provider keeps a monotonic counter and bumps it when the tuple
  `(upstream.generation, ...params)` differs from the last one. Generations are
  therefore unique per provider instance, not global.
- The kernel is `<Kernel initial version={generation}>`, so it dispatches once
  per generation. Pure providers (Phases 9, 12, 13) never dispatch on an idle
  frame. Stateful providers (Phase 17) advance generation once per integrator
  tick; they are the only per-frame dispatchers.
- The provider re-provides a new frozen `Coordinates` object only when
  `generation` changes. Its `source` identity is stable across generations (the
  same buffer is overwritten), so GPU consumers keep their bindings and do no
  work. They are still re-rendered by the context change; that is accepted as
  cheap and is measured in e99.4.
- Frame ordering: the dispatch must land before the draw that reads it, in the
  same frame. e99.4 asserts this in the browser (a readback after one frame sees
  the new content). If use.gpu orders compute after render, the provider falls
  back to one frame of lag and e99.4 records it.

## 4. Provider mechanics

- **Ownership.** Each provider owns exactly one output `ComputeBuffer`
  (`width = count`, `height = 1`, `format = "vec3<f32>"`, `history = 0`; Phase
  17 Verlet sets `history = 1`) and its own
  `<Compute><Stage target><Kernel/></Stage></Compute>`. Buffer lifetime is the
  provider's mount; teardown destroys it and returns the instrumentation counter
  to baseline, as `OwnedSource` does today.
- **No in-place writes.** A provider never writes its upstream buffer: siblings
  of the provider may still read upstream, and a scrubbed pure provider must be
  able to recompute from unchanged input.
- **Pass-through.** When a provider's current params are the identity (for
  example `<Superpose>` with nothing to fit), it re-provides the upstream
  `Coordinates` object unchanged: no buffer, no dispatch.
- **Count invariant.** Every provider writes all `count` rows. A `select` on a
  provider chooses which atoms drive the transform (fit atoms for
  `<Superpose>`), never which rows exist (INVARIANT 6). A Phase 12 trajectory
  with an `atomMap` subset writes mapped rows and copies the rest from upstream.

**Memory budget.** Per coordinate buffer: 1.6 MB at 100k atoms, 16 MB at 1M. A
chain of k active providers holds k + 1 buffers. Snapshot staging (6) adds 2
more full-size buffers while any snapshot consumer is mounted, plus a 12 B/atom
CPU `Float32Array`. The worst case for Phase 9 (root, two providers, snapshots
on) at 1M atoms is 5 × 16 MB + 12 MB = 92 MB. Trajectory frame windows are Phase
12's budget, not this one. Providers report bytes under a `coords:*`
instrumentation counter so the gate can assert the budget.

## 5. Consumer policy

| Consumer                      | Policy                          | Mechanism                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spacefill, BallAndStick atoms | live                            | `indexed(useCoordinates().source, rows)`; unchanged otherwise.                                                                                                                                            |
| Bonds                         | **live (new bead e99.11)**      | Upload a per-bond endpoint-row column once per topology/selection; a vertex shader reads both endpoints from the GPU source and computes the midpoint. Until e99.11 lands, bonds are a snapshot consumer. |
| Ribbon, Tube, Surface         | snapshot                        | `geometryDeps()` keys on the snapshot resource's `positionsRevision`.                                                                                                                                     |
| Camera focus and curves       | live, via GPU reduction (e99.6) | See "Focus without per-frame sync" below.                                                                                                                                                                 |
| Annotation anchors            | snapshot                        | `<Label>` and `<Distance>` use the shared CPU snapshot, including selection centroids.                                                                                                                    |
| `within`, distance predicates | snapshot                        | Queries whose `deps` include `"positions"` re-resolve on a new snapshot; others never do.                                                                                                                 |
| Bond topology (inferred)      | fixed at the root               | Snapshots reuse the root's bonds. Inference runs once on the root positions, never per snapshot (INVARIANT 6: providers never change topology).                                                           |
| Picking, tooltips             | unaffected                      | Pick ids are atom rows.                                                                                                                                                                                   |

Nothing below a provider may read `useStructure().resource.data.positions`
directly. e99.5 adds a development-mode check: reading root positions under a
non-root `Coordinates` throws.

### Snapshots

- `useCoordinateSnapshot({ maxHz = 4 })` returns the latest
  `{ resource, generation } | null`, where `resource` is a `StructureResource`
  built with `withPositions(root.data, array)` plus the root's bonds.
- Demand-driven: the nearest provider mounts two staging buffers only
  while at least one snapshot consumer is mounted, so all-live scenes pay no
  staging memory.
- A single asynchronous copy is in flight at a time. During motion, dispatches
  respect `maxHz`; after a pause, a short timer requests the final generation.
- The copy captures its generation. A result from an older generation is
  discarded, and unmount cancels publication and destroys staging buffers.
- Snapshot latency is `mapAsync` time (typically 1–3 frames) plus the throttle.

### Focus without per-frame sync

e99.6's kernel reduces `min`, `max`, `sum` and `n` over the coordinate source,
optionally through a selection's index buffer (uploaded once per selection). It
reads 32 B back per query through a `<Readback buffers={2}>` gated on
`generation`, never awaited on the render path.

- The camera uses the latest resolved bounds; until the first result arrives it
  uses the CPU bounds of the root (or latest snapshot).
- Radii: the reduction pads by the maximum displayed radius in the selection,
  which is conservative compared with today's per-atom padding. e99.6 records
  the difference on the corpus.
- Assembly instances are applied on the CPU to the 8 corners of the reduced
  AABB. That is conservative for rotated instances; e99.6 records the
  difference.
- Latency budget: at most 3 frames behind the coordinates at 100k atoms,
  measured and recorded by e99.6.

## 6. Identity provider and tests

- `<IdentityCoordinates>` (internal export) copies upstream to its own buffer.
  It exists to test chaining and teardown.
- `<OffsetCoordinates by={[dx, dy, dz]}>` (test-only) adds a constant. The
  constant result is exact, so browser tests can assert on it, unlike a
  sinusoidal wobble.
- **Unit (CPU):** the generation rule as a pure function, covering equal inputs
  (no bump), a changed param, a changed upstream, and pass-through.
- **Browser (WebGPU):**
  - `Structure > Offset > Identity > Spacefill`: a `<Readback>` of the
    downstream source equals the root positions plus `dx`.
  - Exactly one dispatch per provider per generation.
  - Zero new `structure:positions` uploads.
  - Ribbon rebuilds from a snapshot whose `positionsRevision` advanced.
  - Focus target moves by `dx` within the latency budget.
  - Unmount returns every `coords:*` counter to baseline.

## 7. Assembly instances and ViewPolicy

- Providers act on **all topology rows** in asymmetric-unit space, including
  rows outside the active model or altloc. `ViewPolicy` stays what it is today:
  a row selection that representations apply, which a provider never changes.
- Assembly instance transforms (`topology.instances`) apply **after**
  coordinates. That is where representations and `displayBounds` apply them
  today. A provider never sees instances, so `<Trajectory>` inside a symmetric
  assembly moves every copy consistently.
- Superposition onto an instance, or per-instance motion, is out of scope for
  Phase 9.

## Example composition

```tsx
<Structure data={data}>
  <Spacefill /> {/* root coordinates */}
  <Trajectory data={trajectory} frame={curve}>
    <Superpose to="first" select={ca}>
      <Spacefill /> {/* live */}
      <Ribbon /> {/* snapshot */}
    </Superpose>
  </Trajectory>
</Structure>;
```

## Changes to the shared spec

- The spec's consumer table lists bonds as live; they are CPU today (e99.11).
- The spec's "vec3 12 MB / vec4 16 MB" is 16 MB for both.
- `version` in the spec is `generation` here, defined as content generation.
