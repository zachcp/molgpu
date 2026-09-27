# molgpu — roadmap

> Architecture refinement (2026-09-17): read
> [the JSX/domain review](findings/2026-09-17-architecture-review.md) alongside
> this original plan. It updates domain identity, cache invalidation, package
> boundaries, renderer fallbacks and acceptance gates. These contracts are
> planned, not implemented.

Phases are gated. Each gate is a question with a yes/no answer, written down
before moving on. The ordering puts the two ideas that make this project
_different_ (fields, timeline) ahead of the idea that makes it _complete_
(cartoon), so the thesis is validated before the long pole is paid for.

---

## Phase 0 — Feasibility spikes

**Gate 0 passed on 2026-09-17:** S1 timing and S2 invalidation evidence are
[recorded here](findings/2026-09-17-s1-s2-execution.md). S3 kernel reuse passed
with a CPU mesh fallback. S4 remains required before production importer work.

**Throwaway code was kept outside package boundaries.** Its point was to answer
questions that could reshape or kill the design before any structure was
committed to. The experiments are retired; their written findings remain in
`docs/findings/`.

| Spike  | Question                                                                                                                                                                                                                          | Kills / reshapes                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **S1** | Can we draw ~100k spheres from a `ShaderSource` position buffer at 60fps? Does `PointLayer`'s `shaded` give true sphere impostors with correct depth, or do we need instanced `RawFaces` with a unit-sphere mesh? Benchmark both. | The spacefill path, and the whole "GPU-first" premise    |
| **S2** | Can a bound color buffer be driven from a scrubbed `t` without regenerating geometry, using `EaseTypes` rather than `Animate`?                                                                                                    | Pillars 4 and 5 — the timeline _and_ cheap animation     |
| **S3** | Can `mol-math/geometry/molecular-surface` be lifted out as a standalone function and its scalar field fed to `DualContourLayer` at publication-grade resolution and interactive speed?                                            | The single biggest reuse bet; the surface representation |
| **S4** | Can a real BCIF (1tqn) be lowered through `mol-io` into a columnar table? What is the bundle cost of the Mol* dependency, and can it be made lazy?                                                                                | The import wall; whether Mol* stays a dependency         |

**Gate 0:** S1, S2 and S3 all pass. If S3 fails, surfaces need a different
strategy and the geometry-reuse premise weakens considerably — stop and
reconsider before Phase 1. If S4 reveals unacceptable bundle cost, revisit the
data-layer decision (a native parser moves onto the critical path).

---

## Phase 1 — Vertical slice through real boundaries

One structure, one representation, constant color, static camera — but built
through the actual package layout, because publishing is a goal and retrofitting
boundaries is worse than starting with them.

End state:

```jsx
<Molecule>
  <Structure src="1tqn.bcif">
    <Spacefill />
  </Structure>
</Molecule>;
```

Deliverables:

- `@molgpu/table` — schema and columnar buffers
- `@molgpu/io` — BCIF → table via `mol-io`, behind the wall
- `@molgpu/viewer` — `<Molecule>`, `<Structure>`, `<Spacefill>`
- **The golden-file test harness against Mol\*, and the curated corpus.**
  Deliberately here and not in Phase 6: per risk R2, building the oracle late is
  the known failure mode.

**Gate 1:** a real protein renders, and the harness can diff our output against
Mol* on at least the baseline corpus entry.

---

## Phase 2 — Fields and selections

The two ideas that separate this from "a molecule viewer written in use.gpu".

Deliverables:

- `@molgpu/select` — selection compiler → sorted index buffers; union /
  intersect / difference; structural predicates only (per R6)
- `@molgpu/fields` — field abstraction, WGSL codegen, and a small closed set of
  built-ins: `byElement`, `byChain`, `byBfactor`, `bySeq`. No user-facing
  expression parser yet (per R5)
- annotation joins → fields

**Gate 2:** one selection drives three representations, and recoloring by a
different field provably does not regenerate geometry (assert on geometry
memoization, don't eyeball it).

---

## Phase 3 — Timeline

Deliverables:

- `@molgpu/timeline` — global scrubbable `t`, named beats, curve-valued fields,
  built on `EaseTypes` / `automaticKeyframes`
- camera curves; `focus(selection)` with bounds computed at evaluation time
- chapters, for narration and export only

**Gate 3:** a multi-beat story scrubs smoothly in both directions — the thing
MVS's snapshot-local clocks structurally cannot do. This is the point at which
the project's core claim is either demonstrated or not.

---

## Phase 4 — Representation breadth

The long pole. Cartoon is the bulk of it, and splits per the findings:

- _cheap half_ — port `curve-segment` ribbon/spline math nearly verbatim
- _expensive half_ — reimplement trace iteration, secondary-structure assignment
  and helix orientation over our table (risk R1)

Also: ball-and-stick, surface (building on S3), ribbon, spacefill refinement.

**Gate 4:** cartoon passes the golden-file harness on the gap, altloc and
nucleic-acid corpus entries — the cases that actually break cartoon
implementations, not just the easy baseline.

---

## Phase 5 — Appearance and interaction

Deliverables:

- PBR materials, lights, environment
- postprocessing: SSAO, outline, DoF, OIT for transparent surfaces
- picking → tooltip fields, click-to-seek-a-beat
- labels and primitives anchored to selection-derived centroids

**Gate 5:** a figure that looks publication-grade, and hover/click wired to the
timeline.

---

## Phase 6 — Library hardening

API review, docs, examples, versioning, published packages, changelog.
Explicitly _not_ where tests first appear — the harness lands in Phase 1.

---

## Phase 8 — Allowlisted MolQL selection

Mol* text parsers stay behind `@molgpu/io`; `@molgpu/select` evaluates a
documented, enumerated expression subset against our tables. Gate 8 checks four
text front ends against the Mol* oracle and rejects unsupported symbols
explicitly. Remaining entity, bond and microheterogeneity cases have their own
beads; fine secondary-structure flags follow Phase 15. See the
[MolQL spike](findings/2026-09-26-molql-selection-spike.md).

## Phases 9–17 — Dynamic data

Trajectories, volumes, charges, computed secondary structure, dynamics and
fields share two foundations: a coordinate stream (Phase 9) and derived
attribute channels (Phase 10). Each phase opens with a Plan bead and a
Counter-review bead before any build bead unblocks, and closes with a gate. See
the [dynamic-data plan](findings/2026-09-26-dynamic-data-epics.md).

Recommended order: 9 → {11 in parallel} → 12 → 13 → 10 → 14 → 15 → 16 → 17.
Phase 11 has no prerequisites and can start immediately.

| Phase | Hard prerequisites |
| ----- | ------------------ |
| 9     | —                  |
| 10    | —                  |
| 11    | —                  |
| 12    | 9                  |
| 13    | 9                  |
| 14    | 10                 |
| 15    | 10, 13             |
| 16    | 9, 10, 11, 13, 14  |
| 17    | 9, 12, 13          |

## Phase 9 — Coordinate stream

Structure topology stays fixed while child providers re-provide positions. Gate
9 checks provider composition, live focus, explicit live/snapshot policies for
CPU consumers, and bounded asynchronous readback. GPU-native ribbon/tube
geometry follows only if snapshot playback proves inadequate.

Gate 9 passed on 2026-09-26. Spacefill and bonds read the nearest GPU stream;
ribbon, tube, surface, annotations and `within` rebuild from throttled
snapshots; focus uses a GPU bounds reduction. The worst-case Phase 9 footprint
(root, two providers, snapshots) is 76 MB at 1M atoms. GPU-native ribbon/tube
(e99.9) stays deferred until snapshot playback misses a measured target. See the
[coordinate-provider contract](findings/2026-09-26-coordinate-provider-contract.md).

## Phase 10 — Derived attribute channels

`withAttributes(data, columns)` in `@molgpu/table` adds named, domain-tagged,
typed columns with per-column provenance and bumps `revision.attributes`.
`attribute()` in `@molgpu/fields` resolves these columns through the table
resolver, and the viewer lets a GPU kernel produce a column that fields link
against directly. See the
[Phase 10 contract](findings/2026-09-26-attribute-channels-plan.md).

Gate 10 passed on 2026-09-26. Table columns preserve topology identity and
record provenance; fields and formal-charge selections use the shared resolver.
Spacefill and Bonds share attribute uploads, and a GPU producer feeds fields
directly with optional demand-driven CPU snapshots. The browser gate covers
unrelated column updates, rapid producer generations and a 16 MB per 1M rows
produced-column snapshot budget.

## Phase 11 — Volume dataset

The independent first gate covers `VolumeData`, CCP4/MRC import, `<Volume>`, CPU
isosurfaces, slices and static volume-sampled fields. Later readers, GPU
marching cubes, raymarching and live-coordinate volume sampling remain tracked
follow-ons.

Gate 11 passed on 2026-09-26. `VolumeData` in `@molgpu/table` carries the full
index-to-world affine; `volumeFromCcp4` reads triclinic, axis-permuted and
MRC-origin maps; `<Volume>` keeps one refcounted GPU copy per volume that
`<Isosurface>`, `<VolumeSlice>` and `volumeSample` share. A 256³ map is the
default ceiling (`maxSamples` raises it; nothing downsamples silently). The
[texture spike](findings/2026-09-26-volume-texture-spike.md) keeps the storage
buffer as the sampling path. DX/Cube (u71.9), GPU marching cubes (u71.11),
DensityServer (u71.12), raymarching (u71.13) and live-coordinate sampling
(u71.15) stay deferred.

## Phase 12 — Trajectories

`TrajectoryData` with a streaming `FrameSource`; DCD and XTC readers behind the
io wall, then TRR, NetCDF and multi-model BCIF. `<Trajectory>` keeps a GPU
window of frames and interpolates at a fractional frame index, so `frame`
accepts a timeline curve and playback is scrubbing.

Gate 12 passed on 2026-09-26. `TrajectoryData` in `@molgpu/table` streams frames
through a `FrameSource`; `openTrajectory` reads DCD, XTC and TRR over bytes,
Blobs or HTTP Range requests from a header index (XTC decodes 100k atoms in 6.3
ms, so no worker), and `trajectoryFromModels` plays NMR ensembles.
`<Trajectory>` streams through a capped CPU cache into a four-slot GPU window
with pinned slots, interpolates (optionally by minimum image) in one kernel, and
re-displays resident frames with no uploads; `frameCurve` drives it from the
timeline. The gate also fixed a Phase 9 snapshot stall that kept ribbons empty
below providers. NetCDF (5td.15) stays deferred; see the
[trajectory plan](findings/2026-09-26-trajectory-plan.md).

## Phase 13 — `@molgpu/dynamics` and pure transforms

A renderer-free package, shaped like `@molgpu/fields`: CPU reference
implementations plus WGSL source strings, never importing `@use-gpu/*`. Pure
transforms `f(coords, t)` ship first as coordinate providers: `<Transform>`,
`<Superpose>`, PBC unwrap and `<NormalMode>`. A shared GPU cell list lands here.

Gate 13 passed on 2026-09-27. Coordinate providers:

- `<Transform>` applies an affine to all or selected rows.
- `<Superpose>` runs its Kabsch fit on the GPU in the same submission as the
  frame it moves. RMSD matches the CPU oracle within 1e-5 Å.
- `<NormalMode>` animates through a uniform only.
- `<Unwrap>` makes covalent components whole in triclinic cells by GPU pointer
  jumping, with centering and ring-closure status.

The package also has:

- A GPU cell list matching the CPU grid, which matches `table.spatialGrid` on
  the corpus.
- ANM/GNM modes, dense or sparse Lanczos, matching ProDy 2.6.1.

At 1M atoms, a root + four-slot trajectory + Unwrap + Superpose + NormalMode
scene holds 147 MB persistent (budget 224) and 33 MB within a generation (budget
96), and a changed generation publishes on the next frame. A full frame reads
and writes about 444 B/atom, above the 96 B four-pass baseline, mostly in unwrap
pointer jumping (9g3.11). See the
[gate record](findings/2026-09-27-phase-13-gate.md).

## Phase 14 — Per-atom charge

`partialCharge` columns with provenance from PQR import, AMBER/PDB2PQR residue
templates and Gasteiger for het groups, reconciled with imported `formalCharge`.
Templates fold missing hydrogen charges per heavy atom and use terminal,
histidine and disulfide variants; Gasteiger requires known bond orders and
reports refused components. Net charge sums use the active model and conformer.
Protonation states remain a caller choice. The GPU EEM/QEq solver (1to.8) is
deferred until a coordinate-dependent charge use case needs it.

## Phase 15 — Secondary structure codes and DSSP

A residue column of DSSP 8-state codes, projected to helix/sheet/coil for the
cartoon. Mol*'s DSSP ported to the CPU as the oracle, then a GPU path over the
cell list. Unblocks fine secondary-structure selection flags deferred from Phase
8.

## Phase 16 — Electric fields

`<EField>` computes potential and field on a grid by direct Coulomb summation
and outputs a Volume, so isosurfaces, slices and `volumeSample` work unchanged.
Adds `<FieldLines>` and `<FieldArrows>`; recomputes when coordinates or charges
change.

## Phase 17 — Stateful dynamics, elastic network first

Transforms with an integrator clock, starting with `<ElasticNetwork>` Langevin
dynamics. Live stateful output is not scrubbable; recording into a trajectory
ring buffer makes it scrubbable again. Physics grows one rung at a time;
force-field parameterisation and protonation stay out of scope.

---

## Deliberately out of scope for now

- **MVS import/export.** Not a goal (decided 2026-09-15). If it ever returns, it
  is an export-only lowering with a report of what could not be expressed.
- **Headless / server-side rendering.** Blocked on dependable Node WebGPU (risk
  R4). Kept _possible_ by keeping `geo` and `table` renderer-free, but not
  pursued.
