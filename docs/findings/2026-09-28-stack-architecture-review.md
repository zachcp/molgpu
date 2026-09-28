# Stack Architecture Review

Date: 2026-09-28. Source baseline: `1175c64`. Tracking epic: `molgpu-sept-crj`.
Review and planning only; no package implementation changes.

## Recommendation

Keep the eight packages and the central model: immutable molecular data,
renderer-free queries/fields, scoped Live providers, and representations beneath
an application-owned use.gpu scene. The broad architecture is sound. The weakest
part is the consistency of the contracts between those pieces, especially when
providers are nested, data is replaced, or two independently tested features are
combined.

Prioritize correctness at those boundaries before new dynamics or GPU geometry
work. Separate loading, playback, computation and drawing internally, with small
public JSX conveniences over them. Do not equate composability with one
published package per component. Consider subpath entries before new packages,
and justify either with an isolated-consumer test or a measured dependency cost.

## Findings

### F1. P1: Standard field values do not compose across representations

Evidence: `viewer/src/internal/representation.ts:51` compiles a field to
discover attributes without a volume grid. `fields/src/primitives.ts:953`
rejects a nearest `volumeSample()` without that grid. Thus Spacefill/Bonds fail
before `useField` can supply the enclosing Volume/EField. A pure reproduction of
that exact compile call throws the expected missing-grid error.

Separately, `joinAnnotation` compiles to an `annotation` binding, while the same
discovery helper retains only `attr:*`. `viewer/src/use-field.ts:70` has no
fallback that fills and uploads an annotation binding. Surface duplicates the
discovery pass using `PROBE_GRID` and explicitly rejects annotation bindings
(`surface.ts:59`). It also rejects residue-domain attribute sources, even when a
field has an atom-domain lift.

These are concrete gaps in the promised unified field model. Use one small field
input plan with explicit row attribution and domain conversion. Keep field
construction/evaluation pure; let the viewer own uploads and context resolution.
Track: `molgpu-sept-crj.1`.

### F2. P1: GPU code attributes cannot complete their generic CPU round trip

`attribute-producer.ts` accepts `ssCode` and `formalCharge`.
`attribute-snapshot.ts:145` reads f32 values, then `:212` passes them directly
to `withAttributes`. `table/src/attributes.ts` requires Uint8Array for ssCode
and Int8Array for formalCharge. Both failures were reproduced using the exact
CPU publication inputs. The readback marks the generation published before
calling the callback, then catches its exception, potentially leaving no
snapshot and no retry. The separate GpuDssp implementation converts codes and
avoids this path.

Define checked semantic conversion at the GPU/CPU boundary. Consumers should
depend on the attribute contract, not its producer name: Ribbon currently only
merges a produced ssCode snapshot when provenance is exactly `gpu:dssp`
(`ribbon.ts:152`). Track: `molgpu-sept-crj.2`.

### F3. P1: Nested structures inherit another structure's trajectory metadata

`structure-context.ts:98` resets topology, coordinates, attributes and
snapshots, but not TrajectoryContext. Consequently
`Structure A > Trajectory A > Structure B > Unwrap/UnitCell/Superpose` combines
B's coordinates with A's box or first-frame reference. `superpose.ts:268`,
`unwrap.ts:403` and `unit-cell.ts:46` consume that inherited context without an
owner check. This is established by the context paths; a nested browser
regression is still needed.

Move the trajectory context contract out of the player implementation, associate
topology-bound metadata with its owner, and define what a Structure boundary
shadows. Volumes and the timeline need independent, deliberate inheritance
rules. Track: `molgpu-sept-crj.3`.

### F4. P1: Default view policy differs by representation

Spacefill and Bonds use all rows when `select` is omitted (`spacefill.ts:246`,
`bonds.ts:280`). Ribbon, Tube and Surface use `useActiveRows`, whose default is
the first model and primary conformer. EField intersects every selection with
that default active view (`efield.ts:474`), so an explicit model-2 selection can
become empty there even though other representations accept it.

Measured from the checked-in corpus:

| Structure | Retained atom rows | Default active rows |
| --------- | -----------------: | ------------------: |
| 2K39      |            142,796 |               1,231 |
| 1EJG      |                843 |                 641 |

Retaining all source rows is correct; silently drawing all 116 NMR models in one
representation and one model in another is not a coherent default. Resolve view
policy once conceptually, with explicit per-consumer overrides where useful.
Track: `molgpu-sept-crj.4`.

### F5. P1: Coordinate snapshots can change chemical connectivity

`coordinate-snapshot.ts:144` inserts `bondTopology(root)` into an otherwise
coordinate-only snapshot as explicit bonds, preserving identity and topology
revision. `select/src/bond-graph.ts` treats nonempty explicit bonds differently
from its Mol*-compatible inferred chemistry. The two inference algorithms are
intentionally different today, but the snapshot silently changes which is used.

Reproduced on 1EJG with identical positions: the root selection graph has 860
edges; constructing the snapshot topology gives 868. The display bond inference
also has 868. This can change connected selections beneath an identity
coordinate provider. Preserve chemical graph semantics across coordinate
snapshots, then decide whether rendering and scientific consumers share one
graph or explicit filtered views. Track: `molgpu-sept-crj.6`.

### F6. P1: Snapshot identity is weaker than provider identity

`internal/throttled-readback.ts:75` deduplicates using a generation integer
alone; `:97` accepts an asynchronous result on the same basis. A different
buffer with the same generation can be skipped or receive stale values from the
old source. `CoordinateSnapshotBoundary` similarly checks the integer before
attaching the current owner. Generations are local to providers, so they are
insufficient as global identity. Attribute readback has a buffer check but a
separate lifecycle.

Use an explicit owner/source/content token and validate replacement, resizing,
unmount and in-flight completion. This is a source-confirmed failure condition,
not a browser reproduction in this pass. Track: `molgpu-sept-crj.5`.

### F7. P1: GPU retirement already fails; readiness remains inconsistent

`deno task test:viewer:gate2` reproduced both a new bfactor buffer allocation
and the WebGPU error
`[Buffer "molgpu:attribute:element"] used in submit while
destroyed`. This is
the existing `molgpu-sept-19s`, not a new duplicate bug.

The allocation assertion also needs a precise contract. Switching to a
previously unused attribute can legitimately upload that column once. It must
not rebuild geometry, rewrite coordinates, repeatedly upload immutable columns,
or destroy a buffer still referenced by a submitted draw. Do not solve a test's
zero-allocation expectation by eagerly uploading every attribute.

CoordinateKernel has a dispatch notification/readiness path; AttributeProducer
does not wait for `coordinates.ready`. Attribute snapshots wait an assumed
200ms, bounds use 16ms, and Published schedules a burst of repaints through
800ms. These are risks under slow compilation and replacement, not proof of
failure in every ordinary scene. The existing component browser suite passes.

Keep `19s` as the concrete fix. Use `molgpu-sept-crj.7` for a shared ordering
and lifetime contract; reuse `s5o.7` for subsequent adoption of upstream
primitives.

### F8. P2: Assemblies exist in the schema and framing, but not end to end

`io/src/bcif.ts:467` produces only identity operators. The viewer's instance
transform reads are in CPU/live camera framing; representation drawing paths do
not expand those instances. Picking's `instance` is currently a drawn item
index, not a biological assembly operator (`internal/pick-resolve.ts:32`).

A hand-built translated instance can therefore affect framing without producing
the corresponding drawn copy. Imported assembly metadata also needs a deliberate
selection policy. This is a missing capability requiring an architectural spike,
not a mandate to implement all symmetry support now. Track: `molgpu-sept-crj.8`.

### F9. P2: Routine JSX still exposes data-resolution plumbing

Representation `select` accepts a resolved Selection, while transform props take
SelectionQuery. With `<Structure src=...>`, ordinary descendant selection work
requires an advanced resource hook and `resolve`, or advanced
`useCoordinateSelection`. The latter switches between root/coordinate snapshots
but never merges GPU attributes (`use-coordinate-selection.ts:7`). A predicate
on a produced attribute can disagree with the field that colors it.

Prefer reusable query values resolved against the nearest scope, either as props
or through one ordinary public hook. Resolved selections remain useful for
preloaded data. Specify pending, empty, foreign dataset and combined
coordinate/attribute snapshot behavior before choosing the API. Do not use null
for both pending selection and draw-everything.

Also settle the actual styling matrix: Ribbon/Tube color is flat, several size
props and opacity are numeric, and not every Field works in every
representation. Use accurate narrow contracts or complete the intended shared
behavior; do not advertise unsupported uniformity. The permissive
`ViewerElement = object | ...` and `MaterialSpec = Record<string, unknown>` hide
upstream names but do not necessarily improve type safety. Compare native Live
types with a minimal owned facade in the spike. Track: `molgpu-sept-crj.9`.

### F10. P2: Loader lifecycle and byte transport need one explicit contract

Existing `s5o.1` correctly identifies Trajectory ignoring useAwait's pending
flag; its old value/error survives a new request. Superpose's first-frame
useAwait also ignores pending (`superpose.ts:273`). Structure and Volume do
check pending. Trajectory bundles loading, frame caching, GPU window ownership,
interpolation, PBC and metadata publication into one module. Reuse `s5o.2` and
`s5o.3` for source orchestration and source/playback separation.

The default loaders only suppress results after work completes. Whole-file
`io/src/input.ts:17` offers no signal/fetch options; trajectory IO already has
both. `byte-source.ts` checks Range response status and length, but does not
validate returned Content-Range offsets or continuity of the remote object.
Wrong-offset bytes of the right length are accepted. Track these transport
improvements in `molgpu-sept-crj.12`, independently of JSX policy.

### F11. P2: Data ownership and JSR independence are not yet proven together

Structures and attributes copy input columns. In-memory createTrajectory only
copies frame objects (`table/src/trajectory.ts:109`): changing input positions
after construction changes `source.read(0)` without a new identity or revision.
This was reproduced. Trajectory frames are documented as immutable by contract,
so settle copy versus borrowing explicitly rather than treating every retained
reference as an accidental bug. Track: `molgpu-sept-crj.10`.

Structure identity and timeline curve internals rely on module-private WeakMaps.
Workspace aliases ensure tests see one implementation; they do not prove values
cross independently resolved package versions. Several READMEs still claim npm
peer dependencies. The hardening checker fabricates npm metadata and rejects a
declared table dependency as non-peer (`scripts/check-hardening.mjs:581,659`).
Those claims need replacement with tested JSR behavior.

Deno supports workspace member imports and inheritance of root imports, so the
absence of repeated sibling mappings in each manifest is not itself a bug. See
the official
[workspace documentation](https://docs.deno.com/runtime/fundamentals/workspaces/).
The successful JSR dry run is useful evidence, but an external consumer and
multi-copy identity test are still needed. Track: `molgpu-sept-crj.11`.

## Package Assessment

| Package  | Retain                                                                | Focus of deeper review                                                                                                 |
| -------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| table    | CPU schema, typed arrays, revisions, provenance, volumes/trajectories | Ownership, serialization/identity, stable chemistry; assess algorithm placement without an immediate split.            |
| io       | Lazy Mol* wall and renderer-free loaders                              | Abortable transport, Range correctness, assembly lowering, independently usable format entry points only if justified. |
| select   | Reusable queries, explicit domains, sorted selections, Mol* oracle    | Consistent graph semantics and scoped live query inputs; do not move GPU state here.                                   |
| fields   | Pure CPU evaluation and WGSL/binding descriptions                     | Complete the viewer adapter; separate input discovery from compilation requiring contextual grids.                     |
| geo      | Pure kernels and reference geometry                                   | Inventory renderer-free geometry assembly still under viewer/internal; move only where ownership becomes simpler.      |
| dynamics | Pure scientific math and `./wgsl`                                     | Shared connectivity, units, CPU/GPU parity; keep resource scheduling out.                                              |
| timeline | Arbitrary-time sampling and small core-math adapter                   | Cross-copy curve handling and real public API examples; no new global clock abstraction.                               |
| viewer   | Caller-owned render tree, nearest contexts, molecular components      | Source/playback separation, common field adapter, publication tokens, GPU lifecycle and ordinary query ergonomics.     |

The goal is to hide storage mechanisms from scene authors, not to hide the
scientific model from users of the lower packages. Typed arrays remain a good
lower-level interface. Inheritance here means scoped context shadowing and
explicit props, not class hierarchies.

## use.gpu Assessment

Reviewed installed 0.20.0 implementations of RawData, useRawSource,
ComputeBuffer, Kernel and ComputePass, alongside the earlier repository
feasibility notes.

- RawData and indexed ShaderSource consumption are appropriate for static
  columns. Preserve RawData's packing/reconciler behavior until a replacement
  proves equivalent. useRawSource uploads the backing ArrayBuffer directly;
  typed-array view offsets and packed formats need explicit verification.
- Linked fields and shared immutable attribute sources are a good direction.
  Centralize binding/lifetime rules rather than replicating them in each visual.
- Kernel with initial/version and explicitly sized ComputeBuffer is a good fit
  for pure transforms. Distinguish content change from publication readiness so
  downstream work does not accidentally run twice or consume zeros.
- ComputePass immediate itself encodes/submits during evaluation. Thus a raw
  encoder is not inherently an architectural violation. Compare multi-stage
  reductions and graph passes against native scheduling, then document any small
  raw exception. Do not rewrite scientific kernels simply to wrap every call.
- Readback scheduling, subscriber tracking and buffer retirement have multiple
  implementations today. Their replacement contract must be proven before
  deduplicating them. A fixed delay is not a GPU dependency.
- CPU surfaces/traces remain valid reference and static paths. Existing deferred
  GPU trace/marching-cubes tasks should remain measurement-driven, not
  prerequisites for this cleanup.

## Follow-up Beats

The new epic has 13 children. Issues contain bounded scope and acceptance
criteria; existing work keeps its original ownership and history.

| Order                 | Beads                                                   | Outcome                                                                                                                                      |
| --------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1: Correctness        | `crj.1`-`crj.6`, existing `19s` and `s5o.1`             | Field composition, typed attributes, dataset isolation, view policy, snapshot identity, stable connectivity and reload/lifetime regressions. |
| 2: Contracts          | `crj.7`, `crj.9`, `crj.11`, existing `s5o.3`            | Proven GPU scheduling, clean primary JSX, isolated JSR consumption and loading/playback ownership decisions.                                 |
| 3: Simplify           | `crj.10`, `crj.12`, existing `s5o.2`, `s5o.7`, `s5o.14` | Explicit data ownership and transport; remove duplicated loading, field binding, readback and obsolete compatibility code where justified.   |
| 4: Complex structures | `crj.8`                                                 | Decide assembly/operator behavior and produce bounded work or explicit deferral.                                                             |
| 5: Acceptance         | `crj.13`, related `s5o.11`                              | A public composition matrix, restored lifetime gate, truthful support claims and package-consumer evidence.                                  |

All shortened IDs above have prefix `molgpu-sept-`. These are logical execution
beats, not instructions to serialize independent narrow fixes. Decision spikes
must create implementation follow-ups when needed; closing a spike does not
complete its feature.

Existing issues also reused: `s5o.6` (typed browser harness), `s5o.13` (docs,
already in progress), `s5o.15` (public examples), and the `efv` DSSP work. Do
not duplicate or reopen these based only on this report. Existing `e99.9`,
`u71.11`, `t1s` and `7uv` cover possible GPU performance follow-ons; this review
does not activate them.

## Validation and Limits

Performed under Deno 2.9.7 / TypeScript 6.0.3:

| Check                                                  | Result                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deno task test`                                       | 439 passed, 0 failed; includes parser/selection/scientific oracles.                                                                                                      |
| `deno task check:hardening`                            | H1-H6 pass for all eight packages, subject to the checker limitations above.                                                                                             |
| `deno task typecheck:components`                       | Passed. This also checks a historical declared API sketch, so it is not sufficient by itself.                                                                            |
| `deno task jsr:check`                                  | Dry run passed for all eight packages and exported subpaths; nothing published.                                                                                          |
| `deno test -A packages/viewer/test/run-components.mjs` | Passed in Chrome 153.0.8010.53; initial sandbox port denial resolved by running the existing test with the required permission.                                          |
| `deno task test:viewer:gate2`                          | Failed with new-attribute allocation assertion and destroyed-element-buffer GPU error, consistent with existing `19s`.                                                   |
| Pure boundary probes                                   | Missing volume discovery grid, annotation binding ID, rejected f32 code snapshots, borrowed trajectory input mutation, corpus active counts and graph change reproduced. |

Component build warnings remain about config `@std/path` resolution and an ESM
default fallback for core interpolation; the suite still passed. Capture them in
the isolated-consumer/harness follow-ups rather than presenting them as runtime
failures.

This is a top-down architecture review of all package contracts and
representative vertical paths, not an exhaustive numerical audit or a full
GPU/performance sweep. No newly proposed nested-scope, slow-compilation,
assembly or external-install browser test was implemented. Such claims are
explicitly source findings or spikes above. No changes to source, tests,
manifests or API snapshots were made.
