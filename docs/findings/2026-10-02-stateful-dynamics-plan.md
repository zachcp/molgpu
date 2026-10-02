# Stateful dynamics: integrators, clocks and recording (Phase 17 plan)

Decision record for `molgpu-sept-ahc.1`. It answers the six questions on that
bead against `main` at `e36b0cf` (Mol* 5.12.0). Build beads ahc.3–ahc.6 point
here. The counter-review (ahc.2, at the end) amended the body where its findings
were accepted; each amendment cites its finding as (CR n). Nothing below is
implemented yet.

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

- **Play** means the caller increases `step`, for example with the existing
  `frameCurve({ frames: n, fps: stepsPerSecond })`, which is already a linear
  map from seconds to a count. No `stepCurve` is added (CR 6).
- **Pause** means holding `step`. Nothing dispatches, no repaint is requested
  and the generation does not move.
- **Catching up.** After encoding a batch that leaves `completed < target`, the
  provider sets state and requests a repaint, as `<Trajectory>` does when a
  frame lands. A caught-up or paused provider does neither (CR 12).
- **Reset** means a `step` below the completed count, or a change to `seed` or
  `network`. With recording on (§4), the provider restores the newest checkpoint
  at or below the target and integrates the remainder. Without it, state
  reinitialises from the reference at step 0 and replays to the target within
  the per-frame budget. With a counter-based RNG (§2), the state at step n
  depends only on `(network, params, seed, n)` on a given device, so a replay is
  exact (CR 5).

**Why not a provider-owned sim clock (the starting proposal)?** It would be the
first component to advance from the frame loop, which breaks the TimelineContext
contract. It would also make a captured run depend on frame pacing. The
caller-owned target keeps one rule for all time in the scene and makes tests
deterministic: render with `step = 500` and read back.

**Cost.** Without recording, catching up after a large backward jump is not
free: at the default budget, replaying 1e4 steps takes 500 frames. A `step`
curve on the global timeline makes that the cost of scrubbing back, so
checkpoints (§4) are the answer, and `lagging` makes any remaining gap visible.

## 2. Integrator: BAOAB Langevin, Philox RNG, CPU reference

**Decision.** Use BAOAB (Leimkuhler–Matthews) with a constant friction `gamma`
(1/ps).

- **Units:** Å, ps, amu, kcal/mol, with `1 kcal/mol/Å²/amu = 418.4 ps⁻²`.
- **Defaults:** `temperature` 300 K, `gamma` 1 ps⁻¹ (CR 7), `dt` 0.02 ps. What
  limits dt is the largest Hessian eigenvalue, not one spring. On the CA
  networks of 1crn and 4c7r at 15 Å it is 28–49 kcal/mol/Å², which gives
  ω_max·dt = 0.21–0.27. BAOAB is stable below 2 and samples configurations
  exactly for a harmonic network at any stable dt. The full-step kinetic
  temperature of each mode is low by (ω dt)²/4, which is 1.8 % for the stiffest
  mode (CR 2, CR 3).
- **dt guard:** `elasticNetworkData` reports a Gershgorin bound,
  `omegaMax = sqrt(max_i 2 Σ_j k_ij / m_i · 418.4)`. It is 2× loose on 4c7r
  (bound·dt = 0.55). The provider throws a `RangeError` when `omegaMax · dt > 1`
  (CR 2).
- **Node masses:** 110 amu per node by default for residue-level guides. Other
  guides (all-atom) require an explicit per-node `Float32Array` (CR 2).
- **Rigid-body modes.** An ENM has six zero modes. Under Langevin they diffuse,
  by about 11 Å for 1crn over 1e5 steps at γ = 5 (COM: 6 kT t / (M γ)), and a
  tug would drag the whole molecule. The integrator removes the mass-weighted
  components of the OU noise and of the tug force along the six rigid-body
  vectors of the reference: three translations and three linearised rotations
  about the reference centroid, with a 6×6 inverse precomputed on the CPU.
  Initial velocities are zero. The ENM then samples the Gaussian with covariance
  kT·H⁺ in 3N − 6 degrees of freedom. Leakage through finite rotations is second
  order in the displacement; if the stability test sees it, the velocities get
  the same projection (CR 1).

**Kernel split.** One step is two main dispatches:

1. `BAOA`: half kick with cached forces, half drift, OU thermostat, half drift.
2. `F + B`: compute forces at the new positions, then half kick.

The rigid-body projection needs six noise moments before `BAOA` uses the noise.
The noise depends only on `(seed, step, node)`, so a pass ahead of `BAOA` can
generate and reduce it (per-workgroup partials, then one single-workgroup
finish), and `BAOA` regenerates it. A fixed-order reduction keeps the step
bitwise deterministic. The build bead chooses where the partials are computed
(CR 1).

Forces are gathered per node over a CSR neighbour list: each node sums its own
springs. WGSL has no f32 atomics, and a scatter-add would make summation order,
and therefore the trajectory, nondeterministic. Gathering doubles the edge
storage (both directions) and in exchange gives bitwise reproducibility on a
device.

**RNG.** Philox-4x32-10 keyed by `(seed, step)` with counter `node`. One call
yields four u32 values. Three become normals through an inverse-CDF transform
built only from `log`, `sqrt` and polynomials (Giles' single-precision
`erfinv`); the fourth is discarded. Box–Muller is not used. WGSL allows `cos`
and `sin` an absolute error of 2⁻¹¹ on [−π, π], so conformant drivers could
differ from the CPU by about 5e-4 per normal. `log` is bounded to 2⁻²¹ absolute
on [0.5, 2] and 3 ULP elsewhere (CR 4). The 32×32→64 multiply is split into
16-bit halves, identically in TypeScript (`Math.imul` plus the hi-word split)
and WGSL. The integer stream is therefore bitwise identical on CPU and GPU,
which a known-answer test checks against the Random123 vectors.

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

No use.gpu imports, as the package boundary requires. The GPU-side tests run in
a new `packages/dynamics/test/run-browser.mjs` (the `@molgpu/fields` precedent),
with a `test:dynamics:gpu` task and an entry in `scripts/run-webgpu-ci.sh` (CR
13).

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
  step={frameCurve({ frames: 600_000, fps: 600 })} // 600 steps/s for 1000 s
  temperature={300}
  seed={7}
  record={{ every: 10 }}
  onStatus={setStatus}
>
  <Spacefill />
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
  Peptide bonds between residues stretch by the difference of neighbouring node
  displacements, which is visible in ball-and-stick (CR 8).
- **CA level first.** `guide` accepts any sorted row set, so all-atom ENM is the
  same code with roughly 8× the nodes and about 64× the springs at the same
  cutoff. Nothing extra is built for it beyond explicit masses and the dt guard
  (§2). Size caps (§ memory) throw a typed error rather than silently thinning
  the network.
- **No GPU cell list for ENM.** The springs are fixed from the reference, so the
  CPU builds them once per `network.version`. The shared GPU cell list waits for
  the cutoff-nonbonded rung (ahc.8), whose neighbour set moves.
- **Publication.** The generation advances once per frame in which at least one
  step completed. The provider owns the state buffers (x, v, f, reference: four
  packed f32×3 per node), the CSR, the atom map, the checkpoint ring (§4) and
  the output. It runs a raw encoder loop of k steps per frame, for the reason in
  the evidence (Kernel dispatches once per version). That reason goes in the
  file header, as the audit requires. As in `<EField>`, the provider submits its
  own encoder from a resource effect, not inside the frame's compute pass, so
  retirement is judged against its own submissions (CR 12). WGSL is linked with
  use.gpu's shader linker, as `<EField>` does. It publishes through the existing
  `Published` (`ready: false` before the first batch is encoded).
- **Consumers.** Live GPU consumers (spacefill, ball-and-stick) see every
  generation. Snapshot consumers follow the trajectory plan's §7 policy:
  demand-driven snapshots that may trail playback. `<Cartoon>`, `<Tube>`,
  `<Surface>` and annotations are snapshot consumers through
  `useCoordinateSnapshot`, so the example and the site demo use a live
  representation, and a cartoon under `<ElasticNetwork>` is documented to update
  at the snapshot rate (CR 11).

## 4. Recording: a provider-owned ring of state checkpoints

**Decision (amended by CR 5).** Recording happens inside `<ElasticNetwork>`, not
through `<Trajectory>`, and it records integrator state rather than display
frames:

- `record={{ every: 10, checkpoints?: number }}` copies node positions and
  velocities (24 B/node) into a GPU ring after every `every`-th step. The copy
  is a `copyBufferToBuffer` in the same encoder, with no readback.
- `step` stays the only time input. There is no `mode="replay"` and no
  interpolation. For any target inside the retained range, the provider copies
  the newest checkpoint at or below it into the state buffers, then integrates
  the remaining steps (< `every`, within one frame at the default budget when
  `every ≤ maxStepsPerFrame`). Forces are a pure function of positions, so the
  restored state is bitwise identical to the continuous run.
- A recorded tug is replayed as it happened, because checkpoints hold the
  perturbed state. A tug that starts at step s after a backward seek drops the
  checkpoints above s, which branches the history.
- A target older than the oldest retained checkpoint replays from step 0 when
  the run is unperturbed. Otherwise it clamps to the oldest checkpoint and
  `onStatus` reports `evicted: true`.
- Ring order is oldest to newest. `onStatus` reports `firstStep` and `lastStep`
  of the retained range.

**Why not the displacement ring with `mode="replay"`?** A displacement ring
answers scrubbing only inside its own mode. With `step` on the global timeline,
a backward scrub in live mode still replayed from step 0, and after a tug it
replayed a different history from the one the user watched. Checkpoints serve
both the backward `step` and recording with one mechanism, one kernel path and
no `framePair` coupling. They cost 2× the bytes per slot: 223 checkpoints at
100k atoms in 64 MiB reach 2230 exact steps at `every: 10`, against 447
interpolated frames.

**Why change ahc.5 ("exposed as TrajectoryData")?** A `TrajectoryData` needs a
CPU `FrameSource`. The GPU seam the 5td.2 review proposed would read back or
re-upload per frame. Exporting a recording as `TrajectoryData`, through one bulk
readback of the checkpoint positions into an in-memory `FrameSource`, is a small
follow-up filed for demand (ahc.10). It is not part of the gate.

## 5. Interactivity: a renderer-free pull spec

**Decision.** `tug?: { node: number; target: [x, y, z]; k: number }` adds
`−k (x_node − target)` in the force kernel. The application maps
`usePicking().pick.atom` to a node through `network.atomToNode` and updates
`target` from the pointer.

- `target` is in the provider's upstream coordinate frame, the same frame as the
  reference, not in world space. Under a `<Transform>` or an assembly instance,
  the application applies the inverse transform (CR 10).
- The tug force is projected like the noise (§2), so a tug deforms the network
  instead of dragging it rigidly (CR 1).
- A tug makes the run non-replayable from the seed: the state now depends on
  input outside `(seed, n)`. `onStatus` reports `perturbed: true`. Checkpoints
  (§4) replay the recorded tug; without recording, a backward `step` resets and
  replays without it.
- Releasing (`tug` undefined) returns to plain Langevin, and the acceptance test
  checks re-equilibration.

**Gap.** There is no pointer-to-world helper yet. ahc.6 adds a pure helper in
the viewer: it unprojects the pointer onto the plane through an anchor point,
normal to the view, from the application's camera matrices. The anchor is the
picked atom's latest snapshot position. The site demo owns the wiring, and this
is the risky part of ahc.6.

## 6. Next rungs stay placeholders

ahc.7 (OpenMM XML bonded terms) and ahc.8 (cutoff LJ plus reaction field) are
unchanged and gated on a use case. This plan keeps them possible without
building for them: forces go through one `F + B` kernel slot, and the CSR is a
`springs` input rather than a hard-coded ENM.

## Memory and bandwidth

Assumptions, corrected by CR 9: CA guides with about 8 atoms per node and a 15 Å
cutoff. The neighbour count was measured on the fixtures: mean degree 30 (1crn,
46 nodes), 54 (1tqn), 59 (1a4y) and 63 (4c7r, 1534 nodes), with a maximum
of 100. Bulk CA density (about 0.0074 Å⁻³) gives about 104 inside 15 Å, so the
table uses 80 at 100k atoms and 100 at 1M. CSR entries are 8 B, stored in both
directions as two separate buffers (u32 neighbours, f32 rest lengths). The
output is packed f32×3, as `ComputeBuffer` in `CoordinateKernel` is.

| Atoms | Nodes | Node state | CSR    | atom→node | Output | Checkpoints at 64 MiB |
| ----- | ----- | ---------- | ------ | --------- | ------ | --------------------- |
| 100k  | 12.5k | 0.6 MB     | 8 MB   | 0.4 MB    | 1.2 MB | 223                   |
| 1M    | 125k  | 6 MB       | 100 MB | 4 MB      | 12 MB  | 22                    |

- **Bandwidth.** Per step, the force gather reads up to about 20 B per neighbour
  before cache reuse: 8 B of CSR plus 12 B of neighbour position. At 1M atoms
  that is about 250 MB per step. At 20 steps per frame it is about 5 GB per
  frame, up to about 50 ms on a 100 GB/s integrated GPU. At 100k atoms it is
  about 0.4 GB, about 4 ms. `maxStepsPerFrame` is therefore the knob, and
  `lagging` reports when the budget cannot keep up. ahc.4 records measured steps
  per second at 100k atoms on the CI GPU rather than asserting these estimates.
- **Contact and binding limits.** `buildElasticNetwork`'s default `maxContacts`
  (1M) is too small at 1M atoms (about 6M pairs). `elasticNetworkData` must take
  the cap explicitly and throw a typed error past it, never thin the network. An
  interleaved 8 B CSR would be about 100 MB, close to the default 128 MiB
  `maxStorageBufferBindingSize`. Hence the split buffers and a binding-size
  check that throws a typed error, as 5td.5 does.
- **Ring budget.** `record.checkpoints` is clamped to a byte budget, 64 MiB by
  default. Asking for more throws a `RangeError` naming the bytes, as
  `<Trajectory>`'s window does.

## Amended acceptance for the build beads

Revised by the counter-review (CR 1–5, 10, 12, 13).

- **ahc.3 integrator** (dynamics, CPU plus WGSL):
  - Philox matches the Random123 known-answer vectors, and the TS and WGSL
    integer streams are bitwise equal on 1e4 counters.
  - The WGSL inverse-CDF normals agree with the CPU-f32 ones within 1e-5
    absolute on the same 1e4 counters.
  - GPU agrees with CPU-f32 within 1e-4 Å RMS after 100 steps on a 50-node
    harmonic toy with a fixed seed.
  - f64 reference on the toy, run for at least 500 relaxation times of its
    slowest mode: per-node positional variance matches diag(kT·H⁺) within 5 %
    mean relative error, and the mean kinetic temperature over 3N − 6 degrees of
    freedom matches the BAOAB prediction kT·mean(1 − (ω_k dt)²/4) within 1 %.
  - Rigid-body projection (f64): over 2e4 steps the centroid moves less than
    1e-6 Å, and the Kabsch rotation to the reference stays below 1°.
  - `omegaMax · dt > 1` throws a `RangeError`.
  - Same device, seed and step gives bitwise-identical state across two runs.
  - GPU tests run in `packages/dynamics/test/run-browser.mjs`
    (`test:dynamics:gpu`), listed in `scripts/run-webgpu-ci.sh`.
- **ahc.4 `<ElasticNetwork>`:**
  - Stable for 1e5 steps on 1crn and 4c7r: every position is finite, the fitted
    node RMSD to the reference is below 5 Å, and the unfitted RMSD exceeds it by
    less than 0.5 Å, so no rigid drift.
  - Per-node RMSF has Pearson ≥ 0.9 against diag(kT·H⁺) on 1crn (dense) and 1tqn
    (lowest 100 ANM modes through `solveElasticModes`) at the default γ = 1
    ps⁻¹, over 5e4 steps. With the rigid-body modes projected out, Langevin
    samples this Gaussian exactly, so the oracle is analytic.
  - Pause: zero dispatches and zero repaint requests over 30 idle frames.
  - Without recording, a backward `step` replays from step 0 and reproduces the
    earlier state bitwise.
  - Style edits upload nothing.
  - Replacement and unmount retire buffers after the provider's last submitted
    dispatch (`run-retirement`).
  - First generation is `ready: false` until encoded.
  - A `<Cartoon>` under the provider receives the final state after a pause.
  - Measured steps per second at 100k atoms on the CI GPU is recorded, not
    asserted.
- **ahc.5 checkpoint recording:**
  - `record={{ every, checkpoints }}`. Seeking to any step in the retained
    range, forwards or backwards, gives output bitwise identical to the
    continuous run, and integrates fewer than `every` steps (counted
    dispatches).
  - A recorded tug replays as recorded. A tug after a backward seek drops the
    later checkpoints.
  - A target older than the oldest checkpoint replays from step 0 when the run
    is unperturbed. Otherwise it clamps and reports `evicted: true`.
  - A budget overflow throws a `RangeError` naming the bytes.
  - The TrajectoryData export is ahc.10.
- **ahc.6 tug:**
  - `tug.target` is in the provider's upstream frame. The pure pointer-to-plane
    helper round-trips project and unproject within 1e-4 relative. Site demo.
  - With a constant tug on 1crn, 2 Å from the pulled node's reference, the mean
    node positions over steps 1e4–3e4 match the linear-response solution of the
    projected system (H + k e_p e_pᵀ on the internal subspace) within 10 %
    relative norm.
  - After release, the mean kinetic temperature over steps 5e3–1e4 matches the
    BAOAB prediction within 3 %. `perturbed` is reported.

## Open questions for the counter-review

Answered in CR 6 (Curve-valued `step`), CR 7 (friction) and CR 8 (per-residue
rotation).

## Counter-review (ahc.2)

An adversarial pass by a separate agent session over the plan above, against
`main` at `dee02e4` on 2026-10-02. The pass verified four claims against the
code and found them accurate: the caller-owned `TimelineContext`, the stateless
`CoordinateKernel`, the CPU `FrameSource` behind `<Trajectory>`, and the ENM
building blocks in `@molgpu/dynamics`. The plan bends none of INVARIANT 2
(renderer-free WGSL strings in dynamics), INVARIANT 4 or INVARIANT 6 (row count
and order preserved, unmapped rows copied). Numbers marked _measured_ come from
`buildElasticNetwork` and `solveElasticModes` on the corpus fixtures, or from a
4e6-step 1D BAOAB simulation. Verdicts follow, and the body above is amended
where a finding was accepted.

1. **The six rigid-body zero modes diffuse, so "bounded RMSD", the kT·H⁺ oracle
   and the tug all fail as written.** Isotropic friction and noise move the
   centroid by a random walk with D = kT/(Mγ). For 1crn that is about 11 Å over
   1e5 steps at γ = 5, and rotation diffuses too. A tug on one node pulls the
   whole molecule along its translation mode instead of deforming it.
   _Accepted:_ the noise and tug force are projected off the six reference
   rigid-body vectors (§2, §5; ahc.3, ahc.4, ahc.6). _Rejected:_ a display-only
   Kabsch fit, because the tug would still translate the molecule, hidden behind
   the fit. _Rejected:_ a weak tether to the reference, because κ must be well
   below the smallest nonzero eigenvalue (0.0126 kcal/mol/Å² on 4c7r,
   _measured_), which leaves tens of Å of rigid wander (kT/κ).
2. **The dt argument uses one spring, but the stiffest Hessian mode is about 5×
   faster.** λ_max is 28 (1crn) to 49 (4c7r) kcal/mol/Å², which makes ω_max·dt =
   0.21–0.27, not 0.057 (_measured_). That is still stable. Lighter all-atom
   nodes with more springs would approach 1, yet the plan claims all-atom needs
   "nothing extra", and the 110 amu default is wrong for atoms. _Accepted:_ a
   Gershgorin `omegaMax` on the network data, a `RangeError` when
   `omegaMax · dt > 1`, and explicit masses for non-residue guides (§2, §3;
   ahc.3).
3. **Kinetic equipartition within 3 % tests the wrong BAOAB property.** BAOAB
   samples configurations exactly for a harmonic potential at any stable dt. Its
   full-step kinetic temperature is low by (ω dt)²/4 per mode (_measured_:
   0.9827 against a predicted 0.9818 at ω dt = 0.27). A flat 3 % passes or fails
   depending on dt. _Accepted:_ configurational variance against kT·H⁺, plus
   kinetic temperature against the predicted bias (ahc.3, ahc.6).
4. **"GPU agrees with CPU-f32 within 1e-4 Å" depends on the driver with
   Box–Muller.** WGSL allows `cos` and `sin` 2⁻¹¹ absolute error, so conformant
   normals may differ by about 5e-4. Over 100 steps that is the same order as
   the tolerance. _Accepted:_ inverse-CDF normals from `log`, `sqrt` and
   polynomials, plus a separate 1e-5 normals check (§2; ahc.3).
5. **A backward `step` replays from 0, so the global timeline is not scrubbable,
   and a tugged history is replaced on scrub-back.** With `step` as a curve,
   scrubbing back 1e4 steps costs 500 frames, which contradicts CONCEPT 4
   ("scrubbing is simply setting t"). After a tug, the replay shows a history
   the user never saw. The `mode="replay"` displacement ring fixed neither,
   because live mode and replay mode were separate. _Accepted:_ a checkpoint
   ring of state (u, v) restores the nearest checkpoint and integrates fewer
   than `every` steps. That makes it bitwise exact, removes `mode` and
   `framePair`, and replays tugs as recorded. The cost is 2× bytes per slot (§1,
   §4; ahc.5, ahc.10). This is consistent with CONCEPT 8: checkpoints are the
   recording.
6. **`stepCurve` duplicates `frameCurve`** (open question 1).
   `frameCurve({
   frames, fps })` is already a linear seconds-to-count curve.
   _Accepted in part:_ no `stepCurve` export. _Rejected:_ dropping
   `Curve<number>` for `step`, because it is one `sample` call and matches
   `<Trajectory frame>`.
7. **Friction: lower γ is better for the tests too** (open question 2). The
   plan's trade-off is backwards for the modes that dominate RMSF. On 4c7r the
   slowest mode (ω = 0.22 ps⁻¹, _measured_) relaxes in τ = γ/ω² = 104 ps (5200
   steps) at γ = 5. That gives about 19 independent samples in 1e5 steps, which
   puts Pearson ≥ 0.9 at risk. At γ = 1, τ is 21 ps. _Accepted:_ default γ = 1
   ps⁻¹, and the RMSF oracle runs on 1crn and 1tqn (slowest modes underdamped at
   γ = 1, ω ≈ 1.4 ps⁻¹). 4c7r keeps the stability check only (ahc.4).
8. **Per-residue rotation instead of rigid CA translation** (open question 3).
   _Rejected:_ `<NormalMode>` has the same limitation and no acceptance needs
   it. The README states it, including the peptide-bond stretch (§3).
9. **The memory and bandwidth table assumed 40 neighbours; measured degree is
   30–63 on the fixtures, about 104 in bulk.** At 1M atoms that means about 6M
   pairs, a 100 MB CSR (near the 128 MiB default binding limit if interleaved)
   and about 5 GB per frame at 20 steps. _Accepted:_ table corrected, split CSR
   buffers, a binding-size check, and measured steps per second at 100k on CI
   instead of asserted bandwidth (§ memory; ahc.4).
10. **The tug target's coordinate frame and the anchor for the pointer plane
    were undefined, and "spring-limited error" cannot fail.** _Accepted:_
    `target` is in the upstream frame, the anchor is the latest snapshot
    position, and the oracle is linear response on 1crn within 10 % (§5; ahc.6).
11. **The flagship example puts `<Cartoon>`, a snapshot consumer, under a live
    provider.** `ribbon.ts`, `tube.ts` and `surface.ts` read
    `useCoordinateSnapshot`, so the cartoon updates at the readback rate and
    rebuilds CPU geometry on each snapshot. _Accepted:_ the example and demo use
    `<Spacefill>`. Cartoon cadence is documented and tested after pause (§3;
    ahc.4).
12. **The catch-up mechanism and submission boundary were unspecified.** A
    provider behind its target must re-render without a prop change. It submits
    its own encoder, as `<EField>` does, so the "Kernel in the frame's compute
    pass" framing does not describe its retirement point. _Accepted:_ the
    `<Trajectory>` pattern of state plus `LoopContext` repaint, nothing when
    idle, and retirement against its own submissions (§1, §3; ahc.4).
13. **The dependency graph and test harness drifted from the plan.** ahc.3
    depends on the GPU cell list (9g3.5), which the plan does not use. The
    dynamics package has no browser suite, and `run-webgpu-ci.sh` lists suites
    explicitly. _Accepted:_ the ahc.3 → 9g3.5 edge is removed, and a
    `packages/dynamics/test/run-browser.mjs` is added to CI (§2; ahc.3). ahc.8
    picks up the GPU cell list when it is scoped.
