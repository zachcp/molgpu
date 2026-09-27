# Electric fields (Phase 16 plan)

Decision record for molgpu-sept-egp.1. It answers the seven questions on that
bead and amends build beads egp.3–egp.9. The counter-review (egp.2), run by a
separate agent, argued against it before any build bead was committed; its 24
findings and verdicts are at the end, and accepted findings are folded into the
body. It builds on the Volume plan (`2026-09-26-volume-data-plan.md`), the
coordinate-provider contract (`2026-09-26-coordinate-provider-contract.md`), the
dynamics plan (`2026-09-26-dynamics-plan.md`) and the charge plan's "Contract
for Phase 16" (`2026-09-27-charge-plan.md`).

## What the code did before Phase 16 (evidence)

| Piece                     | Before                                                                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VolumeContext`           | `{ volume: VolumeData, source: StorageSource }`. Every consumer keyed on the CPU `VolumeData` identity; `useVolumeSource` uploads `volume.values` once per identity.                                          |
| `<Isosurface>`            | CPU marching cubes over `volume.values`; `{ sigma }` levels read `volume.stats`.                                                                                                                              |
| `<VolumeSlice>`           | Samples the GPU `source` per fragment, but bakes dims/transform from `volume` and compiles its module per `volume` identity. Default range from `volume.stats`.                                               |
| `volumeSample(volume)`    | A field node holding a `VolumeData`. `useField` binds `volume:<n>` to the shared upload of that identity. The WGSL bakes only dims and transform (`sampleVolumeWgsl`).                                        |
| `<Surface>`               | Flat `color` only. Geometry from a CPU coordinate snapshot (4 Hz, on pause).                                                                                                                                  |
| Coordinates               | `useCoordinates()` gives a live packed-xyz `StorageSource` with a `generation`. `CoordinatePasses` shows raw multi-stage compute encoded during render, one submit per generation, no readback.               |
| Snapshots                 | `useCoordinateSnapshot({ maxHz, onPause })` is demand-driven double-buffered readback. Nothing equivalent existed for volumes.                                                                                |
| Charges                   | `partialCharge` is f32 e in topology order, on the GPU through `useAttributeSources`. `templateCharges` covers every corpus standard residue. Altloc copies and all NMR models carry charges.                 |
| use.gpu 0.20.0            | `LineLayer` = `RawLines` (i8/i32 `segments`: 1 start, 3 middle, 2 end), with `positions`/`colors`/`widths` sources. `ArrowLayer` = `RawLines` + `RawArrows`, fed by `useArrowSegmentsSource`. No 3D textures. |
| Oracles available offline | numpy and PyMOL (which bundles PDB2PQR 2.1.2). No APBS, no ChimeraX. So any "published" comparison is to published results and conventions, not to a local run.                                               |

## 1. Physics

The potential at p from atoms i with charge q_i (e) at distance r_i:

- **`vacuum`**: φ = C Σ q_i / (ε r_i), ε default 1.
- **`distance`** (ε = D·r): φ = C Σ q_i / (D r_i²), D default 4. This is the
  default: ChimeraX's `coulombic` default, cheap, and it needs no ionic
  parameters.
- **`debye`** (Debye–Hückel): φ = C Σ q_i e^(−κ r_i) / (ε r_i), ε default 78.54,
  ionic strength default 0.15 M. κ² = 2 N_A e² I·10³ / (ε₀ ε k_B T); κ⁻¹ =
  7.8566 Å at 0.15 M and 298.15 K (the textbook 0.304/√I nm is 0.1% off).

C = 332.0637 kcal·Å/(mol·e²), from CODATA 2018 exact constants. E = −∇φ has
closed forms, used by the CPU reference (`coulombField`) and checked against
finite differences of φ:

- vacuum: E = C q r⃗ / (ε r³)
- distance: E = 2 C q r⃗ / (D r⁴)
- debye: E = C q r⃗ (1 + κ r) e^(−κ r) / (ε r³)

**Singularity.** r is clamped to `minDistance` (default 1 Å). Grid points inside
atoms stay finite, and E from an atom is 0 inside its clamp.

**Units.** The output Volume stores **kT/e** at `temperature` (default 298.15 K;
kT = 0.592485 kcal/mol), `unit: "kT/e"`; `unit: "kcal/mol/e"` is available for
ChimeraX-style numbers.

**Magnitudes differ by model (finding 3).** On 1a4y at the 1.4 Å surface offset,
the distance model gives a median |φ| of 7.1 kT/e (p90 15.4), and Debye in a
uniform ε = 78.54 gives a p90 of 1.6. The default display `range` therefore
depends on the model: ±15 kT/e (about ChimeraX's ±10 kcal/mol/e) for `distance`
and `vacuum`, ±2 kT/e for `debye`. `byPotential({ range })` defaults to 15.
APBS-style ±1 kT/e isosurfaces suit only the screened model; for `distance`, ±5
is the comparable choice (finding 4). Debye in uniform solvent has no
low-dielectric interior, so its magnitudes are not comparable to APBS
Poisson–Boltzmann maps even when the colour convention is the same.

**Which atoms.** `activeAtoms(data)` (first model, primary conformer) ∩
`select`. Altloc copies and NMR models are not double-counted (Phase 14
contract). Water is summed if selected; the docs recommend a `select` that
excludes it (finding 22).

**Charges.** `charge` names the column (default `partialCharge`). A missing
column throws a TypeError that names `templateCharges`, `applyPqr` and
`structureFromPqr`. A non-atom column throws. Rows with q = 0 are dropped when
the column is visible on the CPU.

**Not Poisson–Boltzmann.** `<EField>` is a fast, live, qualitative map; an APBS
map imported with `<Volume>` is the solver's answer.

## 2. Numerics

- **One WGSL module**, `coulombWgsl` in `@molgpu/dynamics`, with entry points
  `packAtoms` (xyzq gather through a row list, 16 B/atom), `sumGrid` and
  `sumPoints` (point sets, writing `vec4(φ, E)`). `coulombParams` encodes its
  112-byte uniform (finding 24).
- **Tiled direct summation.** One invocation per sample, workgroup 64. Atoms
  stream through workgroup memory 64 at a time; each tile's partial sum joins
  the running total.
- **Chunk over samples, not atoms (finding 8).** Each dispatch sums every atom
  into a range of samples, at most 2²⁸ pair evaluations, so no dispatch reads or
  rewrites another's output. There is no read-modify-write of the grid. Each
  dispatch has its own 256-byte-aligned uniform slot and bind group in one
  buffer, written once per structural change (finding 9). Workgroup counts above
  65 535 fold into 2D.
- **No cutoff in Phase 16.** The direct sum is exact. A cell-list cutoff needs a
  switching function to stay smooth; it is a follow-up.
- **Grid.** Axis-aligned. It is placed around the structure's own positions of
  the nonzero charged atoms when CPU charges are available, or all selected
  active atoms for GPU-produced charges. That is synchronous, reproducible, and
  needs no readback (finding 10). `padding` defaults to 8 Å and absorbs provider
  motion. `spacing` defaults to 1 Å. An explicit `box` is the exact extent, with
  no padding, for trajectories that travel. The grid changes only with `select`,
  `spacing`, `padding`, `box`, the charge column or the topology. Grids are kept
  by value (`useStableGrid`), so samplers never recompile for an equal grid
  (finding 16).
- **Two budgets.**
  - `maxSamples`: default 128³.
  - `maxPairs`: samples × charged atoms per computation, default 2³⁴ ≈ 1.7e10
    (finding 7).

  Both throw a `RangeError` before allocation, naming a spacing that fits.
- **Measured cost (gate).** On the development Mac (Apple silicon, Chrome
  WebGPU) direct summation runs at about **2e10 pairs/s** with the distance and
  Debye models alike. At 128³ that is 0.51 s for 5k atoms and 5.4 s for 50k
  atoms. So interactive updates need roughly ≤ 3e8 pairs per generation (for
  example 1crn at the defaults, 79k samples × 300 atoms), and the budget default
  allows computations of about a second (finding 11). 1a4y at the defaults is
  529k × 4.4k = 2.3e9 pairs, about 0.1 s.

## 3. Output: φ only; E by differentiating the sampler

`<EField>` provides a **scalar** Volume: φ in kT/e.

- E is not stored. `sampleVolumeGradientWgsl(grid)` in `@molgpu/fields` (CPU
  parity: `sampleVolumeGradient` in `@molgpu/table`) takes central differences
  of the trilinear sampler along world x, y and z, with step h = half the
  shortest cell. It returns **zero within h of the grid boundary**, where a
  difference would straddle the outside (finding 14). Lines stop there and
  arrows hide there.
- **Context.** `VolumeContextValue` is
  `{ grid, source, generation, range, volume, snapshot, subscribe }`:
  - `grid`: a samples-free `VolumeGrid` from `@molgpu/table`, stable by value.
  - `volume`: the `VolumeData` for `<Volume>`, null for a computed volume.
  - `useVolumeSnapshot({ maxHz = 4, onPause = true })` returns CPU samples on
    demand, through the same `ThrottledReadback` that coordinate snapshots now
    use.
- `<VolumeSlice>` reads `grid`/`source`/`range` and is live under `<EField>`.
  `<Isosurface>` reads `useVolumeSnapshot()`. Under `<Volume>` neither changes
  behaviour.

## 4. Surface colouring

- **Via the grid, not per-vertex Coulomb.** At a 1.4 Å offset on 1a4y (1 Å grid,
  distance model), interpolation error against the exact sum has a median of
  0.10, p99 0.68 and max 1.47 kT/e. At offset 0 the max is 9.6 (finding 19). Use
  `spacing: 0.5` for stills.
- **`volumeSample()` without an argument** samples the nearest viewer volume.
  - It is bound as `volume:nearest`.
  - `compile` takes the grid as `options.volume`.
  - `evaluate` takes the CPU samples as `{ volume }`, for example from
    `useVolumeSnapshot`, so CPU/GPU parity tests still exist.
  - `useField` keys its compile on the grid only when the field reads the
    nearest volume (`readsNearestVolume`).

  This bends the fields contract a little: a context-dependent binding (finding
  15). It adds no new field kind (lkd.14).
- **`<Surface color={Field}>`** accepts position-only fields. Each vertex
  samples at vertex + `sampleOffset` × normal (default 1.4 Å, ChimeraX's offset)
  through a linked shader, so moving the offset is a uniform write. A field that
  reads an atom attribute throws by name. The mesh follows coordinate snapshots
  and φ is live, so under playback the colour can sample a frame up to one
  snapshot interval newer than the mesh (finding 19).
- **`byPotential({ range = 15, stops, volume })`**: red → white → blue with
  `byCharge`'s stops.
- **Isosurfaces.** Use explicit absolute levels under `<EField>`. The default
  `{ sigma: 1 }` means nothing for a potential and moves with every snapshot
  (finding 23).
  - ±1 kT/e for `debye`; about ±5 for `distance`.
  - With the default 8 Å padding a distance-model ±1 surface is clipped by the
    box (finding 4).
  - Normals face decreasing values, so a negative-level surface's normals point
    into its lobe. That is harmless with the default two-sided shading.

## 5. Field lines

- **E from the φ grid**, so lines agree with the displayed volume and cost
  O(steps) per line.
- **Seeds.** `{ spacing }` (default 4 Å) makes a lattice through the grid,
  thinned by a fixed stride to `maxLines` (default 4096), so defaults never
  throw (finding 13). Explicit packed-xyz seeds throw beyond `maxLines`.
- **Integration.** RK4 on E/|E| (arc length), `step` 0.25 Å, `steps` 128 each
  way. A line stops outside the grid, where |E| < `minField`, or where |φ| >
  `maxPotential`. That defaults to ten times the volume's display range: about 1
  Å from a unit charge for `distance` and 4 Å for `vacuum`. A fixed 50 kT/e
  stopped vacuum lines 11 Å from a charge; this was found while building.
- **Output.** One compute pass per volume generation writes
  `vec4(position,
  |E|)` per vertex, with w = −1 once the line has stopped.
  Stopped vertices get zero width and alpha through shader sources, so no
  zero-length segment is relied on (finding 20). Segment topology is static.
- **Colour.** Flat, or `colorRange` + `stops` over |E|. The ramp's range,
  colour, width and opacity are uniforms. `stops` recompiles a shader; none of
  them re-integrates (finding 17).

## 6. `<MField>`

Phase 16 builds nothing called `<MField>`. The egp.8 spike
(`2026-09-27-mfield-spike.md`) recommends dropping the name.

## 7. Recompute policy

- Recompute on the coordinate `generation`, the upstream buffer, the charge
  source, the grid or any physics parameter.
- **Coalesced, latest-wins.** At most one computation is in flight. Newer inputs
  mark it pending, and completion runs the newest. Completion is a queue fence
  (`onSubmittedWorkDone`), not a readback (finding 18).
- **Settling.** After a new kernel-produced upstream buffer the provider
  recomputes at 50, 150, 400 and 1000 ms. A coordinate kernel's pipeline
  compiles asynchronously, so the first dispatch can read an unfilled buffer.
  That is the race `Published` covers for drawing with timed wakeups; it was
  found while building.
- `maxHz` optionally caps the rate.
- GPU consumers (slice, `volumeSample`, lines, arrows) read the live buffer; the
  loop has no readback. CPU consumers (`<Isosurface>`) get snapshots at their
  own rate.

## Invariants

- **INVARIANT 2 (lkd.9):** dynamics and fields export WGSL strings; use.gpu
  stays in the viewer. `VolumeGrid` in table is a type plus a validator.
- **INVARIANT 4 (lkd.11):** these are compute parameters:
  - `<EField>`: `spacing`, `padding`, `box`, `select` and the physics.
  - `<FieldLines>`: seeds, `step`, `steps`, `minField`, `maxPotential`.

  `sampleOffset`, the arrow plane, arrow `scale`/`maxLength`/`minField`,
  colours, colour ranges, widths and opacity are uniform writes. `stops` and
  `byPotential`'s `range` recompile a shader and never geometry (finding 17).
- **INVARIANT 5 (lkd.12):** `<EField>` is a data provider like `<Volume>`, and
  colour is a prop.
- **INVARIANT 6 (lkd.16):** `<EField>` reads coordinates and never re-provides
  them.
- **CONCEPT 9 (lkd.18):** the output is a Volume, and `useVolumeSnapshot()`
  returns a real `VolumeData`.
- **lkd.3/lkd.14:** no new field kinds. Argument-free `volumeSample()` is a
  binding variant with an explicit CPU form (finding 15).

## Memory and cost

| Item                                | 100k atoms                  | 1M atoms |
| ----------------------------------- | --------------------------- | -------- |
| xyzq pack                           | 1.6 MB                      | 16 MB    |
| rows (u32) + charge column          | 0.4 + 0.4 MB                | 4 + 4 MB |
| φ grid (128³ cap)                   | 8 MB                        | 8 MB     |
| Snapshot, only with a CPU consumer  | 2 × 8 MB staging + 8 MB CPU | same     |
| Two isosurface meshes (CPU and GPU) | mesh-dependent              | same     |
| Field lines (4096 × 257 × 16 B)     | 16.8 MB                     | same     |
| Pairs at 128³ per generation        | 2.1e11 (~10 s)              | 2.1e12   |

At 13 Å³ per atom, a 100k-atom protein with 16 Å of padding already needs about
126³ samples at 1 Å, which is at the sample cap. Its pair count exceeds
`maxPairs`. It therefore needs `spacing ≥ 2 Å`, a `box`, or a raised budget, and
the error says which (finding 12). 1M atoms is out of reach for an exact sum.

## Build bead amendments (as built)

- **egp.3:** `electrostatics`, `coulombPotential`, `coulombField`,
  `coulombGrid`, `gridPoints`, `packCharges`, `debyeKappa` and the constants.
  WGSL is `coulombWgsl` with `packAtoms`/`sumGrid`/`sumPoints`, plus
  `coulombParams`.
  - Acceptance: max |φ_gpu − φ_ref| ≤ 1e-4 · max |φ_ref| (not pointwise; finding
    5), on a 300-atom cancelling cloud for every model, on a many-dispatch run,
    and on 1crn with template charges.
  - Analytic tests: single charge, far-field dipole, E = −∇φ, clamp, units.
- **egp.4:** `VolumeGrid`/`createVolumeGrid`, the new context,
  `useVolumeSnapshot`, `useStableGrid`, `ThrottledReadback`, and `<EField>` with
  the props above plus `maxPairs`.
  - Acceptance: parity after pause under `WobbleCoordinates` and `<Trajectory>`;
    zero coordinate and volume readbacks with GPU consumers only; coalescing
    through an injectable completion gate (one dispatch while held, the newest
    after release); budget and charge errors as unit tests.
- **egp.5:**
  - `volumeSample()`, `readsNearestVolume` and `evaluate({ volume })`;
    `sampleVolumeGradient[Wgsl]`; `byPotential`;
    `<Surface color={Field}
    sampleOffset>`.
  - Acceptance on 1a4y with template charges, each chain alone
    (`<EField select={chain}>`, protein atoms only; finding 1). Pinned: chain A
    (ribonuclease inhibitor) mean surface φ ≈ −9.3 kT/e, chain B (angiogenin) ≈
    +5.6, ±1.5.
  - With both chains summed, B reads −2.2: RI's net charge of about −27
    dominates. The complex-wide map is therefore not the published comparison.
  - RI's net charge is non-integral because 14 residues per copy are incomplete
    (finding 2).
  - Gallery entry on 1crn.
- **egp.6:** as §5.
  - Acceptance: vacuum model at 0.25 Å spacing. cos θ₊ − cos θ₋ stays constant
    along each line within 0.02, over vertices more than 1.5 Å from either
    charge. The invariant holds only for a 1/r² field (finding 6).
  - A ramp-range change dispatches nothing and uploads nothing.
- **egp.7:**
  `<FieldArrows plane spacing scale maxLength minField color
  colorRange stops width>`
  on a `SlicePlane` lattice, defaulting to the middle k plane (the sparse-3D
  mode is dropped).
  - Endpoints are a shader function of the arrow index, the plane uniforms and
    the live φ. Static `segments`/`anchors`/`trims` come from
    `useArrowSegmentsSource` (finding 20).
  - Acceptance: the endpoint shader runs in a compute pass and is compared with
    analytic E for a unit charge (direction cos > 0.995, length within 5%).
  - A plane move and a scale change cost zero uploads, allocations, geometry
    builds and shader builds.
- **egp.9:** records the timings above; follow-ups for a cutoff/switching
  function, a multi-sample-per-thread kernel, and the WGSL marching-cubes port.

## Counter-review (egp.2)

The reviewer did not write the plan. They checked the physics in Python with
CODATA values, ran deno scripts against 1a4y (structureFromBcif →
templateCharges → Mol* SES → CPU `coulombPotential`), and emulated the f32 tiled
sum, 1 Å interpolation and RK4 lines in numpy. The working tree already held
draft egp.3–egp.5 code; accepted findings were applied to it before any commit.

1. **egp.5's 1a4y acceptance failed under the plan's own defaults.** With A+B
   summed, chain B's surface mean is −2.24 kT/e, not > +1. Only chains alone
   reproduce the published complementarity (A −9.25, B +5.59). _Accepted:_
   per-chain acceptance, pinned numbers (measured on the GPU: −9.36, +5.57).
2. **1a4y holds two complexes and incomplete residues.** A/D are RI (net
   −27.41), B/E angiogenin (net +10). _Accepted as documented:_ select one
   chain's protein atoms; the non-integral net charge is noted.
3. **±5 kT/e fits neither the default model nor Debye.** _Accepted:_ the default
   range depends on the model (15 for distance and vacuum, 2 for Debye), and
   `byPotential` defaults to 15.
4. **±1 kT/e isosurfaces are clipped by the default padding under `distance`.**
   _Accepted as documented_ in §1 and §4.
5. **Pointwise 1e-4 relative is unattainable near φ ≈ 0.** _Accepted:_ the norm
   is max-abs over peak. Measured: 2–4e-7 on the cloud, 1.1e-6 on 1crn.
6. **The dipole invariant holds only for 1/r², and 1 Å is too coarse.**
   _Accepted:_ vacuum at 0.25 Å; measured drift ≤ 9.6e-4.
7. **`maxSamples` does not bound pair evaluations.** _Accepted:_ `maxPairs`.
8. **Atom chunking re-reads and rewrites the grid hundreds of times.**
   _Accepted:_ chunk over samples.
9. **Per-dispatch uniforms written in one submission collide.** _Accepted:_ one
   aligned slot per dispatch, and a many-dispatch parity test.
10. **`useCoordinateBounds` reads back every generation and is
    nondeterministic.** _Accepted:_ CPU bounds from the structure's positions;
    `box` for trajectories.
11. **Interactive-rate claims were optimistic.** _Accepted as documented,_ with
    measured throughput (2e10 pairs/s, below the reviewer's 1–2e11 estimate).
12. **100k atoms sits at the budget edge; the memory table omitted items.**
    _Accepted as documented._
13. **Default seeds exceed `maxLines` on 1a4y.** _Accepted:_ stride thinning.
14. **The gradient's face rule was undefined.** _Accepted as documented:_ zero
    within h of the boundary, with CPU parity.
15. **Argument-free `volumeSample()` bends the fields contract and would
    recompile unrelated fields.** _Accepted:_ `evaluate({ volume })`, and the
    compile keys on the grid only when the field needs it.
16. **"Compile per grid" was not what the code did.** _Accepted:_
    `useStableGrid` in both providers; `shaderBuilds` counters cover slices,
    lines and arrows.
17. **INVARIANT 4 wording overclaimed uniforms.** _Accepted as documented._
18. **Parity vs coalescing, an untestable drop, and `onSubmittedWorkDone`.**
    _Accepted:_ parity after the potential settles; an injectable completion
    gate; the wording is "no readback", since the fence reads nothing back.
19. **Mesh-snapshot vs live-φ mismatch and interpolation error.** _Accepted as
    documented_ with the reviewer's numbers.
20. **Zero-length segments rely on NaN behaviour; arrows need static buffers.**
    _Accepted:_ width and alpha sources hide stopped vertices, and arrows use
    `useArrowSegmentsSource`.
21. **kT and the Debye pin were slightly off.** _Accepted:_ 0.592485 and 7.8566
    Å (tight), plus the textbook value at 0.5%.
22. **Charge-column domain and water were unspecified.** _Accepted:_ non-atom
    columns throw; the docs recommend excluding water.
23. **Isosurface default level and orientation under `<EField>`.** _Accepted as
    documented._
24. **Plan names didn't match the code; the 2D fold isn't exercised by
    default.** _Accepted as documented:_ names fixed. The fold is covered by
    `dispatchShape` but not by a >4M-sample GPU run, which the gate lists as a
    residual risk.

**Invariant summary from the review:**

- Nothing is broken outright: lkd.9, lkd.13, lkd.12, lkd.16 and lkd.18 hold.
- Bent: lkd.3/lkd.9 (the fields CPU-evaluator contract) by the nearest
  `volumeSample()`, mitigated by #15; and lkd.11's uniform wording, fixed by
  #17.
