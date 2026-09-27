# TrajectoryData, FrameSource and playback (Phase 12 plan)

Decision record for molgpu-sept-5td.1. It answers the seven questions on that
bead against the code as it stands after Gate 9 and Gate 11. Build beads
5td.3–5td.13 point here. The counter-review (5td.2) attacks this note before any
build bead starts.

## What the code and Mol* give us (evidence)

- Phase 9 ships the provider machinery this phase needs: `CoordinatesContext`,
  `CoordinateKernel` (one owned packed `vec3` output, one dispatch per
  `generation`), and the demand-driven `CoordinateSnapshotBoundary`. use.gpu's
  `Kernel` links unnamed arguments in the order args, `sources`, `source`,
  targets, so a kernel can read the upstream stream plus extra storage buffers
  without a new helper.
- Mol* 5.11 has readers for DCD, XTC, TRR and AMBER NetCDF
  (`mol-io/reader/{dcd,xtc,trr,nctraj}`). **None of them streams**: each takes
  the whole file and returns every frame. They also have defects that matter for
  a streaming wrapper:
  - DCD: `new DataView(data.buffer)` ignores `byteOffset`; the unit-cell read
    uses `getFloat64(nextPos + 1)` for its second value (should be `+ 8`); a
    big-endian file is byte-swapped in place.
  - TRR: drops velocities and forces; byte-swaps the caller's buffer in place;
    ignores `byteOffset`.
  - XTC: honours `byteOffset` and loops `while (offset < data.length)`, so a
    byte slice that holds exactly one frame decodes as a one-frame file. Its
    times are picoseconds even though Mol*'s `coordinatesFromXtc` labels them
    `step`.
  - NetCDF: whole-file parse through Mol*'s generic NetCDF reader.
- Frame layouts are indexable without decoding: DCD frames have a fixed byte
  size after the header; XTC and TRR frames carry their own byte lengths in a
  small header, so one pass over headers yields every frame's offset.
- `2k39` in the corpus is a 116-model NMR ensemble (142,796 rows; 1,231 per
  model), the fixture for models-as-frames.
- There are no DCD/XTC/TRR fixtures in the repo and no MD tooling on the
  development machine.

## 1. Types and validation

`@molgpu/table` owns the renderer-free types (`src/trajectory.ts`):

```ts
interface TrajectoryFrame {
  /** x, y, z per trajectory atom, Å, in trajectory atom order. */
  readonly positions: Float32Array;
  /** Column-major 3×3 box vectors in Å (a, b, c as columns); absent if none. */
  readonly box?: Float32Array;
  /** Å/ps, same layout as positions; only formats that store them (TRR). */
  readonly velocities?: Float32Array;
}
interface FrameSource {
  /** Decode frame `index`. The result is owned by the caller and immutable by
   * contract. Rejects with an AbortError when `signal` aborts. */
  read(index: number, signal?: AbortSignal): Promise<TrajectoryFrame>;
}
interface TrajectoryData {
  readonly atomCount: number; // atoms per frame
  readonly frameCount: number;
  readonly time: Float64Array; // per frame, in timeUnit
  readonly timeUnit: "ps" | "step" | "index";
  readonly atomMap?: Uint32Array; // frame atom i -> topology row
  readonly source: FrameSource;
}
```

Changes from the starting proposal, with reasons:

- **`read(i, signal)` returns an owned frame instead of filling `into`.** The
  CPU cache (5td.9) keeps decoded frames, so every decode needs its own array
  anyway; an `into` buffer only saves an allocation the cache immediately
  repays. `signal` lets fast scrubbing cancel stale prefetches.
- **The box travels with the frame, not as a `Float32Array` on the trajectory.**
  DCD stores the cell inside each frame body; an up-front box array would force
  a full-file scan (one range request per frame over HTTP). XTC/TRR could fill
  it cheaply, but one rule for every format is simpler. `<UnitCell>` (5td.12)
  reads the box of the frame on screen.
- **Units are fixed at the boundary:** positions and boxes in Å (readers convert
  nm), velocities in Å/ps (opt-in per reader, review 14), time in ps when the
  file has a timestep, `"step"` when it only has step counts, and `"index"` when
  frames carry no time at all (NMR models, review 12).

Functions:

- `createTrajectory({ frames | source, atomCount, frameCount, time?, atomMap? })`
  validates and freezes. With `frames: Float32Array[]` it builds an in-memory
  `FrameSource` (used by tests, NMR ensembles and Phase 17 recording).
- `validateTrajectory(structure, trajectory)` checks the pair: without
  `atomMap`, `atomCount === topology.atoms.count`; with it,
  `atomMap.length === atomCount`, entries in range and unique. It lives in table
  because both sides are table values; `<Trajectory>` calls it on mount and
  throws its message.
- `validateTrajectory` does **not** decode frames. Readers validate a frame's
  own shape (atom count, finite values) when they decode it, and the provider
  rejects a frame whose `positions.length !== atomCount * 3`.
- `frameAtTime(trajectory, t)` returns the fractional frame index for a
  trajectory time (binary search over `time`), for callers that think in ps.

## 2. Subset trajectories (`atomMap`)

Accepted, with one correction: rows outside the map keep the **upstream**
coordinates, not the structure's reference positions. Providers chain, so the
input to `<Trajectory>` may already be moved (the Phase 9 contract says the
same: "writes mapped rows and copies the rest from upstream").

Mechanism: the provider uploads an inverse map once per
`(structure identity, atomMap)` — one `u32` per topology row holding the frame
atom index or `0xFFFFFFFF` — and the kernel runs over all `count` rows. Without
`atomMap` the kernel variant skips the inverse map and reads frame atom `i` for
row `i`. The count invariant (INVARIANT 6) holds either way.

## 3. Memory, windows and streaming

Byte figures below are per frame of `n` trajectory atoms: `12n` bytes (packed
`vec3<f32>`).

- **GPU window (amended by review 1–5).** One storage buffer of four slots of
  `12n` bytes: the displayed pair plus two prefetch slots. There is no
  byte-budget prop. The provider checks `4 × 12n` against the device's
  `maxStorageBufferBindingSize` and throws a clear error above it (≈2.8M atoms
  at the 128 MiB default). The displayed pair and any pair waiting for its
  dispatch are **pinned**; prefetch writes only unpinned slots. Re-displaying
  resident frames (any fraction between a resident pair, or stepping onto a
  prefetched frame) uploads nothing.
- **Resident rule (no blank frames, review 4–5).** The kernel is mounted from
  the start, so the subtree never remounts. Until the first frame is resident it
  copies upstream. When the requested pair is not resident, it shows the nearest
  resident frame of that pair, else the last displayed state. A frame arriving
  from its promise sets state and requests a repaint, so a landed frame
  dispatches even when the timeline is paused. The displayed pair and fraction
  are part of the kernel's `parameterKey`, so `generation` advances exactly when
  what is on screen changes.
- **CPU cache (5td.9).** A byte-capped LRU of decoded frames in front of the
  `FrameSource` (default 256 MiB, never fewer than 2 frames) with prefetch in
  the playhead's direction, cancellable through `AbortSignal`. It lives in the
  viewer as an internal class with a CPU unit test; it is renderer-free and can
  be promoted if another package needs it.
- **Range reads.** io reads through a small `ByteSource`
  (`{ size, read(offset, length) }`) with three constructors: a `Uint8Array`, a
  `Blob`/`File` (`slice().arrayBuffer()`), and a URL (HTTP `Range`, falling back
  to one full download when the server answers 200, refused above the 256 MiB
  cache cap). Opening a file reads only the headers it needs to build the frame
  index, scanned in 4 MiB blocks so a 10k-frame XTC over HTTP costs a few
  requests, not one per frame (review 7).

Totals at 1M atoms: window 48 MB + provider output 12 MB + inverse map 4 MB
(subset only) on the GPU; snapshots add Phase 9's 24 MB GPU + 12 MB CPU only
when a snapshot consumer is mounted; the CPU cache is capped at 256 MiB. At 100k
atoms: 4.8 MB + 1.2 MB + 0.4 MB. Owned buffers report bytes under
`coords:trajectory:*` labels, as Phase 9 does for `coords:*`.

## 4. Formats and the io wall

Mol* has a reader for every format we want; streaming needs our own frame index.
Per format:

| Format                   | Index (ours)          | Frame decode                 | Why                                                                                  |
| ------------------------ | --------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| DCD (5td.4)              | header + fixed stride | ours (three Fortran records) | Mol*'s path would need a synthetic one-frame file per read and inherits its cell bug |
| XTC (5td.7)              | per-frame header walk | Mol* `parseXtc` on a slice   | the compressed decoder is the hard part; reuse it                                    |
| TRR (5td.11)             | per-frame header walk | ours (plain XDR floats)      | Mol* drops velocities, which Phase 16 wants                                          |
| NetCDF                   | —                     | —                            | deferred to a follow-up bead (review 14)                                             |
| Multi-model BCIF (5td.8) | models                | in memory                    | frames already decoded by `structureFromBcif`                                        |

INVARIANT 1 is about imports: Mol* stays inside `@molgpu/io`, lazily imported,
and is the oracle for every reader that decodes on its own. INVARIANT 3 (port
kernels, never reinvent) covers geometry, not container formats; a DCD frame is
three length-prefixed float arrays. Readers return `TrajectoryData` and throw a
`TrajectoryParseError` with stable codes in the `BcifErrorCode` style
(`INVALID_TRAJECTORY`, `UNSUPPORTED_TRAJECTORY`, `ATOM_COUNT_MISMATCH`,
`TRUNCATED_TRAJECTORY`).

**Decompression off the main thread.** Not by default. 5td.7 records XTC decode
time per frame at 100k atoms. A worker is added only if one frame costs more
than 8 ms (half a 60 Hz frame) on the development machine; the cache's prefetch
already hides decode latency during forward playback.

**Multi-model structures (5td.3, 5td.8; amended by review 8).**
`trajectoryFromModels(data)` returns a trajectory **over the original
structure**: `atomMap` holds the rows of the first encountered model
(`chains.model[0]`, the same model ViewPolicy's default shows) and frame `k` is
model `k`'s coordinates in encountered order. Nothing is re-indexed, and the
structure's identity, selections and annotations survive. Every model must list
the same atoms in the same order (element, atom name, altloc, residue component,
label seq, chain label); the first mismatch fails with a `TypeError` naming the
model and row. `timeUnit` is `"index"`. A single-model structure yields a
one-frame trajectory. Slicing out a single-model structure is not built.

**Fixtures (5td.10; amended by review 11–12).** A Mol* oracle alone is circular
when we decode with Mol*. Tests write files in-test from known coordinates: a
DCD writer (CHARMM and X-PLOR headers, with and without cells, both
endiannesses, a stale `NSET`), an XTC writer implementing the xdr3dfcoord bit
packing including small-difference runs, and a TRR writer (single and double
precision, with velocities, a velocity-only frame, no box). The known
coordinates come from real protein geometry (the 2k39 models, tiled to 100k
atoms for the timing), so neighbouring atoms compress the way MD output does.
Each test checks decoded frames against the known coordinates within the
format's precision (XTC: 0.5/precision nm) **and** against Mol*'s whole-file
parse where Mol* is correct. No binary fixtures are committed for tests; the
site demo ships one generated XTC with its generator script.

Format rules the readers must get right (review 12):

- DCD: time of frame `i` is `(ISTART + i·NSAVC)·DELTA` AKMA units, × 0.0488882
  ps (Mol* multiplies by 20.45 and ignores `NSAVC`; our writer is the time
  oracle). The cell record is `(a, γ, b, β, α, c)`, with angles as degrees or as
  cosines; readers convert it to box vectors. `NAMNF > 0` (fixed atoms) is
  `UNSUPPORTED_TRAJECTORY`. The frame count comes from the file size; a stale
  `NSET` is ignored.
- TRR: frames without positions are skipped by the index; the float size comes
  from whichever of box/x/v/f is present.
- XTC: times are float32 ps.

## 5. Interpolation

Linear between `floor(frame)` and `ceil(frame)` by default;
`interpolate:
"nearest"` rounds instead. Fractional frames are clamped to
`[0, frameCount - 1]`; a non-finite frame throws. Linear interpolation across a
periodic wrap moves an atom through the box, and an unwrap provider below
`<Trajectory>` cannot repair a position that is already interpolated (review 6).
So the kernel has a `pbc="minimum-image"` option: when both frames have a box it
interpolates `p0 + minimage(p1 - p0)` in fractional coordinates of frame 0's
box. The box on screen is the linear interpolation of the pair's boxes.

## 6. Timeline

- `frame` accepts a number or a `Curve<number>` in frame units. A curve is
  sampled at `useTimelineTime()`, so playback is scrubbing (CONCEPT 4).
- `@molgpu/timeline` gains `frameCurve({ frames, fps, start?, loop? })`, a
  linear `Curve<number>` from seconds to frame index, and
  `frameTime({ fps,
  start? }, frame)`, the seconds at which a frame plays, for
  placing beats at frames
  (`createTimeline([{ name: "open", time: frameTime(p, 40) }])`). Defined timing
  (review 14): the curve maps `[start, start + n/fps]` to `[0, n]`, and
  `<Trajectory>` clamps to `n - 1`, so every frame, including the last, is on
  screen for `1/fps` and a looped curve does not skip it. Neither needs table,
  so the timeline package gains no dependency.
- Trajectory time (ps) is a separate axis: `frameAtTime(trajectory, ps)` in
  table converts when a caller wants to seek by simulation time.

## 7. Snapshot consumers during playback

Nothing new is built. `CoordinateKernel` already mounts the snapshot boundary,
so `<Ribbon>`, `<Tube>`, `<Surface>`, annotations and `within` selections
rebuild from throttled readbacks (default 4 Hz) and once after playback pauses.
The visible cost, stated: during playback a cartoon trails the spacefill by up
to one throttle interval plus `mapAsync` latency (≈250–300 ms at 4 Hz), and each
snapshot costs a 12 B/atom readback, a `withPositions` copy and a CPU geometry
rebuild. The site demo (5td.13) records the rebuild time on its fixture.
GPU-native ribbon/tube (e99.9) stays deferred until that measurement misses a
target.

## Component shape

```tsx
<Structure data={structure}>
  <Trajectory data={trajectory} frame={frameCurve({ frames: n, fps: 30 })}>
    <Spacefill /> {/* live */}
    <Ribbon /> {/* snapshot */}
    <UnitCell /> {/* box of the frame on screen */}
  </Trajectory>
</Structure>;
```

- Props: `data` or `src` (+ optional `format`, inferred from the extension),
  `frame`, `interpolate`, `pbc`. No byte-budget props (review 2, 14). `src`
  loads through `@molgpu/io`, dynamically imported as `<Structure src>` does.
- `useTrajectoryFrame()` exposes `{ trajectory, frame, displayed, box }` to
  descendants (`<UnitCell>`, overlays, the demo's readout).

## Test plan by bead

- 5td.3 (table): validation errors, atomMap bounds and duplicates, in-memory
  source, `frameAtTime`, models-as-frames on a synthetic two-model structure.
- 5td.4 / 5td.7 / 5td.11 (io): writer-generated fixtures, known-coordinate
  oracle plus Mol* oracle, frame `i` read twice is identical, reads out of
  order, truncated and malformed inputs map to error codes, `ByteSource` over
  bytes/Blob/HTTP Range.
- 5td.5 (viewer, WebGPU): synthetic frames; `Readback` of the provider output
  equals frame `k` for integer frames and the lerp for `k + 0.25` (the test
  waits on `useTrajectoryFrame().displayed`, since frames land asynchronously);
  re-displaying resident frames adds zero storage `writeBuffer` bytes on the
  instrumented device; subset map leaves unmapped rows at upstream values;
  unmount returns `coords:trajectory:*` owned bytes to baseline.
- 5td.6: sampling a `frameCurve` at arbitrary `t` (CPU) and scrubbing a
  `TimelineProvider` seeks frames (WebGPU).
- 5td.8: 2k39 plays as 116 frames over model 1; a structure whose models differ
  fails with a clear error.
- 5td.9: CPU test with a source that answers after 20 ms, stepped at 30 fps with
  prefetch depth 2: after the first two frames, forward playback never holds; a
  backwards seek to a non-resident frame falls back as section 3 says; memory
  stays under the cap on a long trajectory.
- 5td.12: box follows frames (component test).
- 5td.13: `deno task test:site` covers the page.

## Counter-review (5td.2)

Adversarial pass by a separate agent over the plan above, against the code on
2026-09-26. The plan's claims about Mol* defects, XTC slicing, Kernel link order
and the snapshot boundary were verified. Verdicts below; the plan body is
amended where accepted.

1. **Window arithmetic at 100k atoms was wrong** (64 MiB / 1.2 MB is 55 slots,
   not 16), and one buffer of K slots can exceed `maxStorageBufferBindingSize`.
   _Accepted:_ fixed slot count (below), numbers corrected, binding-size check
   (5td.5).
2. **A K-slot LRU window is over-built.** Forward playback uploads every frame
   anyway; the LRU creates eviction hazards and a `window` prop with no need.
   _Accepted:_ four fixed slots (pair + two prefetch), no prop; the acceptance
   test becomes "re-displaying resident frames uploads nothing" (5td.5, 5td.9).
3. **Slots can be evicted between the generation bump and the dispatch.**
   _Accepted:_ displayed and pending pairs are pinned; prefetch writes only
   unpinned slots (5td.5).
4. **A landed frame does not dispatch by itself, and switching from pass-through
   to the kernel remounts the subtree onto a zero-filled buffer.** _Accepted:_
   the kernel stays mounted and copies upstream until the first frame; arrival
   sets state and requests a repaint (5td.5).
5. **Backwards scrubbing to a non-resident frame was unspecified.** _Accepted:_
   nearest resident frame of the requested pair, else the last displayed state;
   CPU test for a backwards seek (5td.5, 5td.9).
6. **An unwrap provider after interpolation cannot fix a lerp across the box.**
   _Accepted:_ `pbc="minimum-image"` in the interpolation kernel; the box on
   screen is interpolated (5td.5, 5td.12; note on 9g3.8).
7. **Opening XTC/TRR over HTTP is one round trip per frame.** _Accepted:_ header
   scan in 4 MiB blocks; the full-download fallback is refused above the cache
   cap; open time recorded for a 10k-frame file (5td.7, 5td.9).
8. **`trajectoryFromModels` slicing is risky, and an `atomMap` does the same
   job.** _Accepted:_ the atomMap over the original structure is the only form
   built (5td.3, 5td.8).
9. **Phase 17 recording (ahc.5) does not fit a CPU `FrameSource`.** _Accepted as
   a note:_ ahc.5 needs a viewer-internal GPU source seam in `<Trajectory>`, not
   `createTrajectory({ frames })`; ahc.5 amended. Nothing is built for it now.
10. **Per-frame DSSP (efv.8) cannot tell which frame a snapshot shows.**
    _Accepted in part:_ efv.8 reads `FrameSource` on the CPU, not playback
    snapshots (efv.8 amended). _Rejected:_ adding frame provenance to
    `CoordinateSnapshot`; `useTrajectoryFrame().displayed` covers the on-screen
    case and nothing else needs it yet.
11. **Plan and build beads disagree; the in-test XTC encoder is a large port and
    synthetic coordinates are unrepresentative.** _Accepted:_ bead descriptions
    for 5td.4, 5td.7, 5td.10 rewritten to the plan; fixture coordinates come
    from real protein geometry. _Rejected:_ committing an external XTC fixture.
    It would mean fetching a third-party file with its own licence, and the
    encoder is bounded: it needs only the bit packing and small-difference runs
    the decoder reads, not GROMACS's adaptive tuning.
12. **Format details that decide correctness were missing** (DCD time and cell,
    fixed atoms, stale NSET; TRR frames without positions and box; `"step"` for
    model frames). _Accepted:_ listed under section 4, and in the reader beads'
    tests (5td.4, 5td.7, 5td.11).
13. **Some acceptance criteria could not fail.** _Accepted:_ numbers and named
    counters (20 ms source, 30 fps, depth 2; device `writeBuffer` bytes; tests
    wait on `displayed`) (5td.5, 5td.6, 5td.9).
14. **More API than the phase needs.** _Accepted:_ no byte props; velocities
    opt-in; NetCDF deferred; `frameCurve` timing defined so the last frame is
    shown for `1/fps`. _Rejected:_ dropping `frameCurve`/`frameTime` and `src`;
    they are what 5td.6's and 5td.5's titles and acceptance ask for, and each is
    a few lines.
15. **`CoordinateKernel` has no `sources` prop, and an unmemoized array re-links
    every render.** _Accepted:_ memoized `sources` prop (5td.5).

## Gate 12 (5td.14)

Audit on 2026-09-26 against the amended beads. Suites run: `deno task test` (303
passing), `deno task typecheck`, `deno task typecheck:components`,
`deno task test:components` (viewer, volume and trajectory in Chrome WebGPU),
`deno task test:site`, `deno task fmt` and `deno task check:hardening`.

### Acceptance by bead

| Bead                   | Evidence                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5td.3 table            | `table/test/trajectory.test.ts`: validation messages, atomMap bounds and duplicates, in-memory source and abort, `frameAtTime`, models-as-frames and mismatched models.                             |
| 5td.4 DCD              | `io/test/trajectory.test.ts`: CHARMM and X-PLOR, both endiannesses, degree/cosine/triclinic cells, stale NSET, AKMA times, truncation, NAMNF, corrupt records; positions equal the writer and Mol*. |
| 5td.5 `<Trajectory>`   | `viewer/test/run-trajectory.mjs`: output equals frames, the lerp at 2.25 and nearest; subset rows; minimum image; upstream before the first frame; teardown to zero `coords:*` bytes.               |
| 5td.6 timeline         | `timeline/test/frames.test.ts` (arbitrary, reversed and looped samples; beats at frames) and the timeline section of `run-trajectory.mjs`.                                                          |
| 5td.7 XTC              | Writer and Mol* oracles within 0.005 Å; decode 6.3 ms/frame at 100,942 atoms (4.07 B/atom), under the 8 ms worker threshold; a 10,000-frame header scan takes 3.9 ms and one 4 MiB read.            |
| 5td.8 multi-model BCIF | 2k39 plays as 116 frames over model 1 (`trajectoryFromModels`, 17 ms); `atomMap` equals the default view's rows.                                                                                    |
| 5td.9 cache            | `viewer/test/frame-window.test.ts`: a 20 ms source stepped at 30 fps never holds after two frames; a backwards seek falls back, then shows; memory stays under the cap; stale prefetches abort.     |
| 5td.10 fixtures        | `io/test/trajectory-fixture.ts` (writers with provenance); documented in the io README.                                                                                                             |
| 5td.11 TRR             | Single/double precision, opt-in velocities, velocity-only frames skipped, no box; Mol* oracle. NetCDF deferred as 5td.15.                                                                           |
| 5td.12 `<UnitCell>`    | Interpolated box in `useTrajectoryFrame()`; the canvas box grows between frames in `run-trajectory.mjs`.                                                                                            |
| 5td.13 site            | `#demos/trajectory` streams `site/assets/1crn-motion.xtc` (79 KB, `scripts/make-demo-trajectory.ts`); `test:site` scrubs to frames 30, 52.5 and 7.5.                                                |

One criterion was amended while testing. "Re-displaying resident frames adds
zero storage `writeBuffer` bytes on the device" could not hold: use.gpu writes a
few hundred storage bytes of scene state on every redraw. The test observes
`queue.writeBuffer` on the device and asserts zero bytes into the frame window;
the other storage writes during five scrubs equal those of five idle redraws
(3,940 bytes each).

### Invariants

- INVARIANT 1: Mol* is imported only by `@molgpu/io`, lazily (`xtc.ts`); tests
  use it as an oracle. The viewer reaches io through a dynamic import.
- INVARIANT 2: `check:hardening` H3 passes; table, io and timeline expose no
  use.gpu types, and the viewer's "." entry exposes only owned types
  (`TrajectoryContext` is advanced).
- INVARIANT 4: `<UnitCell>` rebuilds its columns only when the box changes;
  colour and width are props. The provider never touches representation
  geometry.
- INVARIANT 6: `<Trajectory>` writes all `count` rows (unmapped rows and every
  row before the first frame copy upstream) and never re-provides topology.

### Found and fixed during the gate

A Phase 9 defect: when a new coordinate generation landed while a snapshot
readback was in flight, the effect was disposed, the copy neither published nor
rescheduled, and the new effect had already bailed out on `inFlight`. Snapshot
consumers stayed empty until the next generation, forever if playback paused.
The coordinate-stream demo had shown no ribbon since Phase 9. The copy now
publishes if still current and hands off to the latest scheduler.
`run-trajectory.mjs` reproduces it deterministically by holding `mapAsync` for
100 ms, and fails on the old code.

### Measurements

- Ribbon rebuild per snapshot (`withPositions`, trace, secondary structure,
  geometry): 1.6 ms on 1CRN, 8.8 ms on 2k39's first model. The snapshot lag in
  section 7 stands; GPU ribbons (e99.9) stay deferred.
- 922.9 re-measure on 2k39 (142,796 atoms): single clauses cost 3–21 ms, but
  `chain A and resi 10-20 and name CA` costs 2,083 ms and `name CA around 6`
  1,006 ms. The cause is `intersect-by`/`except-by` scanning the `by` rows once
  per set (O(sets × rows)), not the triple scan 922.9 folds. Filed as u4t; 922.9
  stays deferred behind it.

### Follow-ups

- molgpu-sept-u4t: select `intersect-by`/`except-by` are O(sets × by-rows).
- molgpu-sept-jmf: the site remounts the whole viewer per scrub step, so
  `<Trajectory src>` reopens its file.
- molgpu-sept-5td.15: NetCDF reader, deferred.
- Recorded on ahc.5, efv.8 and 9g3.8 by the counter-review: a GPU source seam
  for recording, CPU frames for per-frame DSSP, and unwrap after the kernel's
  minimum image.
