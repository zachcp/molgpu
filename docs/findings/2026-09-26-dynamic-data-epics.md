# Dynamic data epics: trajectories, volumes, charge, secondary structure, dynamics, fields

Planning note for Phases 9-17. Every bead in those epics links here as its spec.
This note is a plan, not a decision record: each epic opens with a Plan bead
that settles its own questions, then a Counter-review bead that attacks that
plan before any build bead unblocks.

## Why these features share a foundation

Today `<Structure>` uploads `positions` once (`structure-context.ts`,
`ColumnSource`) and publishes it as a `ShaderSource`. Consumers split in two:

| Consumer                                   | Reads positions from    | Under moving coordinates |
| ------------------------------------------ | ----------------------- | ------------------------ |
| Spacefill, BallAndStick atoms              | GPU `sources.positions` | follows for free         |
| Bonds                                      | CPU `data.positions`    | goes stale               |
| Ribbon, Tube, Surface                      | CPU `data.positions`    | goes stale               |
| Camera focus (`camera-curve.ts`), `within` | CPU `data.positions`    | goes stale               |
| Fields `attribute()`                       | CPU columns via `fill`  | no GPU-produced columns  |

Trajectories, transformations and live fields all need positions to be a **GPU
stream that a subtree can re-provide**. Charge, computed secondary structure and
field sampling all need **per-row attribute columns that can be produced after
import, including on the GPU**. Those are the two foundations (Phases 9 and 10);
everything else builds on them.

## Foundation A: the coordinate stream (Phase 9)

A coordinate provider reads the nearest coordinates and re-provides new ones to
its children. It never changes topology, atom count or atom order.

```tsx
<Structure src="1abc.bcif">
  {/* topology + initial coords */}
  <Trajectory src="run.xtc" frame={curve}>
    {/* coords -> coords */}
    <Superpose to="first" select={ca}>
      {/* coords -> coords */}
      <Spacefill />
      <EField>
        <FieldLines />
      </EField>
    </Superpose>
  </Trajectory>
</Structure>;
```

Sketch of the contract. The settled version is
[the coordinate-provider contract](2026-09-26-coordinate-provider-contract.md)
(molgpu-sept-e99.1), which supersedes this sketch where they differ:

- `CoordinatesContext` holds
  `{ source: ShaderSource /* vec3<f32> or padded vec4 */,
  count, version, snapshot?() }`;
  `version` increments whenever the GPU content changes. `useCoordinates()`
  reads it.
- Topology stays in `StructureContext` (`resource`, radii, attribute columns).
- A provider is a Live component that runs a use.gpu `Kernel` into a
  `ComputeBuffer` and re-provides it. Chains of providers compose; the identity
  provider is the test fixture.
- CPU consumers declare a policy: **live** (reads GPU source), or **snapshot**
  (rebuilds from a throttled `Readback` into `withPositions`, and on pause).
  Bounds and centroid move to a GPU reduction so focus works on live coords.
- This is not an appearance modifier, so INVARIANT 5 (modifiers are props) does
  not apply; coordinate providers are child nodes on purpose (new INVARIANT 6).

## Foundation B: derived attribute channels (Phase 10)

- `withAttributes(data, columns, provenance)` in `@molgpu/table`, the missing
  setter for `revision.attributes`. Columns are named, domain-tagged
  (atom/residue), typed, and carry provenance (`imported:mmcif`, `pqr`,
  `template:amber`, `dssp`, `gpu:<kernel>`).
- `@molgpu/fields` `attribute()` resolves registered columns, not only the
  closed built-in list; the registry stays typed (R5/R6: no free-form strings).
- `@molgpu/viewer` keeps one GPU column per name per attributes revision, and
  lets a kernel **produce** a column; fields link against that `ShaderSource`
  instead of `fill(data)`.

## The feature epics

| Phase | Epic                                 | Depends on       | Output representation                                           |
| ----- | ------------------------------------ | ---------------- | --------------------------------------------------------------- |
| 11    | Volume                               | none             | `VolumeData` in table; `<Volume>` context                       |
| 12    | Trajectory                           | A                | `TrajectoryData` + `FrameSource`; `<Trajectory>`                |
| 13    | `@molgpu/dynamics` + pure transforms | A                | pure-math package; `<Transform>`, `<Superpose>`, `<NormalMode>` |
| 14    | Charge                               | B                | `formalCharge`, `partialCharge` columns                         |
| 15    | Secondary structure                  | B, 13            | DSSP 8-state residue code column; CPU and GPU DSSP              |
| 16    | Electric fields                      | A, B, 11, 13, 14 | `<EField>` producing a Volume (phi, E)                          |
| 17    | Stateful dynamics (ENM first)        | A, 12, 13        | `<ElasticNetwork>`; record into a trajectory                    |

### Volume

- `VolumeData`: `values` (x-fastest, the layout `geo.marchingCubes` reads),
  `dims`, a column-major 4x4 index-to-Angstrom `transform` (non-orthogonal cells
  allowed), `stats` (min/max/mean/sigma), optional `components` (1 for scalar, 3
  for vector) and units. `SurfaceField` moves onto it.
- Readers behind the io wall: CCP4/MRC, DX (APBS), Cube, later DensityServer
  BCIF. Mol* has all of them.
- use.gpu 0.20.0 facts: `RawTexture` is 2D-only, although `core` binds
  `texture_3d`; `DualContourLayer` is broken (docs/upstream). Default to a
  storage buffer with WGSL trilinear sampling; a 3D-texture spike decides
  whether hardware filtering is worth a custom provider.
- `<Isosurface>` starts on the existing CPU marching cubes; a WGSL port of the
  same tables follows. `volumeSample(volume)` is a field, so any representation
  can be coloured by a volume.

### Trajectory

Settled, with its counter-review and gate, in
[the trajectory plan](2026-09-26-trajectory-plan.md), which supersedes this
sketch where they differ (the box travels with each frame, and the GPU window is
four pinned slots).

- `TrajectoryData`: `atomCount`, `frameCount`, `time: Float64Array`, optional
  per-frame `box` (3x3), optional `atomMap: Uint32Array` for trajectories that
  cover a subset of the topology, and a `FrameSource` with
  `read(i, into): Promise<void>` so frames stream instead of all loading.
- Readers behind the io wall: DCD, XTC first; TRR, NetCDF later; multi-model
  BCIF (NMR ensembles) as frames.
- `<Trajectory>` keeps a GPU window of K frames and interpolates with a kernel
  at a fractional frame index; `frame` accepts a timeline curve, so playback is
  scrubbing (CONCEPT 4).

### `@molgpu/dynamics`: pure math

A renderer-free package, the same shape as `@molgpu/fields`: typed inputs, CPU
reference implementations, and **WGSL source strings** plus buffer layouts. It
never imports `@use-gpu/*`; `@molgpu/viewer` wires its WGSL into `Kernel`s.
Hardening enforces that boundary.

Transforms come in two kinds (new CONCEPT 8):

- **Pure**, `f(coords, t)`: rigid/affine, superposition, PBC unwrap, normal mode
  animation (`ref + A sin(omega t) v_k`). Scrubbable.
- **Stateful**, with an integrator clock: elastic network dynamics, later
  force-field MD. Not scrubbable while live; recording into a trajectory ring
  buffer makes them scrubbable again.

Physics grows one rung at a time, and only on demand: rigid -> Kabsch -> normal
modes -> ENM Langevin -> imported-system bonded forces -> cutoff nonbonded. We
**do not** build force-field parameterisation or protonation; a later rung
imports a parameterised system (for example OpenMM XML).

Shared kernel: a GPU cell list (counting sort over a uniform grid) serves ENM
springs, nonbonded cutoffs, DSSP H-bond search and field cutoffs.

### Charge

- Columns: `formalCharge: Int8Array` (mmCIF `pdbx_formal_charge`; coordinate
  with molgpu-sept-922.13) and `partialCharge: Float32Array` with provenance.
- Sources in order: PQR import; residue templates (united-atom AMBER-style,
  heavy atoms only, documented termini/His defaults); Gasteiger for het groups
  when bond orders allow. A GPU EEM/QEq solver is a later rung.
- Known limit, stated not solved: X-ray structures lack hydrogens and
  protonation states.

### Secondary structure

- Residue column of DSSP codes (`H G I E B T S P -`) as `Uint8Array`, with
  provenance, projected to helix/sheet/coil for the cartoon. The existing
  `residues.secondaryStructure` stays as the compatibility projection
  (coordinate with molgpu-sept-922.16).
- At load: finer `struct_conf` types map to codes.
- Compute: port Mol*'s DSSP to CPU as the oracle (INVARIANT 3), then a GPU path:
  backbone H placement and H-bond energy per residue over the cell list
  (parallel), turn/bridge patterns (parallel), ladders/sheets (sequential; CPU
  first). Per-frame SS for trajectories follows.

### Electric fields

- `<EField>` computes potential phi and field E = -grad phi on a grid by tiled
  direct Coulomb summation, with vacuum, distance-dependent (4r) and
  Debye-Hueckel dielectric options. Units: kcal/mol/e internally, kT/e for
  display.
- Its output is a Volume (new CONCEPT 9: computed fields produce Volumes), so
  `<Isosurface>`, `<VolumeSlice>` and `volumeSample` work unchanged; it adds
  `<FieldLines>` (RK4 streamlines into `LineLayer`) and `<FieldArrows>`
  (`ArrowLayer`). It recomputes when coordinates or charges change.
- `<MField>`: static charges produce no magnetic field. Meaningful variants
  (aromatic ring currents; velocity-derived fields from trajectories) are a
  spike after `<EField>` ships.

## How the beads are laid out for agents

Every epic follows the same shape so `bd ready` always surfaces the right next
step:

1. **Plan** (decision bead): settles the open questions listed on it, writes the
   answers into this note or a new dated finding, and updates the build beads'
   descriptions if scope changes.
2. **Counter-review**: a separate agent argues against the plan: missed
   invariants, cheaper alternatives, hidden coupling, untestable acceptance
   criteria. Outcome is recorded on the Plan bead; build beads depend on this.
3. **Build** beads, each small enough for one session, with acceptance criteria.
4. **Gate**: audits the delivered beads against acceptance criteria and the
   architecture invariants, updates README/api.txt/CHANGELOG/DESIGN, and closes
   the epic.

Recommended order (also encoded as dependencies): 9 -> {11 in parallel} -> 12 ->
13 -> 10 -> 14 -> 15 -> 16 -> 17. Phase 11 has no prerequisites and can start
immediately.

## Phase 8/9/11 scope refinement (2026-09-26)

These are boundaries for the first gates, not answers to the Plan beads. The
Plan and Counter-review beads still decide the implementation contracts before
build work begins.

### Phase 8: close a defined MolQL subset

The implemented parser/interpreter is an allowlisted MolQL subset, not a claim
of complete Mol* query parity. Gate 8 requires documented supported symbols,
explicit errors for unsupported symbols, Mol* oracle coverage for each of the
four text front ends, and the remaining table-enrichment fixtures. In
particular, 1EJG microheterogeneous residue identity is a data-model parity
case, not merely a parser case. Fine secondary-structure flags are tracked by
Phase 15's `ssCode` work; Phase 8 must not wait for Phase 15. Phase 8 already
carries optional imported `atoms.formalCharge` for selection; Phase 14 must
reconcile that column with its provenance-aware charge attributes rather than
ingest the same source a second time.

### Phase 9: first gate and the CPU boundary

Gate 9 requires a composable coordinate provider, a documented and tested policy
for every current CPU position consumer, live bounds/focus, and a throttled
snapshot path. GPU-native ribbon/tube geometry is a follow-on only if snapshot
playback proves inadequate. A GPU AABB/centroid reduction alone does not make
the CPU camera live: the Plan must specify how its result reaches the camera
without a synchronous GPU readback each frame, including measured lag. The Plan
must also define when a content version advances, when a kernel dispatches, and
how an obsolete asynchronous snapshot is discarded. At 1M atoms, each coordinate
buffer is 16 MB (use.gpu stores `vec3<f32>` with a 16-byte stride), so provider
chains and double buffering need an explicit memory budget.

### Phase 11: independently shippable volume slice

Gate 11 covers `VolumeData`, the CCP4/MRC reader, `<Volume>`, CPU
`<Isosurface>`, `<VolumeSlice>`, and static `volumeSample`. DX/Cube and
DensityServer BCIF readers, GPU marching cubes, and raymarching remain tracked
follow-ons. Live-coordinate volume sampling is another follow-on after the Phase
9 provider contract, allowing Phase 11's first gate to close on its own. The
Volume Plan must preserve the existing molecular-surface isolevel and
surface-specific metadata through migration, define scalar extraction from a
multicomponent volume, and make the full index-to-world affine transform work
through sampling _and_ isosurface geometry. Current surface geometry only uses
diagonal spacing and origin. A 256^3 f32 grid is 64 MiB before GPU copies or
mesh output; the Plan must set a budget and an oversize policy.

For these three gates, run the suites that exercise their deliverables:
`deno task test`, `deno task typecheck`, `deno task test:components`, and
`deno task test:site` when a site page is part of the gate. GPU invariants need
a real WebGPU browser assertion rather than a CPU test alone.

## Documents this changes

- ROADMAP "deliberately out of scope": trajectories and volumes move in scope.
- DESIGN pillar 5 ("geometry memoizes on structure") gains the live/snapshot
  policy for CPU geometry under moving coordinates.
- New reference beads under molgpu-sept-lkd: INVARIANT 6 (coordinate providers),
  CONCEPT 8 (pure vs stateful transforms), CONCEPT 9 (Volume is a first-class
  dataset; computed fields produce Volumes), CONCEPT 10 (derived attributes
  carry provenance and bump `revision.attributes`).
