# Ordinary JSX selections and styling decision

Date: 2026-10-01. Baseline: `a24c558`, use.gpu `0.20.0`, Deno `2.9.7`. Decision
spike: `molgpu-sept-crj.9`. This records an implementation contract; production
components and public exports are unchanged by the spike. The counter-review
amendment below supersedes the original choices where indicated.

## Decision

Choose query-valued `select` props for ordinary molecular JSX. Accept
`SelectionQuery | Selection | null` on representations, EField, and the existing
selection inputs of coordinate providers. Keep omitted/null as the existing
default: first model/primary conformer for molecular representations and EField;
all transformed/fitted rows for Transform/Superpose. Unwrap's absent `center`
still means no centering. The original exact-query policy is superseded by the
counter-review amendment: ordinary queries refine the default view unless
explicitly scoped; resolved selections remain exact. No extra selection node,
class inheritance, package, or scene graph.

Queries resolve in the nearest Structure and upstream coordinate/attribute
scope. Normalize residue/bond queries to atoms through public `resolve` and
`toAtoms`; bond domains refer to declared topology bonds, not a new inferred
bond schema. Resolved selections remain reusable fixed membership: require the
nearest dataset identity, atom domain and current topology revision. Reject
foreign, non-atom and topology-stale resolved values with a named TypeError
reported as a consumer-local selection error (see amendment). Changes to
positions/attributes do not automatically re-resolve fixed membership; use a
query when membership should update. This tightens existing validation, which
currently checks only dataset/domain.

Use one small internal resolver shared by consumers, with
`pending | ready(selection) | error(failure)` states. Do not export a new
main-entry hook in this iteration. CPU queries remain snapshot-based; the API
must not imply a spatial query runs on the GPU or follows every frame. Ordinary
JSX supplies molecular values; row conversion, subscriptions, tokens and GPU
adaptation stay inside viewer adapters. Existing advanced hooks remain available
with their accurately documented scope; do not silently change their semantics
into a new public API.

## Evidence from current source

- `viewer/src/types.ts` and representation signatures distinguish resolved
  `Selection` from coordinate-provider `SelectionQuery`. `Structure src` mounts
  its children only once its request resolves; there is no main-entry table
  hook.
- `use-coordinate-selection.ts` reads root data for non-position predicates and
  a coordinate snapshot for position predicates. It never merges
  AttributesContext or AttributeSnapshotContext, so produced fields and
  predicates can disagree.
- `CoordinateSnapshotBoundary` validates owner/buffer/layout/generation and
  discards late completions. AttributeSnapshotBoundary does likewise privately,
  but its public snapshot contains only data/generation. Reuse these mechanics;
  do not equate independent generation integers.
- `select/src/index.ts` constructs `within().deps` as topology/positions only.
  Its evaluator later merges child deps into the resolved Selection. That is too
  late for subscription planning. A local executable probe printed inner
  `[topology,attributes]` and outer `[topology,positions]` for an attribute
  predicate nested in `within`. Propagate child deps during construction before
  implementing the viewer resolver.
- `internal/field-plan.ts`, `use-field.ts` and representation adapters already
  bind nearest volumes, produced attributes and annotations. Reuse them rather
  than baking color fields or copying scientific evaluators.
- Ribbon/Tube use CPU coordinate snapshots to construct geometry. Their current
  color props are flat vectors. Ribbon can merge produced ssCode separately;
  this does not make Ribbon's color prop accept a Field.

## Scope, pending and publication rules

| Input/state                               | Required behavior                                                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structure source pending                  | Structure's loading branch; molecular descendants are absent. Never resolve against the previous request.                                                                                                  |
| Topology-only query                       | Resolve immediately from nearest structure; no coordinate/attribute readback.                                                                                                                              |
| Attributes-dependent query                | Merge CPU columns with nearest produced-column snapshots, with nearest producers shadowing CPU/outer values.                                                                                               |
| Positions-dependent query                 | Use nearest published coordinate snapshot; never substitute root positions below a provider.                                                                                                               |
| Combined query                            | Evaluate once against one immutable CPU data value containing the chosen positions and all required attribute columns.                                                                                     |
| First required GPU snapshot missing       | Pending: representations/labels draw nothing; coordinate providers pass upstream coordinates through; EField provides no newly computed volume subtree. Never convert pending to null/default selection.   |
| Ready empty                               | Valid zero membership: draw nothing; Transform changes no rows, Superpose uses its existing insufficient-fit passthrough, Unwrap centers no components. EField does not compute/render a zero-atom volume. |
| Query failure                             | Contain the named resolution error at the consumer and report it through selection status; never show default membership. Source callbacks still own source requests only.                                 |
| Same sources, newer content still pending | Retain last complete selection tuple as a documented snapshot; update when another complete tuple is available.                                                                                            |
| Owner/source/layout/topology replacement  | Invalidate old tuple immediately; return pending until replacement inputs publish. Late completions cannot revive old membership.                                                                          |

Current attribute names are not present in the public query dependency list, and
`where` predicates are opaque functions. The crj.22 prerequisite will declare
column names for named attribute queries; subscribe precisely for those queries.
Only opaque attributes-dependent predicates conservatively subscribe to every
visible produced column in the nearest attribute map. Subscribe via a stable
child/component traversal rather than a variable number of Live hooks. Merge
each chosen column onto the coordinate snapshot (or root data if positions are
not read) with `withAttributes`. Preserve coordinate identity/topology and
chemical graph. Check each column's domain, row count and source ownership
before merging. Missing CPU-only attributes keep the evaluator's existing
error/fallback policy; they are not infinitely pending. Authors of `where` must
declare positions when reading them; arbitrary predicate code cannot be
inspected. `within` must transitively expose its inner deps.

The tuple is the latest available published snapshot for each required source.
It can contain coordinates from one displayed frame and an attribute from an
older frame. This is an explicit bounded-readback policy, **not same-frame
scientific synchronization**. Record/cache the full per-source tuple internally;
never compare coordinate and attribute generation integers to infer consistency.
Do not alternate root and produced values while a producer warms up. Defaults
remain existing 4 Hz demand-driven snapshots with on-pause publication. If
strict same-frame queries become required, add causal input tokens and a
separate contract; current publication surfaces cannot prove that policy.

Live Spacefill/Bonds positions and field colors can consequently advance ahead
of their query membership. Ribbon/Tube/Surface geometry already trails through
snapshots; keep that documented distinction. Sharing equivalent query
resolutions is desirable within one exact scope, but do not add a generic
cache/resource framework to achieve it. Accept correctness before optional
sharing optimization.

## Alternatives considered

| Alternative                                                              | Assessment                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main-entry `useSelection(query)` returning a tagged pending/ready result | Useful for custom selection/set-operation logic, but requires a descendant component and explicit state branches for ordinary props. Defer until a concrete ordinary consumer needs it; future hook must use the same resolver. |
| Promote `useCoordinateSelection` unchanged                               | Reject: null currently conflates readiness with the existing default-view prop convention, and GPU attribute overrides are absent.                                                                                              |
| Expose resource/table and ask each scene author to call resolve          | Retain lower-package use for preloaded workflows, but it repeats ownership and publication plumbing beneath `Structure src`.                                                                                                    |
| GPU-query compiler / strict frame synchronization                        | Defer: arbitrary CPU where predicates and current independent snapshot publications do not support these promises.                                                                                                              |
| New selection/style scene nodes                                          | Reject: queries and fields are already reusable values; another tree adds no required capability.                                                                                                                               |

## Styling support and types

Retain the actual narrow styling matrix for this iteration. No new Ribbon/Tube
field implementation is required by this spike, and the broader DESIGN.md field
intent is not a support claim.

| Component                                           | Color                                                                         | Size/geometry controls                                             | Opacity         |
| --------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------- |
| Spacefill                                           | flat vector or numeric color Field                                            | numeric scale; immutable atom radii                                | numeric uniform |
| Bonds                                               | flat vector or numeric color Field per endpoint                               | numeric width                                                      | numeric uniform |
| BallAndStick                                        | same color support as both children                                           | numeric ball scale/stick width                                     | numeric uniform |
| Surface                                             | flat vector or numeric color Field via atom attribution and position sampling | numeric probeRadius/resolution; sampleOffset is a sampling uniform | numeric uniform |
| Ribbon                                              | flat vector                                                                   | smooth and secondaryStructure affect geometry                      | numeric uniform |
| Tube                                                | flat vector                                                                   | numeric radius is a binding; smooth affects geometry               | numeric uniform |
| Isosurface / VolumeSlice / FieldLines / FieldArrows | existing flat color / volume-ramp contracts                                   | existing numeric geometry/line controls                            | numeric uniform |

Fields are subject to the existing numeric WGSL/atom-domain input plan,
including supported residue-to-atom lifts and contextual volume availability; a
label Field or CPU-only expression is not a supported color. Changing a
color/opacity/material must not rebuild geometry or upload coordinates. First
demand for a previously unused immutable column may upload once. A query
membership change can rebuild geometry; that is selection work, not recoloring.
Generic field-valued opacity, radius, visibility or Ribbon/Tube color stays
unsupported and must be described as such. Cartoon shape parity remains in
existing `bxl`, not a new styling task.

Installed `live/mjs/types.d.mts` defines LiveElement as null/undefined/false,
DeferredCall, recursive arrays or ReactElementInterop. `ViewerElement = object`
accepts arbitrary objects and forces casts at renderer handoff. Choose
`ViewerElement = LiveElement` at the viewer boundary; this deliberately revises
the main-entry no-use.gpu-types claim. Lower packages remain renderer-free. Keep
ViewerComponent as a function returning LiveElement: native LiveComponent
returns `any`, so adopting it wholesale would weaken the return check.
Duplicating the recursive native shape as an owned facade adds maintenance
without insulation from the pinned renderer's runtime contract.

Installed PBR/Basic/NormalMaterialProps admit shader maps and render callbacks;
PBR also admits lazy scalars. Keep those advanced features through a wrapper
`(children: LiveElement) => LiveElement` using native workbench materials.
Replace MaterialSpec's Record with an owned discriminated **constant** subset:
PBR type optional, metalness/roughness numbers and albedo/emissive numeric
vectors; Basic type required with numeric color; Normal type required without
extra props. No children/render/maps in a spec. Keep current molecular PBR
defaults and ambient material behavior. This is a documented migration for
previously accepted unknown forwarded properties, not a claim native material
types are renderer-free. The checked type comparison demonstrates current
object/typo acceptance and native/proposed rejection; no production type aliases
are changed here.

## Source presentation coordination

For `s5o.2`, retain Structure/Volume as dataset gates with their current loading
and source-error branches. Retain Trajectory's upstream passthrough while
opening and throwing its current request failure. This is an intentional
difference: playback layers coordinates over an existing structure. It need not
add loading props just for parity. Retry/source-to-data/replacement presentation
evidence remains `s5o.2` work; source/playback separation remains `s5o.3`. Query
pending is independent of loader pending and never overloads loading/error
props.

## Executable example and acceptance

`packages/viewer/test/tsx/ordinary-jsx-spike.tsx` imports only real main
molecular entries and application-owned use.gpu components. It has no
mock/declaration components, advanced hooks, row arrays, revision handling or
StructureResource. It exports a runnable BaselineScene/mountBaseline with loaded
Structure, Trajectory, Transform, Ribbon/atoms and nested computed
EField/isosurface. Provide a BCIF with partialCharge (or a custom public loader
returning charged data) and an atom-order-compatible trajectory. It is a
browser/Vite module, not a Deno runtime module (the pinned workbench CJS
limitation still applies).

AcceptanceScene is the exact executable JSX target for ligand/site and
coordinate-plus-produced-DSSP queries. Five `@ts-expect-error` directives expose
currently absent query props. They are checked blockers, **not an assertion that
the target works today**. Once the resolver lands, remove them and mount this
scene in the existing browser harness. `ordinary-jsx-types-spike.ts` compares
current/native types and the proposed narrow facade without changing exports.

Required browser assertions in the follow-up: held first publications show no
default membership; ready-empty stays empty; combined queries use both published
inputs; a producer shadows root values even before its first snapshot; nested
and sibling structures remain isolated; equal local generations cannot mix
sources; replacement/resize/unmount reject late results; no uncaptured GPU
errors occur. Use controlled producers/readbacks, not timing sleeps as readiness
proof. Test source presentation transitions under `s5o.2`. Pure tests cover
transitive deps and public domain conversions. The final public gate must remove
all target suppression directives and include a real browser composition, not
merely a green API sketch.

## Counter-review amendment (2026-10-01, crj.23)

The counter-review endorses the core selection/value and type decisions. Accept
its usability concerns with the following seven recorded choices. These choices
supersede the original exact-query and throw-on-query-failure policies. This
amendment changes documentation and the research example, not production APIs.

1. **Queries refine a view; resolved selections stay exact.** For
   representations, EField, Label/Distance and viewer focus, default query
   evaluation uses the first model and primary conformer. A HEM component query
   must not accidentally draw an entire NMR ensemble or every altloc.
   Coordinate-provider queries retain all-row evaluation by default, preserving
   the existing transform/fit meaning. Resolved atom selections are never
   implicitly intersected with a view.

   In crj.22, add renderer-free query scope metadata using the existing table
   vocabulary
   `view: { model?: "first" | "all" | number, altloc?: "primary" | "all" }` and
   a proposed `withView(query, view)` builder. `model(n)` both filters by model
   and declares that model scope; `allModels()` and `allConformers()` explicitly
   broaden their respective scope axes. The viewer supplies the missing defaults
   for its consumer kind; pure `resolve(query, data)` retains its current
   full-table default. Add a renderer-free scoped evaluation option in select
   for the viewer adapter; do not filter/reorder the underlying topology table.

   Apply eligibility throughout query evaluation, including within seeds and
   query-level not's complement universe, **not just an intersection of final
   rows**. Otherwise an inactive model's ligand could select active-model atoms.
   Keep an unset axis distinct from an explicit opt-out. Combinators/within
   inherit compatible child scopes; conflicting explicit scopes require an outer
   withView override, and are reported as a selection error at evaluation
   without guessing. An outer override is authoritative. Document this with
   multi-model and altloc examples in select and viewer READMEs. No predicate
   inspection to guess a model.

2. **Expose status, make empty warnings opt-in.** Add one optional
   `onSelectionStatus` callback to selection-consuming components, leaving
   provider `onStatus` scientific callbacks intact. A public discriminated
   SelectionStatus reports pending, ready with atom count (including zero), or
   error with cause. Include the prop slot (select/center/a/b/focus), query
   label, and source summaries: opaque owner/source IDs, input kind/attribute
   name and local publication generation. These IDs are diagnostic values, not
   resources or buffer handles. Include `consistency: "latest-published"` for
   snapshot inputs; do not claim a detected mixed-frame flag when causal frame
   information is unavailable. Ready may report `updating: true` while retaining
   its previous complete tuple. Publish callbacks after evaluation on
   state/tuple changes, not every redraw or through readiness timers. Distance
   reports a and b separately.

   Add opt-in `warnEmptySelection` diagnostics, default false. For a stable CPU
   query (no positions or produced-column inputs), warn once per query/source
   and relevant revision tuple when it resolves empty; include label and view
   scope. This catches component-name typos without treating intentional empty
   results as bugs or flooding playback logs. A zero-count status is always
   observable through the callback. The review's unconditional warning proposal
   is narrowed deliberately because empty selections are valid values.

3. **Contain selection failures at the consumer.** Catch only selection
   planning/evaluation/validation failures in the shared resolver, including
   foreign or topology-stale inputs, and return error with a named cause. A bad
   where predicate must not unmount sibling representations. A failed draw or
   Label/Distance draws nothing; a failed coordinate selection passes upstream
   coordinates through; failed EField exposes no computed-volume descendants.
   Invalidate old membership on failure instead of silently retaining it. Report
   via onSelectionStatus, or a deduplicated console error if no callback exists;
   errors are never silently converted to ready-empty/default membership. Do not
   catch WebGPU errors, unrelated render failures or exceptions thrown by user
   callbacks. Structure/Volume error props remain source-request presentation.

4. **Keep text parsing explicit.** No ambiguous `select="..."` prop. Existing
   `compile(await parseSelection("pymol", text))`, using select and io main
   exports, is the supported construction path; other supported languages are
   explicit. Callers own async parsing, failure and memoization before supplying
   the query. This avoids adding lazy Mol* parser loading as another hidden
   consumer pending source. crj.22 documents that path alongside discoverable
   protein/nucleic/water, component/ligand, chain/residue, model and
   secondary-structure builders, plus query-level and/or/not. Keep where as an
   escape hatch, not the ordinary example.

5. **Partial residues follow the trace guide rule.** Keep current traceTable
   semantics: a residue contributes to Ribbon/Tube only when selected atoms
   include an eligible trace guide (or the existing coarse-grained guide
   fallback). A selected side-chain atom alone does not include the residue, and
   missing guides end a run. Do not silently expand atom queries to whole
   residues. Explicit residue-domain queries expand to their atoms as already
   specified. Record and test both side-chain-only exclusion and guide/fallback
   inclusion; docs must explain why a proximity query may leave a gap in a
   ribbon.

6. **One SelectionInput across ordinary selection consumers.** Export the alias
   `SelectionInput = SelectionQuery | Selection | null` from viewer main and use
   it for select props, Unwrap.center, Label.select, Distance.a/b, live focus
   and viewer camera focus inputs. Distance keeps both props required and
   rejects null as a consumer-local selection error, preserving its
   two-explicit-anchor meaning. Label.at explicitly bypasses centroid selection
   resolution. Live focus returns null while pending/error, so a camera retains
   its caller-owned pose; it must not substitute root selection positions. Keep
   the existing configurable ready-empty focus fallback. Pure preloaded camera
   evaluation cannot wait for GPU snapshots: queries resolve against its
   supplied table and errors report synchronously there. This exception must not
   be advertised as a live combined-snapshot path.

7. **Document snapshot limits where users encounter them.** The viewer README
   now distinguishes supported current APIs from this future contract and states
   the default scope and snapshot limitations. crj.20 must also put the 4
   Hz/on-pause, latest-published input tuple policy into each affected
   component/hook's API docs and its SelectionStatus source summaries. Atom
   positions/color can advance ahead of membership; coordinates and attributes
   can represent different frames. A complete tuple means available inputs, not
   same-frame scientific consistency.

The example now uses public secondaryStructure, backed by ssKind, for the full
H/G/I helix category; the review correctly identified that an alpha-helix-only
predicate was not a sufficient ordinary helix example. The spike originally used
opaque table predicates; crj.22 replaces those with real public named builders
and independent pure vocabulary tests. crj.20 must still remove the five prop
blockers and browser-render the target; renderer adaptation is not implemented
by crj.22.

Ribbon/Tube Field colors remain optional `o4r` work, with truthful narrow
support claims until it lands. crj.21 should document
representation-color/material-color interaction against the installed native
material implementation; named material presets remain optional and do not block
this decision.

Amendment validation: the component type-check task and scoped formatting/lint
are rerun; the existing pure secondary-structure suite covers H/G/I
classification. No new browser or GPU behavior is implemented or claimed by this
amendment.

## Bounded follow-ups and validation

- `molgpu-sept-crj.20`: scoped query-prop resolution, domain normalization,
  scoped view evaluation and publication/status regressions. Blocks `crj.13`.
- `molgpu-sept-crj.21`: native LiveElement boundary and narrow constant material
  specs with public positive/negative checks and migration docs. Blocks
  `crj.13`.
- `molgpu-sept-crj.22`: renderer-free query vocabulary, declared column inputs,
  view policy and transitive deps; blocks `crj.20`.
- `molgpu-sept-crj.23`: this counter-review amendment; blocks `crj.22` and
  `crj.20` until the decisions and acceptance changes are recorded.
- `molgpu-sept-o4r`: optional Ribbon/Tube color Fields; P3, not a gate blocker.
- Reuse `s5o.2`, `s5o.3`, `s5o.15` and `bxl`; no duplicate loader or cartoon
  work.

Validation: `deno task typecheck:components` passed with both new TS/TSX files,
including expected type failures. Removing the target's suppression directives
in a temporary copy reproduced exactly five missing-query-prop diagnostics and
no unrelated errors. The transitive-dependency probe reproduced the missing
attribute dep. Scoped `deno fmt --check`, `deno lint` and `git diff --check`
passed. No production source/API change, publication or deployment. No new
runtime composition or GPU lifetime claim is made: neither baseline nor target
has been rendered in this spike. Browser acceptance, public API snapshots,
hardening and JSR dry run are required when the implementation follows.
