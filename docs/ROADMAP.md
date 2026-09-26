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

## Phase 10 — Derived attribute channels

`withAttributes(data, columns, provenance)` in `@molgpu/table` adds named,
domain-tagged, typed columns and bumps `revision.attributes`. `attribute()` in
`@molgpu/fields` resolves registered columns through a typed registry, and the
viewer lets a GPU kernel produce a column that fields link against directly.

## Phase 11 — Volume dataset

The independent first gate covers `VolumeData`, CCP4/MRC import, `<Volume>`, CPU
isosurfaces, slices and static volume-sampled fields. Later readers, GPU
marching cubes, raymarching and live-coordinate volume sampling remain tracked
follow-ons.

## Phase 12 — Trajectories

`TrajectoryData` with a streaming `FrameSource`; DCD and XTC readers behind the
io wall, then TRR, NetCDF and multi-model BCIF. `<Trajectory>` keeps a GPU
window of frames and interpolates at a fractional frame index, so `frame`
accepts a timeline curve and playback is scrubbing.

## Phase 13 — `@molgpu/dynamics` and pure transforms

A renderer-free package, shaped like `@molgpu/fields`: CPU reference
implementations plus WGSL source strings, never importing `@use-gpu/*`. Pure
transforms `f(coords, t)` ship first as coordinate providers: `<Transform>`,
`<Superpose>`, PBC unwrap and `<NormalMode>`. A shared GPU cell list lands here.

## Phase 14 — Per-atom charge

`partialCharge` columns with provenance from PQR import, residue templates and
Gasteiger for het groups, reconciled with the imported `formalCharge` column
from Phase 8. Missing hydrogens and protonation states are a stated limit.

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
