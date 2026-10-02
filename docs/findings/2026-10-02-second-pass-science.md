# Second pass: IO, dynamics and timeline

Date: 2026-10-02. Reviewed baseline `e2b4df7`, use.gpu `0.20.0`, Mol* `5.12.0`.
Review task: `molgpu-sept-ktr.2`. No production edits.

## Package conclusions

| Package  | Dependencies and entries                                  | Retain                                                                                       | Bounded improvement                                                                        |
| -------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| io       | Runtime table; lazy Mol*. One public entry.               | Format-specific readers, shared byte transport, error adapter and x-fastest grid conversion. | Surface preflight and explicit budget; finite download ceiling; accurate lazy-loader docs. |
| dynamics | Runtime table only; `.` and advanced `./wgsl`.            | Scientific CPU references, domain kernels, paired WGSL files and generated charge data.      | Validate custom guide rows before coercion; clarify mode-map ownership.                    |
| timeline | Core easing math only, private adapter; one public entry. | Arbitrary-time seconds sampling, owned inputs, renderer-free facade.                         | Remove the unused vector copy on sampling.                                                 |

No production Mol* imports appear in dynamics/timeline. No Live, shader,
workbench or WebGPU imports appear in these three packages. Cross-package reads
use the public table entry. Table is an appropriate shared dependency for
molecular topology, identity, active view policy and spatial queries; replacing
it with private copies would duplicate contracts rather than reduce coupling.
IO's selection expression shape is deliberately plain JSON rather than a select
runtime dependency. Timeline has no sibling-package dependency.

## New bounded findings

### S1. P2: Custom elastic guides are coerced before validation

Follow-up: `molgpu-sept-ktr.10`.

`packages/dynamics/src/elastic-data.ts:91` converts `guide` with
`Uint32Array.from` before passing it to `buildElasticNetwork` at line 96. The
latter correctly checks original numeric rows at
`packages/dynamics/src/elastic-network.ts:54`. Thus the convenience API silently
changes scientific inputs that the direct kernel refuses.

A public-entry Deno probe using the checked-in 1crn structure and explicit
three-node masses produced:

| Supplied guide       | `elasticNetworkData(...).guideRows` | Direct kernel |
| -------------------- | ----------------------------------- | ------------- |
| `[0.5, 1.5, 2.5]`    | `[0, 1, 2]`                         | TypeError     |
| `[NaN, 1, 2]`        | `[0, 1, 2]`                         | TypeError     |
| `[4294967296, 1, 2]` | `[0, 1, 2]`                         | TypeError     |

Acceptance: use the existing kernel's validation on original guide values before
packing, then retain its validated owned rows. Reject fractions, NaN, negatives,
values beyond atom count/u32, duplicates and unsorted rows through both APIs;
keep valid custom guides, CA default, reference positions, masses and residue
mapping unchanged. Run dynamics elastic-data/network tests and source checking.
No new graph or generic validation framework is needed. This is a new input
boundary defect, not the native scheduling spike `s5o.22` or the broader
trajectory ownership work `crj.24`.

### S2. P2: Public molecular-surface calls lack preallocation validation/budget

Follow-up: `molgpu-sept-ktr.11`.

`packages/io/src/molecular-surface.ts:30` checks count and column type/length,
but not finite coordinates, nonnegative finite radii, finite positive
resolution, probe radius or integral probe count. At line 82 it calls Mol* with
these values; at line 101 it disables the table volume ceiling using
`maxSamples: Infinity`. The comment assumes the caller already imposed a budget,
although this is a public IO entry and its options contain no budget.

Pinned upstream review:
`node_modules/molstar/lib/mol-math/geometry/molecular-surface.js:45` uses
`PD.Numeric` UI metadata for resolution; `calcMolecularSurface` at line 277 uses
raw props, takes `1 / resolution`, derives dimensions, and allocates both scalar
and ID tensors at lines 298-300. It does not enforce the UI range or a sample
ceiling before allocation. `createVolume` validation runs after Mol* allocations
and the x-fastest copy, so simply restoring its default ceiling is too late. A
public caller can request an enormous field with tiny resolution. This is a
source-confirmed allocation risk; no dangerous allocation was attempted.

The viewer already has `predictGridDims` at
`packages/viewer/src/internal/surface-geometry.ts:58` and checks a geometry
budget before calling IO at line 100. Consolidate the pure CPU preflight at the
IO boundary while preserving the viewer's total field/mesh byte policy. Keep the
scientific Mol* algorithm and the probe-inflated search radius unchanged.

Acceptance: reject invalid columns/options as `IoError`/`INVALID_INPUT` before
upstream work; decide and document finite positive resolution, nonnegative
versus positive probe/radius policies and positive integral probe count. Provide
an explicit field-sample budget with a documented default/override, preflight
from the same bounds/dimension rules as pinned Mol*, and reject over-budget
requests before allocating its grids. Small existing molecular-surface/oracle
fixtures must remain numerically unchanged. Add small-budget tests covering
valid inputs, oversize predicted dimensions, nonfinite/zero resolution and bad
columns. Review API snapshot/README, hardening and JSR dry run if adding an
option. Browser surface validation is required if viewer preflight is
deduplicated. Do not introduce a new package or move Mol* upstream imports
across the IO wall.

### S3. P3: NaN disables the trajectory whole-download ceiling

Follow-up: `molgpu-sept-ktr.12`.

`packages/io/src/byte-source.ts:98` defaults `maxDownload` but does not validate
it; lines 221 and 243 only compare lengths with `> maxDownload`. Both
comparisons are false for NaN. A small injected-fetch probe with
`maxDownload: NaN` returned a three-byte whole-file source instead of rejecting
invalid options. Existing finite-limit tests pass.

Acceptance: validate the supplied budget before fetching. Define whether
explicit Infinity is supported; reject NaN, negative and invalid noninteger
sizes, while preserving zero and boundary behavior according to the documented
policy. Add transport tests proving bad options do not call fetch and
ordinary/chunked limits still reject at the existing ceiling. This is separate
from completed `crj.12`: strict Content-Range offsets/totals and strong
ETag/Last-Modified continuity are implemented and their regressions pass; do not
reopen that historical defect.

### S4. P3: Each interpolated vector sample makes an unused full copy

Follow-up: `molgpu-sept-ktr.13`.

`packages/timeline/src/index.ts:319` clones `frame.value` as a spline target.
Every private spline ignores that target at
`packages/timeline/src/internal/upstream-interpolation.ts:72` and line 81, and
`zip`/`zip4` allocate the returned vector. One vector copy of width N is
therefore unnecessary on every non-endpoint sample. This is a source-proven
allocation, not a measured frame-time claim.

Acceptance: remove the unused private target or use a single fresh output while
keeping public `sample` results owned by callers. Preserve scalar/vector, knots,
automatic, angle, hold, loop, exact endpoint and reverse sampling tests. No
public API or new clock abstraction is needed.

### Ownership clarification: NormalMode mapping is retained

Follow-up: `molgpu-sept-ktr.14`.

`normalModeFromElastic` copies `mode.vector` but retains `atomToNode` at
`packages/dynamics/src/normal-mode.ts:93`. A probe mutating the input map after
construction changed the returned data's map to `0xffffffff`. The public type
calls vectors owned, while mapping ownership is unstated; both arrays are then
immutable by contract, and the viewer uploads using mode identity/version
(`packages/viewer/src/normal-mode.ts:59`). Mutating a retained map without a new
version would violate that contract, so this probe alone does not establish a
viewer bug. Decide whether the helper copies the map like its vector, or accepts
a documented transfer. Prefer a copy for this constructor convenience, with a
mutation-isolation regression and unchanged version semantics. Direct advanced
NormalModeData inputs still require documented immutability/version discipline.
This is a small ownership follow-up, separate from guide validation.

## Upstream reuse and scientific provenance

Read installed core `mjs/ease.mjs` and workbench `mjs/animate/interpolate.mjs`,
`ease/number.mjs`, `ease/angle.mjs` and `zip.mjs`. Timeline already reuses core
`bezierEase`, `clerp`, `lerp`, `cubicBezier`, `catmullRomWeightedDual`,
`sampleToCubicBezier`, `makeArcLengthMap` and `velocityToBezierEase` behind its
private adapter. Workbench's spline helpers reject scalar zero knots via
`if (!k1 || !k2)` and mutate target buffers, whereas our public API allows zero
knots and guarantees fresh output arrays. Its `automaticKeyframes` imports all
number/angle/quat/mat4 easing implementations; our API only exposes number/angle
and also handles flat segments explicitly. These concrete differences justify
retaining the adapter. No demonstrated benefit supports importing workbench into
a lower package. The adapter's header also records the historical Node ESM/CJS
bundle reason; that historical claim was not re-benchmarked during this pass.

IO already delegates BCIF semantic models/assemblies, CCP4 affine conversion,
XTC decoding, selection languages and molecular surfaces to pinned Mol*.
DCD/TRR/PQR keep narrow local readers for documented streaming, format variants,
velocities and widened-field behavior; their upstream comparisons pass. Keep
`molstar-model.ts` as a private lazy facade. Shared `grid.ts`, `input.ts`,
`byte-source.ts`, `error.ts` and `residues.ts` prevent duplicate mechanics
today. There is no measured bundle reason for adding format-specific public
subpaths.

Dynamics keeps application/domain APIs at `.` and renderer-free GPU contracts at
`./wgsl`. The generated PDB2PQR data and its license/provenance are distinct
from hand-written algorithm code. Local f64 Kabsch/Horn, exact triclinic
nearest-image search, Lanczos/Jacobi eigenmodes, CPU/GPU Philox, charge
assignment and Coulomb references embody precision, scientific tolerances or
buffer contracts; no installed use.gpu utility was identified as an equivalent
scientific replacement. Do not replace them with renderer matrix/vector helpers
merely for uniformity. The shared table spatial grid is already reused for
elastic contacts. GPU cell lists differ in dense layout/planning/overflow
contracts from that sparse CPU index; sharing a name does not make them
interchangeable.

The latest native compute decision leaves resource scheduling in viewer and
keeps ordered Superpose/Unwrap adoption under existing `molgpu-sept-s5o.22`.
Scientific WGSL files should remain paired by operation, with renderer
allocation and readback owners staying out of dynamics. No broad folder rename
or additional entry is justified by these source sizes. Large generated charge
data stays in a clearly marked generated file; further splits require measured
consumer cost.

## Composition and documentation

IO produces plain StructureData, TrajectoryData and VolumeData. Scientific
transforms operate on those inputs or packed arrays; they do not inherit a
global scene or clock. Viewer Structure/Trajectory/Volume providers own scope
resolution and rendering. NormalMode/ElasticNetwork helpers describe molecular
input and must keep structural mapping/version semantics explicit. Trajectory's
ps-valued scientific frame times and timeline's seconds are distinct intentional
units; playback uses explicit seconds-to-frame curves. No transform hierarchy is
needed in these lower packages.

Retain current ownership/source/native-compute decisions as evidence. Historical
baseline prose in them can remain dated; current navigation must link the
completed follow-ups rather than present old defects as current facts. IO's
dependency table at `packages/io/README.md:24` lists only BCIF/surface/CCP4 lazy
Mol* loading even though selection parsing and XTC frame decoding also load
Mol*. Correct that inventory and include `fetch` in the `OpenTrajectoryOptions`
row. Timeline's single-copy diagnostics are implemented at index.ts:298; do not
reopen `crj.11` solely because curves intentionally use module-private state.

## Validation and limits

Ran
`deno test -A packages/io/test/*.test.ts packages/dynamics/test/*.test.ts
packages/timeline/test/*.test.ts`:
191 passed, one test could not create its local HTTP server inside the sandbox
(`PermissionDenied` at trajectory.test.ts:376). Re-ran only that HTTP test with
approved sandbox escalation: 1 passed. Thus all 192 scoped unit/oracle tests
were exercised successfully; the first invocation itself was not an all-pass
run. These tests include corpus parsers, trajectories, transport, surface
reference, charges, elastic eigenmodes, PBC/Kabsch/Langevin and timeline curves.
Source checks are part of these type-checked Deno tests.

Ran small source/public-entry probes for S1, S3 and map borrowing.

Retained executable reproduction:
`deno run -A docs/findings/evidence/2026-10-02-second-pass-science-probe.ts`.
Its download probe injects a three-byte response and never contacts the network;
its guide probe uses the checked-in 1crn corpus. The probe passes scoped
formatting, lint, `deno check` and execution. It records current defects rather
than asserting future fixed behavior.

No GPU suite, full-repository gate, package publish or deployment was run by
this reviewer. The retained scientific oracle checks do not prove every live
composition or resource lifetime; parent review owns viewer validation and Beads
mutations.
