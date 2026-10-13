# Primitive props: second-pass review

Date: 2026-10-12. Tracking: `molgpu-sept-48w`. Review baseline: freshly fetched
`origin/main` `da52c90` (merged PR #93). Branch: `codex/primitive-second-pass`.
This is a review, with findings recorded during inspection; production changes
belong to bounded follow-ups.

## Evidence log

- Read the root/viewer README and manifests, current architecture guide, the
  October 11 spike and completion notes, and the original Beads `d90`, `erf` and
  `gvq`. The first pass is complete, not an unfinished blanket rewrite.
- Refreshed the existing use.gpu source checkout. Current `origin/master` is
  `8a53c6913b784d2c29c1af66327d0fb5781f8881`; inspect that ref explicitly, since
  the checkout itself retains the earlier spike's commit. Runtime dependency
  remains exact `0.21.0-rc.2`.
- Confirmed current master contains `packages/2d-plot`, and GPU Plot Arrow still
  derives props from traits and emits a schema/archetype layer record. That
  architecture is inspiration, not proof that adding its aggregation path would
  simplify molecular GPU-source consumers.
- The strongest initial opportunity is duplicated public/resolved declarations:
  Bonds, BallAndStick, Tube and Surface repeat nearly their entire contract only
  to narrow `select`. Ribbon already names its public props but repeats its
  resolved contract. This is removable type maintenance, independent of GPU or
  scientific changes.
- FieldArrows is a useful completed pilot. FieldLines and VolumeSlice still
  combine caller contracts, normalization, WGSL and Live wiring. They are the
  next candidates for the same small feature-local separation, not a new generic
  primitive framework.

## Decision

The first pass chose the right direction, but there is more straightforward
cleanup to do. Define a caller contract once, derive the narrower adapter
contract, and separate substantial option/shader construction from Live wiring.
Keep direct native layers and the existing scientific and ownership adapters.
The strongest simplification removes duplicated definitions or separates values
with different update dependencies; merely moving lines into more files does not
accomplish that.

Do not introduce a universal primitive factory, generic source/provider union,
or public `TraitProps` hierarchy. Retain the eight package boundaries. Lower
packages own scientific values and algorithms; this review does not propose
moving them into viewer traits.

## Upstream comparison

The refreshed master does contain the Bezbox-style 2D backend:
[2D Arrow](https://gitlab.com/unconed/use.gpu/-/blob/8a53c6913b784d2c29c1af66327d0fb5781f8881/packages/2d-plot/src/shape/arrow.ts)
and its
[traits](https://gitlab.com/unconed/use.gpu/-/blob/8a53c6913b784d2c29c1af66327d0fb5781f8881/packages/2d-plot/src/traits.ts).
The
[GPU Arrow](https://gitlab.com/unconed/use.gpu/-/blob/8a53c6913b784d2c29c1af66327d0fb5781f8881/packages/plot/src/shape/arrow.ts)
still uses `makeUseTrait`, schema emitters and archetypes, then yields a layer
record. The diff from the prior review's `0928127` adds the 2D Plot package; it
does not replace GPU Arrow's contract with a new molecular abstraction.

Read both master and the installed rc.2 `traits/mjs/useTrait.mjs`: the parsed
trait result is one mutable object reused across renders. Its fields must be
unpacked before memoization. `parseTrait` instead creates a fresh object.
Installed `parse/mjs/parse.mjs` still coerces numbers using `+value || 0`.
Neither behavior is an appropriate implicit scientific validation policy.

Installed `workbench/mjs/hooks/useAggregator.mjs` still allocates CPU/GPU
aggregates and calls `uploadAggregateFromSchema`. A schema-driven Plot path
would not eliminate the buffers or uploads that our direct layer adapters
already manage. FieldArrows already computes positions from GPU samples and
uniforms. No evidence here justifies routing it through CPU attribute packing.

The useful upstream lesson is a visible sequence of **contract → normalization →
binding → draw**, with repeated mechanics implemented once. Native traits remain
an option for genuinely shared parsing, but ordinary TypeScript and small strict
helpers suffice for the duplication found in this pass. No dependency upgrade or
execution of master is proposed.

## Findings

### F1 — P3: seven adapters maintain a second copy of their caller contract

Source-reviewed:

| Component      | Public/resolved declaration locations at the reviewed commit |
| -------------- | ------------------------------------------------------------ |
| Bonds          | `representations/bonds/bonds.ts:357` / `:235`                |
| BallAndStick   | `representations/ball-and-stick.ts:61` / `:15`               |
| Tube           | `representations/tube.ts:189` / `:57`                        |
| Surface        | `representations/surface/surface.ts:360` / `:161`            |
| Ribbon/Cartoon | `representations/ribbon/ribbon.ts:303` / `:94`               |
| Label          | `representations/annotations.ts:245` / `:60`                 |
| Distance       | `representations/annotations.ts:285` / `:131`                |

Paths in this table are relative to `packages/viewer/src`. The repeated shapes
mostly differ only in `SelectionInput` becoming `Selection | null`, removal of
diagnostics, and Ribbon's private `composition`. Every added option or
documentation correction currently requires keeping two declarations in sync.
This is a maintenance finding, not a reproduced public type incompatibility.

Use one explicit feature-local caller contract and derive private adapters:

```ts
type ResolvedTubeProps =
  & Omit<TubeProps, "select" | keyof SelectionDiagnostics>
  & { select?: Selection | null };
```

Distance narrows `a` and `b` separately; Ribbon adds its private composition.
EField already uses `Omit<EFieldProps, "select">`, and ElasticNetwork derives
its internal step/children contract. Reuse that local pattern rather than
inventing a global `ResolvedPrimitive` abstraction.

The [compile-only example](../../test/spikes/primitive-second-pass/contracts.ts)
proves bidirectional assignment between the proposed Tube caller shape and
current public props. Negative examples reject unresolved queries in the draw
adapter, diagnostic leakage into that adapter, and native GPU positions in
ordinary caller props. This proves type feasibility, not a runtime refactor.

The current [H5 policy](../HARDENING.md) permits inline shapes and shared
`RibbonProps`; the old `s5o.17.4` decision was subsequently reconciled by
`ktr.7`. Missing `SpacefillProps` or `TimelineProviderProps` is therefore not an
API-rule violation. When a named type appears in a public signature, export and
document it explicitly; retain small inline contracts where naming adds no
value. Avoid a blanket export expansion.

`types.ts` is still 449 lines and holds Structure, coordinate-provider and
EField contracts. Moving those contracts next to their owners can improve
navigation, as Trajectory and Volume now demonstrate. Keep shared molecular
values, diagnostics and scene types shared; do not add a file per trivial alias
or change public paths merely to reduce a line count.

Tracking: **`molgpu-sept-637`**.

### F2 — P3: extend the successful options/shader split to the other volume visuals

[FieldLines](../../packages/viewer/src/volume/representations/field-lines.ts) is
372 lines; it mixes its inline contract and defaults, numeric validation, seed
selection, shader construction, retained seed-buffer ownership, dispatch
observation and drawing.
[VolumeSlice](../../packages/viewer/src/volume/representations/volume-slice.ts)
is 162 lines and combines props, range/stop normalization, fragment construction
and Live binding. FieldArrows now gives a clearer navigation model through its
120-line component and adjacent options/shader modules.

Extract only pure options and shader builders. Leave FieldLines' allocation,
generation and submission logic visibly connected to its component. Its
volume-dependent potential cap is not a constant default: resolve it from the
nearest volume's display range. Preserve the existing separation between
geometry inputs and width/tint/opacity/range uniforms.

All three already share `color-ramp.ts`; that completed work is `3tt`, not a new
finding. FieldLines and FieldArrows still repeat the same default strength ramp.
Their helpers import `SliceStops` through the VolumeSlice implementation even
though it aliases shared `ColorStops`. Use the shared type internally and retain
the public compatibility alias. A shared immutable default ramp is reasonable; a
new schema registry is not.

Do not make one range normalizer silently change semantics: VolumeSlice permits
distinct finite descending ranges, whereas field magnitude ranges require
`lo < hi`. Changing whether a magnitude range exists, or its stops, can change
shader specialization. A new helper must not promise every style transition is a
uniform-only operation.

Tracking: **`molgpu-sept-ka0`**. Keep validation behavior changes in F3 separate
from this readability change.

### F3 — P2: the volume color normalization boundary is incomplete

CPU-reproduced by the
[characterization probe](../../packages/viewer/test/volume-options.test.ts):

- `normalizeFieldArrowsOptions({ colorRange: [0, Infinity] })` and
  `[-Infinity, 1]` succeed because the only range check is `hi > lo`.
- With `colorRange: [0, 1]`, `stops: []` passes normalization, then
  `colorRampWgsl` throws while indexing the absent first stop.
- A nonfinite stop channel generates the invalid literal `Infinity.0`.

FieldLines has the same incomplete range check at lines 170–172. VolumeSlice
does check finite ranges and at least two stops, but not stop contents. The
shared ramp builder assumes valid input. The normalization split made these gaps
easy to exercise without mounting a renderer, which is another reason to extend
the pilot.

Add strict finite range/stop checks before shader construction with useful
component/option errors. Define and test the supported single/duplicate stop
policy rather than imposing a blanket rule that changes valid existing input.
Keep valid borrowed arrays immutable and preserve specialization dependencies.
Do not substitute upstream's permissive number coercion.

These are observed CPU validation/code-generation failures. No browser shader
failure, rendered artifact or GPU lifetime failure was reproduced in this pass.
The characterization tests intentionally describe the gaps; convert those
assertions to rejection regressions when fixing them.

Tracking: **`molgpu-sept-48k`**.

### F4 — P2: Ramachandran conflates scientific points, styling and packed geometry

Source-reviewed dependency chain:

1. [Ramachandran](../../packages/viewer/src/representations/ramachandran.ts)
   memoizes `ramachandranPoints(snapshot.data, color)` on `[snapshot, color]`.
2. [ramachandranPoints](../../packages/viewer/src/representations/ramachandran-points.ts)
   computes active rows and backbone dihedrals before applying color.
3. The component's next memo depends on those points and recreates positions,
   colors, grid lines, segments, quad and indices together.
4. [ColumnSource](../../packages/viewer/src/rendering/column-source.ts) treats
   every new array identity as new immutable contents and prepares/uploads it
   again.

Consequently a color edit invalidates scientific work and position packing even
when coordinates and inset layout are unchanged. A snapshot change also rebuilds
the unchanged grid/frame columns. This falls short of the repository's style
contract. A small component can still have an overly broad update dependency.

Separate private torsion/row results, colors, point placement and static inset
columns by their actual inputs. Preserve the exported `ramachandranPoints`
helper's combined result for callers and the `onPoints` callback's colored
payload. Color uploads may be necessary for this CPU-colored inset; position and
grid uploads are not. Keep scientific units, default-view rules and snapshot
cadence unchanged.

Existing four CPU tests pass for values and coordinates. They do not test this
style invalidation path. Require a browser/counter regression before claiming
the fix. This finding is not a new browser reproduction and does not reopen the
completed inset feature (`jfg`; `pa3` was its duplicate) or subsume the
independent linked-inspector issue `mts`.

Tracking: **`molgpu-sept-64p`**.

## Complete component coverage

Coverage is the caller contract and adaptation path of every component exported
by viewer's main and advanced entries at `da52c90`. This is not a re-audit of
every lower-package scientific algorithm or every GPU lifetime path.

| Component(s)                      | Input/update responsibility                                | Disposition                                                                                                   |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Structure                         | Exclusive data/src union; topology and scope reset         | Keep source semantics; optional owner-local contract in F1                                                    |
| Trajectory                        | Source union, curve/frame playback, displayed metadata     | First pass complete; keep specialized player props and packed XYZ layout                                      |
| Volume                            | Source union, shared scalar samples, grid and snapshots    | First pass complete; do not merge with Structure/Trajectory into a dataset type                               |
| Spacefill                         | Nearest GPU coordinates, shader fields, picking and copies | Inline contract is allowed; existing direct PointLayer adapter has distinct responsibilities                  |
| Bonds, BallAndStick               | Live coordinates and topology; compositional balls/sticks  | F1; preserve differing default colors, widths and endpoint policies                                           |
| Tube                              | Snapshot trace and guide-atom fields                       | F1; keep radius styling separate from trace/smoothing geometry                                                |
| Ribbon, Cartoon                   | Snapshot geometry, DSSP and cartoon composition            | F1; preserve their shared caller contract and private composition                                             |
| Surface                           | Live GPU geometry or snapshot fallback, attribution        | F1 only for contract duplication; retain separate scientific/async modules                                    |
| Label, Distance                   | Snapshot anchors, text, one or two selections              | F1; explicit-at and two-slot selection behavior prevent a blanket wrapper                                     |
| UnitCell                          | Displayed trajectory box                                   | Three inline props are already small; no traits/options module needed                                         |
| Ramachandran                      | Snapshot torsions and CPU-colored screen inset             | F4; split update dependencies before considering more abstraction                                             |
| Isosurface                        | Snapshot mesh, level and source presentation               | Small contract; keep level resolution and geometry cancellation distinct from style                           |
| VolumeSlice                       | Live scalar samples, plane and fragment ramp               | F2/F3                                                                                                         |
| FieldLines                        | Volume-generation integration plus style-only drawing      | F2/F3; keep seed ownership and dispatch observation explicit                                                  |
| FieldArrows                       | Shader-derived endpoints from live volume samples          | Pilot successful; F3 is the remaining validation gap                                                          |
| EField                            | Nearest coordinates/charges to a live scalar volume        | Existing derived adapter props are a useful model; physics normalization belongs in dynamics                  |
| Transform                         | Affine/curve, selected output rows                         | Small public contract; preserve nearest-coordinate and matrix validation                                      |
| Superpose                         | Reference/source status, fit selection, async RMSD         | Keep typed scientific/status contract; do not flatten into traits                                             |
| Unwrap                            | Periodic box, optional centering selection and status      | Preserve displayed-box/default semantics and graph algorithm                                                  |
| NormalMode                        | Mode, amplitude, time/frequency and phase                  | Already a compact adapter over validated mode data and CoordinateKernel                                       |
| ElasticNetwork                    | Stateful integrator, curves, records and status            | Derived internal props already avoid repetition; native-kernel changes are independent work                   |
| GpuDssp                           | Model/overflow/status, live publication and fallback       | Owner-local props already exist; keep publication/overflow logic specialized                                  |
| TimelineProvider, PickingProvider | Seconds or children-only scope                             | Already minimal inline contracts; no extra props module justified                                             |
| CoordinateKernel (advanced)       | Ordered shader inputs, output owner and generations        | Named advanced contract already exists; retain explicit parameterKey and packed layout                        |
| AttributeProducer (advanced)      | Typed column output and generation publication             | Small inline extension contract; different readiness policy from coordinates is intentional                   |
| WorldSpacePointLayer (advanced)   | Radii-to-native-size binding                               | Existing Omit-based native adaptation is appropriate in advanced; shadow/clipping work stays with hr8/m0y/x0p |

Shared paths inspected include `SelectionConsumer`, `useActiveRows`,
`withColumns`/`ColumnSource`, opacity/material binding, and instance wrapper
signatures. Existing separation is valuable: selection resolution prevents
pending/error membership becoming a default draw; stable rows prevent redundant
geometry packing; native RawData plus reachability retirement protects retained
draws. Do not remove these to shorten a public primitive.

## Alternatives and stopping points

- **Choose:** explicit props once, derived private shapes, strict small pure
  helpers, existing native bindings. Lowest runtime risk and direct evidence of
  reduced duplication.
- **Conditional:** a shared wrapper for the repeated single-selection gate.
  There is repetition, but `withInstances` versus `withGeometryCopies`, null
  default views, Label's explicit anchor, Distance's two slots and EField's
  provider semantics differ. First remove type duplication; leave runtime
  extraction for a measured reduction with composition tests. No new generic
  wrapper issue is needed now.
- **Reject for this pass:** traits for every component or source union, generic
  resource owners, universal geometry components, or replacing direct layers
  with Plot/VirtualLayers. These introduce more contracts and new
  invalidation/lifetime work without an observed need.
- **Keep:** the explicit Field/material-alpha policy from completed `0vs.8`. No
  CPU color scan should be added simply to infer draw mode. Existing shadow,
  near-plane clipping, stable use.gpu adoption, dynamics and inspector issues
  retain their scope and owners.

## Follow-up order and acceptance

| Issue             | Work                                        | Essential acceptance                                                                                                          |
| ----------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `molgpu-sept-48k` | Strict volume range/ramp validation         | Rejection regressions; valid range/stop compatibility; Volume/EField browser checks                                           |
| `molgpu-sept-64p` | Ramachandran update separation              | Style counters show no torsion/position/grid rebuilds; color uploads distinguished; snapshot/layout changes still work        |
| `molgpu-sept-637` | Single caller contract per repeated adapter | Positive/negative type checks, unchanged defaults/unions, reviewed exports/README/api.txt, hardening and JSR dry run          |
| `molgpu-sept-ka0` | FieldLines/VolumeSlice layout               | Pure options checks plus shader specialization, style invalidation, replacement/unmount and uncaptured-error browser coverage |

All four are open, unassigned follow-ups discovered from `48w`. They do not
duplicate completed `erf`, `gvq`, `3tt`, or `jfg`. Prioritize correctness work,
then contract cleanup. F2 and F3 touch the same volume files and should be
sequenced or explicitly coordinated. No dependency upgrade is required.

## Validation and limits

Fresh checks on this review branch:

- Three new CPU characterization tests passed, including the reproduced gaps.
- Four existing Ramachandran scientific/value tests passed.
- Five existing Bezbox trait/schema tests passed on rc.2 using a temporary lock
  copy; the repository lock is unchanged.
- New compile-only derived-contract example and existing Bezbox public JSX /
  negative source-union consumer passed.
- `deno task typecheck:components` passed.
- Scoped formatting and lint passed for the report and probe files; all eight
  local report links resolve. All five review/follow-up Beads pass template
  lint.
- `deno task check:hardening`: all eight packages passed H1–H6. The first
  attempt stopped before checks because the sandbox blocked the local registry
  socket; the permitted retry passed. Logs:
  `/private/tmp/molgpu-second-pass-components.log` and
  `/private/tmp/molgpu-second-pass-hardening-retry.log`.

No production code, public signatures, manifest, lock or historical evidence was
changed. This pass does not claim a fresh full GPU gate, browser reproduction of
F4, performance benchmark, or compatibility with executing upstream master.
Browser checks belong to the runtime follow-ups above. Nothing was published or
deployed.

## Implementation follow-through

The owner requested continuation after the review. The four follow-ups are now
being implemented on the same branch. The findings above describe the reviewed
baseline; this section records the subsequent changes.

- Seven public/resolved contract pairs now share one explicit caller shape.
  Private resolved props use Omit and narrowed selection slots; public named
  contracts are exported and classified with their owning components.
- FieldLines and VolumeSlice now keep strict options and shader builders in
  adjacent modules. Live allocation, dispatch observation and drawing remain
  visible in the component; no native primitive or ownership replacement.
- Shared ramp validation rejects invalid finite-f32 inputs before shader
  construction. Field glyphs retain single and duplicate stops, slices retain
  descending distinct ranges and a two-stop minimum, and unused glyph ramps stay
  unused. The former characterization probe is now the maintained rejection
  regression in `packages/viewer/test/volume-options.test.ts`.
- Ramachandran now memoizes torsions independently from colors and separately
  memoizes point placement and the static inset grid. The public CPU helper and
  colored callback payload remain intact. Browser invalidation acceptance was
  added for flat/Field recoloring, other styles, coordinates and layout.

Implementation is committed as `cb22352`; review and the type probe are in
`92ee4d7`. The public API snapshot was reviewed: eight named props exports
replace the corresponding inline signatures, with the same accepted shapes;
FieldArrows/FieldLines/VolumeSlice use the existing equivalent `ColorStops`
contract internally. No dependencies, package boundaries or scientific units
changed. Trivial components remain inline, and shared `types.ts` declarations
were not moved merely to reduce file size.

### Final implementation acceptance

- Four maintained volume-option regression tests and all four existing
  Ramachandran scientific/value tests pass.
- Public component and site typechecks and both the derived-contract probe and
  Bezbox JSX/negative-union consumer pass.
- All eight packages pass H1–H6; the full workspace JSR dry run succeeds.
- Integrated EField, Volume and invalidation browser run: **84 passed, 0 failed,
  28 inapplicable ignored**, in 5m03s. This includes the new Ramachandran
  flat/Field recoloring, point-size/background/grid-color, coordinate and layout
  checks, plus the existing representation replacement, mount/unmount, retained
  buffer/GC and selection-churn checks. No uncaptured WebGPU errors.
- Expanded EField rerun: **1 passed**, in 1m17s. Line width/tint/opacity/range
  edits preserve geometry, uploads and integration; changing stops or toggling
  line/arrow ranges specializes shaders without geometry uploads. This rerun
  explicitly skipped the unrelated throughput benchmark; the initial EField run
  used its ordinary settings.
- Site browser suite: **1 passed**, in 51s, including visible Ramachandran
  inset, clipping, shadow probes and bounded snapshot playback on maintained
  routes.
- Scoped formatting/lint, local report links, issue template lint and
  `git diff --check` pass. The pre-existing untracked `.claude/` directory is
  unrelated and remains untouched.

Local raw logs are retained at:

- `/private/tmp/molgpu-primitives-implementation-browser.log`
- `/private/tmp/molgpu-primitives-ramp-browser.log`
- `/private/tmp/molgpu-primitives-site.log`
- `/private/tmp/molgpu-primitives-implementation-types.log`
- `/private/tmp/molgpu-primitives-all-hardening.log`
- `/private/tmp/molgpu-primitives-jsr.log`

Environment: Deno 2.9.7 on aarch64 Apple Darwin, existing Chrome WebGPU harness,
exact use.gpu rc.2. Vite emitted the existing unresolved `@std/path` config
warning, but built and all browser assertions passed. These are the relevant
scoped suites, not a claim that every standalone GPU suite ran. Nothing was
published or deployed. The four implementation follow-ups are complete with this
evidence; unrelated shadow/clipping/dynamics/inspector issues are unchanged.
