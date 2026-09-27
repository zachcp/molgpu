# Phase 13 dynamics contract

Decision record for `molgpu-sept-9g3.1`. The implementation beads follow this
contract after `9g3.2` counter-reviews it. Phase 13 is pure coordinate math;
stateful clocks and integration belong to Phase 17.

## 1. Package boundary

`@molgpu/dynamics` owns validated, renderer-independent typed-array inputs, CPU
reference functions, WGSL source strings, and plain-data buffer layouts. It may
import `@molgpu/table` types and `spatialGrid`, but does not import
`@use-gpu/*`, WebGPU objects, Live contexts, or browser APIs. Its WGSL exports
are strings, not `ShaderSource` or compiled modules. `@molgpu/viewer` owns
buffer allocation, uploads, readbacks, kernels, and the public components. The
hardening check must reject every `@use-gpu/*` import in dynamics source,
including type imports and dynamic imports.

The initial public API is the small set of pure functions and their associated
types. Avoid a general transform graph or a physics engine. The four providers
compose through the existing `CoordinatesContext`. Simple per-row operations use
`CoordinateKernel`; reductions and graph operations may use viewer-owned
multi-stage compute pipelines.

## 2. Coordinate and buffer layout

CPU positions are packed xyz `Float32Array` in topology atom order (12 bytes per
row). The public coordinate source stays `vec3to4<f32>` over the packed provider
output, as in Phase 9; the root upload has 16-byte rows. Every provider writes
all `count` rows to its own 12-byte-per-row output and never writes upstream.
WGSL source strings state input stride and binding order. Selectors/mappings are
`u32` per atom, with `0xffffffff` as the absent row. Scalar parameters are
uniforms. A provider validates atom count and array lengths before dispatch.

## 3. Pure transform contract

A pure transform is determined by
`(upstream source, upstream generation,
sampled params, structural input versions)`
and does not mutate topology or source coordinates. The provider increments its
content generation only when output-affecting values change; its pipeline runs
once per generation. A curve samples `TimelineContext` seconds to a scalar or
fixed-width vector before this comparison. Selection rows, reference positions,
mode eigenvectors, residue mappings, bond graphs and boxes each have a resource
identity/version in the key; replacing any of them must dispatch even with fixed
time and upstream. These structural inputs may rebuild their own buffers. A
changed matrix, amplitude, phase, or time does not re-upload topology or
positions. Constant parameters do not need a timeline.

`<Transform matrix select>` uses a column-major 4x4 affine matrix. Its final row
must be `[0,0,0,1]` within an explicit tolerance; perspective transforms are
outside this coordinate contract. `select` resolves to a topology-order mask;
selected rows move, every other row passes through exactly. Omitted `select`
means all rows. An empty selection is identity. The selected rows are an output
policy here, while `<Superpose select>` selects fit rows and transforms every
output row. This difference is explicit in component docs.

`<Superpose>` aligns live source coordinates to a fixed reference, a separate
`StructureData`, or the first frame of the nearest trajectory. It uses the
proper rotation (no reflections), optional translation, and an exact row
correspondence. The fit rejects fewer than three non-collinear points unless the
documented degenerate fallback can determine a unique transform. The CPU oracle
uses a numerically stable 3x3 decomposition. The live path computes centroids,
then centered covariance in two GPU reductions, solves the 3x3 rotation on GPU,
and applies it to the same upstream generation in order. This avoids full-frame
readback and any stale asynchronous CPU fit. While a reference is loading, it
passes upstream through unchanged. `to="first"` captures the trajectory's first
frame once, with its `atomMap` validated against the fit selection. The static
reference is uploaded only when it changes. Tests include rapid backward
scrubbing and a large common offset with small structural variation.

`<NormalMode>` uses a mode calculated from reference coordinates and a CA-level
elastic network. Per-frame output is
`upstream + amplitude *
sin(2*pi*frequency*time + phase) * eigenvector`, with
residue atoms following their CA displacement. The mode and residue mapping are
structural inputs; amplitude, frequency, phase, and time are uniforms. Scrubbing
must reproduce the same positions, including when nested under `<Trajectory>`. A
zero amplitude is pass-through.

PBC unwrap takes the displayed periodic box and a fixed covalent bond graph. For
each model/altloc-compatible connected component it builds a deterministic
spanning forest once, chooses an anchor, and propagates minimum-image bond
displacements from the anchor. A multi-stage level/pointer-jumping pipeline
handles long chains; it never assumes independent rows can be unwrapped in one
kernel. Ring edges outside the forest are checked for closure residuals and
reported as ambiguous when inconsistent. Noncovalent/metallic links do not join
components. Missing or singular boxes pass through unchanged with a reported
status; a valid box makes each component whole, then optionally translates the
selected centroid into the primary box. Separate molecules do not inherit each
other's image. The transform is per-displayed-frame, with no history and no
drift.

Minimum image means the nearest **Cartesian** lattice displacement. For a
triclinic box, fractional rounding supplies an initial candidate only. The CPU
and GPU implementations search integer lattice shifts bounded by the candidate
distance and the box's smallest singular value; they reject a near-singular box
or an excessive search bound with a named error. This convention is tested on a
skew cell where fractional rounding gives the wrong answer. Phase 12's
interpolation uses fractional rounding today; a follow-up aligns its convention
before claiming exact triclinic interpolation. Unwrap cannot repair an
already-interpolated long jump.

## 4. Cell list

The shared GPU path bins atoms into a uniform grid by count, exclusive prefix
sum, and scatter, then visits adjacent cells and applies the exact squared
cutoff. Pair results are sets of unordered atom rows; order within a cell is not
stable under atomic scatter. The first API is a narrow reusable index and
bounded neighbour visit, not a generic all-pairs materializer. A per-query work
cap fails explicitly before pathological occupancy can hang the device; it never
silently truncates a supposedly complete result. The CPU reference uses the same
cell-width and cutoff convention, with `table.spatialGrid` as an independent
oracle. Empty inputs, coincident atoms, boundary points, negative coordinates,
selections, and finite-coordinate validation have explicit tests.

A GPU reduction first computes finite flags and bounds; only its compact summary
is read back to size a dense grid. The summary is tagged with source generation
and discarded if stale. A dense grid is bounded before allocation: reject with a
specific error when its cell count exceeds a multiple of atom count or the
device's storage limit. Otherwise sparse molecular coordinates could demand
enormous buffers. At one million atoms, each atom-side `u32` index/slot array
costs 4 MB, in addition to the existing 12 or 16 MB coordinate buffer; grid
counts and offsets cost about 8 bytes per cell plus scan scratch. The package
exports WGSL stages and layout descriptions; viewer or downstream GPU consumers
own dispatch and buffer lifetime.

## 5. Normal-mode solver and scope

Build ANM's sparse CA contact Hessian and GNM's scalar Kirchhoff matrix from
`table.spatialGrid` contacts on the CPU. A worker-safe CPU eigensolver returns
the first requested nontrivial modes with deterministic sign convention and
residual checks. A dense method is acceptable for small systems; at roughly
3,000 CA atoms an ANM dense `3N x 3N` matrix alone takes about 648 MB in `f64`,
before solver scratch, so the production path needs sparse/iterative storage or
a lower enforced limit. No GPU eigensolver is promised in Phase 13. A worker may
call the pure package; the package itself does not own worker lifecycle.

The physics ladder remains rigid/affine, Kabsch, normal modes, then Phase 17 ENM
Langevin. Parameterisation, protonation, PME, imported-system bonded and
nonbonded forces are outside this phase.

## 6. Evidence and gates

- CPU reference tests cover affine, Kabsch degeneracies/reflections, triclinic
  unwrap, and mode residuals. GPU comparison tests read provider output and
  compare with CPU at several frames; selection passthrough is exact.
- Browser tests assert no extra `structure:positions` upload during animation,
  one dispatch per content generation, and buffer teardown at unmount.
- Cell-list tests compare pair sets against both the CPU reference and
  `table.spatialGrid` on corpus structures and boundary fixtures at several
  cutoffs. Large, sparse coordinate extents exercise the allocation guard.
- At 100k and 1M atoms, report persistent and transient bytes separately,
  per-generation read/write traffic, fit latency, and the cost of reference,
  mode and cell-list buffers. A representative root + four active providers
  - four-slot trajectory + reference + mode + cell-list scene is budgeted at at
    most 32 MB persistent/16 MB scratch at 100k and 224 MB persistent/96 MB
    scratch at 1M. Four provider passes alone transfer at least 9.6/96 MB per
    generation; report any added passes. At 100k, a warmed pure transform must
    show the changed generation within three display frames. Gate 13 records
    hardening, publish dry-run, typecheck, unit, and browser results.

## Package README draft

`@molgpu/dynamics` provides pure coordinate mathematics for molecular scenes. It
accepts packed typed arrays and returns new arrays or mathematical results. Each
GPU operation is distributed as WGSL source plus a buffer contract;
`@molgpu/viewer` turns these into live coordinate providers. The package has no
renderer or WebGPU dependency. CPU functions are reference implementations and
can run in a worker. Time-dependent functions use explicit time arguments, so
the same input produces the same output when scrubbing.
