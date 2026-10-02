# Stateful dynamics: integrators, clocks and recording (Phase 17 plan)

Decision record for `molgpu-sept-ahc.1`. It answers the six questions on that
bead against `main` at `e36b0cf` (Mol* 5.12.0). Build beads ahc.3–ahc.6 point
here. The counter-review (ahc.2) attacks this note before any build bead starts.
Nothing below is implemented yet.

## What the code gives us (evidence)

- **Time is caller-owned.** `TimelineContext` says it plainly: "rendering never
  advances it from a wall clock" (`viewer/src/timeline-context.ts`). Every
  current provider (`<NormalMode>`, `<Trajectory>`, `<Transform>`) is a pure
  function of its props and the timeline sample.
- **`CoordinateKernel` is a pure per-atom map.** It dispatches once per
  `generation`, and the generation is keyed on upstream source/generation,
  shader, `parameterKey` and sources. It has no state that survives between
  dispatches, so it cannot integrate. A stateful provider needs its own owned
  state buffers.
- **Kernel shape (native compute audit, s5o.7).** `Kernel` dispatches once per
  `version` inside the frame loop's compute pass. It cannot repeat a dispatch
  pair k times in one frame or report completion. `<EField>` and the GPU surface
  stay raw for the same kind of reason.
- **ENM building blocks exist in `@molgpu/dynamics`.**
  - `buildElasticNetwork(positions, guideRows, cutoff)` gives exact-cutoff
    contacts over explicit positions (CPU, `table.spatialGrid`).
  - `solveElasticModes` gives ANM/GNM modes, which are the analytic oracle
    below.
  - `residueGuideMap(topology, guideRows)` maps every atom to its residue's
    guide node, altloc-aware.
  - `<NormalMode>` already composes as upstream + per-node displacement through
    that map.
- **`<Trajectory>` frame window.** Frames stream as CPU `TrajectoryFrame`s into
  a four-slot GPU window that `writeBuffer` fills. The 5td.2 counter-review (#9)
  already noted that a GPU recording ring does not fit `FrameSource`.
- **Picking** returns `{ resource, atom }` on hover and press (`usePicking`).
  There is no pointer-to-world helper; the camera is application-owned.
- **Publication contract (crj.7) and first-dispatch race (usx).** Descendants
  see `ready: false` until the first dispatch is encoded. A retired buffer must
  outlive the last draw or dispatch that can reference it.

## 1. Clock: the caller owns progress, the provider owns state

**Decision.** `<ElasticNetwork>` takes a target step count, `step: number`, in
the same way `<Trajectory>` takes `frame`. It also accepts
`step: Curve<number>`, sampled at timeline time. The provider advances its state
monotonically toward `floor(step)`, at most `maxStepsPerFrame` steps per frame
(default 20). It reports `{ step: completed, target, lagging }` through
`onStatus`.

- **Play** means the caller increases `step`, for example
  `stepCurve({ stepsPerSecond })` in `@molgpu/timeline`, a sibling of
  `frameCurve`.
- **Pause** means holding `step`. Nothing dispatches and the generation does not
  move.
- **Reset** means a `step` below the completed count, or a change to `seed` or
  `network`. State reinitialises from the reference at step 0 and replays to the
  target within the per-frame budget. With a counter-based RNG (§2), the state
  at step n depends only on `(network, params, seed, n)` on a given device, so a
  replay is exact.

**Why not a provider-owned sim clock (the starting proposal)?** It would be the
first component to advance from the frame loop, which breaks the TimelineContext
contract. It would also make a captured run depend on frame pacing. The
caller-owned target keeps one rule for all time in the scene and makes tests
deterministic: render with `step = 500` and read back.

**Cost.** Catching up after a large backward jump is not free. At the default
budget, replaying 1e4 steps takes 500 frames. Recording (§4) is the answer for
scrubbing back, and `lagging` makes the gap visible.

## 2. Integrator: BAOAB Langevin, Philox RNG, CPU reference

**Decision.** Use BAOAB (Leimkuhler–Matthews) with a constant friction `gamma`
(1/ps).

- **Units:** Å, ps, amu, kcal/mol, with `1 kcal/mol/Å²/amu = 418.4 ps⁻²`.
- **Defaults:** `temperature` 300 K, `gamma` 5 ps⁻¹, `dt` 0.02 ps. The stiffest
  default ENM spring (k = 1 kcal/mol/Å², two 110 amu nodes) has a period of
  about 2.2 ps, so dt is about 1/100 of it.
- **Node masses:** 110 amu per node by default; an optional per-node
  `Float32Array` overrides it.

**Kernel split.** One step is two dispatches:

1. `BAOA`: half kick with cached forces, half drift, OU thermostat, half drift.
2. `F + B`: compute forces at the new positions, then half kick.

Forces are gathered per node over a CSR neighbour list: each node sums its own
springs. WGSL has no f32 atomics, and a scatter-add would make summation order,
and therefore the trajectory, nondeterministic. Gathering doubles the edge
storage (both directions) and in exchange gives bitwise reproducibility on a
device.

**RNG.** Philox-4x32-10 keyed by `(seed, step)` with counter `node`. One call
yields four u32 values, giving three normals for the OU kick through Box–Muller;
the fourth is discarded. The 32×32→64 multiply is split into 16-bit halves,
identically in TypeScript (`Math.imul` plus the hi-word split) and WGSL. The
integer stream is therefore bitwise identical on CPU and GPU, which a
known-answer test checks against the Random123 vectors.

**CPU reference** (`@molgpu/dynamics`):
`langevinStep(state, springs, params,
step)` in f64, plus an `f32` mode that
rounds with `Math.fround` after each operation in kernel order. GPU and CPU-f32
agree to a tolerance, not bitwise, because WGSL permits FMA contraction. f64 is
the scientific reference for the equilibrium tests.

**Packaging.** Renderer-free pieces go in `@molgpu/dynamics`:

- `philox.ts`, `langevin.ts` and `langevin-wgsl.ts` (WGSL strings plus buffer
  layouts, on the `./wgsl` export);
- `enmSprings(network)`, which converts `buildElasticNetwork` output to CSR
  `{ offsets, neighbours, restLength }`.

No use.gpu imports, as the package boundary requires.

## 3. ENM provider: explicit reference, guide nodes, displacement output

**Decision.**

```tsx
const network = elasticNetworkData(snapshotPositions, topology, {
  guide: "CA",
  cutoff: 15,
  k: 1,
  version: 1,
}); // @molgpu/dynamics: springs (CSR), atomToNode, reference node positions

<ElasticNetwork
  network={network}
  step={stepCurve({ stepsPerSecond: 600 })}
  temperature={300}
  seed={7}
  onStatus={setStatus}
>
  <Cartoon />
</ElasticNetwork>;
```

- **The reference is an explicit prop**, built by the application from positions
  it chooses, as `<NormalMode mode>` is. The provider never reads root positions
  implicitly. Springs, rest lengths and initial node positions all come from
  that one snapshot, and `network.version` identifies it.
- **Output is upstream plus displacement.** For a mapped row,
  `out_i = in_i + (x_node − ref_node)`, through `residueGuideMap`. Unmapped rows
  copy upstream. The provider therefore reads upstream live: it preserves row
  count and order, writes only its own output, and composes under `<Transform>`,
  `<Trajectory>` and so on. A residue moves rigidly with its CA, and side chains
  do not rotate. That is a stated visual limitation, the same as `<NormalMode>`.
- **CA level first.** `guide` accepts any sorted row set, so all-atom ENM is the
  same code with roughly 8× the nodes and about 64× the springs at the same
  cutoff. Nothing extra is built for it. Size caps (§ memory) throw a typed
  error rather than silently thinning the network.
- **No GPU cell list for ENM.** The springs are fixed from the reference, so the
  CPU builds them once per `network.version`. The shared GPU cell list waits for
  the cutoff-nonbonded rung (ahc.8), whose neighbour set moves.
- **Publication.** The generation advances once per frame in which at least one
  step completed. The provider owns the state buffers (x, v, f, reference: four
  packed f32×3 per node), the CSR, the atom map and the output. It runs a raw
  encoder loop of k dispatch pairs per frame, for the reason in the evidence
  (Kernel dispatches once per version). That reason goes in the file header, as
  the audit requires. WGSL is linked with use.gpu's shader linker, as `<EField>`
  does. It publishes through the existing `Published` (`ready: false` before the
  first batch is encoded).
- **Consumers.** Live GPU consumers (spacefill, ball-and-stick) see every
  generation. Snapshot consumers (cartoon CPU geometry, CPU DSSP) follow the
  trajectory plan's §7 policy: demand-driven snapshots that may trail playback.
  That is stated, not hidden.

## 4. Recording: a provider-owned ring of node displacements

**Decision.** Recording happens inside `<ElasticNetwork>`, not through
`<Trajectory>`:

- `record={{ every: 10, frames?: number }}` copies node displacements (12
  B/node) into a GPU ring after every `every`-th step. The copy is a
  `copyBufferToBuffer` in the same encoder, with no readback.
- `mode="replay"` with `frame: number | Curve<number>` stops integrating and
  interpolates ring slots `a` and `b` through the same displacement kernel. It
  uses `framePair` from `internal/frame-window.ts`, so the snapping and clamping
  semantics match `<Trajectory>`.
- Ring order is oldest to newest. Recorded frame `i` maps to step
  `firstStep + i·every`, which `onStatus` reports.

**Why change ahc.5 ("exposed as TrajectoryData")?** A `TrajectoryData` needs a
CPU `FrameSource`. The GPU seam the 5td.2 review proposed would read back or
re-upload per frame. Node displacements are about 1/8 of atom frames at CA
level, and replay reuses the provider's kernel. Exporting a recording as
`TrajectoryData`, through one bulk readback into an in-memory `FrameSource`, is
a small follow-up filed for demand. It is not part of the gate.

## 5. Interactivity: a renderer-free pull spec

**Decision.** `tug?: { node: number; target: [x, y, z]; k: number }` adds
`−k (x_node − target)` in the force kernel. The application maps
`usePicking().pick.atom` to a node through `network.atomToNode` and updates
`target` from the pointer.

- A tug makes the run non-replayable: the state now depends on input outside
  `(seed, n)`. `onStatus` reports `perturbed: true`.
- A backward `step` resets and replays without the tug.
- Releasing (`tug` undefined) returns to plain Langevin, and the acceptance test
  checks re-equilibration.

**Gap.** There is no pointer-to-world helper yet. ahc.6 must add one: unproject
the pointer onto the plane through the picked atom, normal to the view, using
the application's camera matrices. The site demo owns that mapping, and it is
the risky part of ahc.6.

## 6. Next rungs stay placeholders

ahc.7 (OpenMM XML bonded terms) and ahc.8 (cutoff LJ plus reaction field) are
unchanged and gated on a use case. This plan keeps them possible without
building for them: forces go through one `F + B` kernel slot, and the CSR is a
`springs` input rather than a hard-coded ENM.

## Memory and bandwidth

Assumptions: CA guides with about 8 atoms per node, a 15 Å cutoff, and about 40
neighbours per node. CSR entries are 8 B (u32 neighbour plus f32 rest length),
stored in both directions. The output is packed f32×3, as `ComputeBuffer` in
`CoordinateKernel` is.

| Atoms | Nodes | Node state | CSR   | atom→node | Output | Ring at default 64 MiB |
| ----- | ----- | ---------- | ----- | --------- | ------ | ---------------------- |
| 100k  | 12.5k | 0.6 MB     | 4 MB  | 0.4 MB    | 1.2 MB | 447 frames             |
| 1M    | 125k  | 6 MB       | 40 MB | 4 MB      | 12 MB  | 44 frames              |

- **Bandwidth.** Per step, the force gather reads up to about 800 B per node
  before cache reuse: 320 B of CSR plus 480 B of neighbour positions. That is
  about 100 MB per step at 1M atoms. At 20 steps per frame it is about 2 GB per
  frame, up to about 20 ms on a 100 GB/s integrated GPU. `maxStepsPerFrame` is
  therefore the knob, and `lagging` reports when the budget cannot keep up. At
  100k atoms the same budget is about 2 ms.
- **Contact limit.** `buildElasticNetwork`'s default `maxContacts` (1M) is too
  small at 1M atoms (about 2.5M pairs). `elasticNetworkData` must take the cap
  explicitly and throw a typed error past it, never thin the network.
- **Ring budget.** `record.frames` is clamped to a byte budget, 64 MiB by
  default. Asking for more throws a `RangeError` naming the bytes, as
  `<Trajectory>`'s window does.

## Amended acceptance for the build beads

- **ahc.3 integrator** (dynamics, CPU plus WGSL):
  - Philox matches the Random123 known-answer vectors, and the TS and WGSL
    integer streams are bitwise equal on 1e4 counters.
  - GPU agrees with CPU-f32 within 1e-4 Å RMS after 100 steps on a 50-node
    harmonic toy with a fixed seed.
  - Equipartition from the f64 reference: mean kinetic temperature within 3 % of
    the target over 2e4 steps.
  - Same device, seed and step gives bitwise-identical state across two runs.
- **ahc.4 `<ElasticNetwork>`:**
  - Stable (finite, bounded RMSD) for 1e5 steps on 1crn and 4c7r.
  - Per-node RMSF correlates with the analytic ANM fluctuations (Pearson ≥ 0.9).
    Langevin on a harmonic network samples exactly the Gaussian with covariance
    kT·H⁺, so the oracle is analytic, not fitted.
  - Pause dispatches nothing. A backward `step` reproduces the earlier state
    bitwise.
  - Style edits upload nothing.
  - Replacement and unmount retire buffers after the last dispatch
    (`run-retirement`).
  - First generation is `ready: false` until encoded.
- **ahc.5 recording:**
  - A recorded run gives bitwise-identical output for the same `frame` whether
    approached forwards or backwards.
  - Ring overflow of the budget throws.
  - Replay dispatches no integrator.
  - The TrajectoryData export is a separate follow-up.
- **ahc.6 tug:**
  - Site demo with a pointer-to-world mapping.
  - While tugging, the pulled node approaches `target` with a spring-limited
    error.
  - After release, kinetic temperature returns within 3 % of the target in 5e3
    steps. `perturbed` is reported.

## Open questions for the counter-review

1. Is a Curve-valued `step` worth it, or should the application derive `step`
   itself and pass a number only? It is cheaper to drop.
2. Should the default friction be lower (1 ps⁻¹) so motion looks less
   overdamped, at the cost of slower equilibration in the tests?
3. Should rigid CA-translation propagation be replaced by per-residue rotation
   from neighbouring nodes? It costs more and fixes side-chain shearing, but
   nothing in the plan needs it.
