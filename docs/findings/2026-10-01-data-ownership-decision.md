# Immutable data ownership and scientific package responsibilities

Date: 2026-10-01. Baseline: `90fba5c`, Deno `2.9.7`. Decision spike:
`molgpu-sept-crj.10` (review finding F11). Production code and public exports
are unchanged by the spike. Executable acceptance:
`packages/table/test/ownership-contract.test.ts`; its ignored tests are the
target behaviour owned by `molgpu-sept-crj.24`.

## Decision

1. **Copy is the default.** Every public `create*`/`with*` constructor copies
   caller-supplied columns, so callers keep ownership of their inputs. This
   already holds for `createStructure`, `withPositions` and `withAttributes`.
2. **In-memory trajectories copy.** `createTrajectory({ frames })` must copy
   `positions`, `box` and `velocities`. It currently borrows them (reproduced
   below). The internal `trajectoryFromModels` builds fresh arrays and may adopt
   them without a second copy.
3. **Volume samples are a documented transfer.** `createVolume` keeps adopting
   `values` (one CPU copy of a potentially `MAX_VOLUME_SAMPLES` grid). The
   caller relinquishes the array; mutating it afterwards is a contract violation
   that would also leave `stats` stale. `dims` and `transform` are copied. No
   change.
4. **Streaming frames are validated once, at `createTrajectory`.** The returned
   `TrajectoryData.source` wraps the caller's `FrameSource` so every read checks
   index range, abort, `Float32Array` type, length and finiteness through
   `validateTrajectoryFrame` before any consumer sees or caches the frame.
   Validation is no longer delegated to each implementation.
5. **Frames a source returns are immutable and retainable.** A `FrameSource`
   must return a frame whose arrays it never writes again; consumers
   (`FrameCache`, `frameSecondaryStructure`) may retain them indefinitely and
   must not write them. A source that reuses a decode buffer violates this
   contract. The validated wrapper cannot detect it; the type docs must say so.
6. **No serialization API; workers exchange inputs.** Molecular values are
   realm-local. Send plain columns (or bytes) across a worker boundary and call
   the constructor on the receiving side, which creates a new identity. Never
   put a buffer owned by a molgpu value in a transfer list.
7. **No package moves.** Trace, DSSP and display bond inference stay in `table`;
   renderer-free geometry assembly stays in `viewer/internal`; connectivity
   keeps the crj.6 split. Quantities below.

### Why trajectories copy while volumes transfer

The likely producer of an in-memory trajectory is a running computation that
writes one working coordinate buffer per step; borrowing makes every retained
frame alias it. Volume producers (CCP4 decode, molecular surface, EField
readback, `volumeComponent`) each return a fresh array they never touch again,
and volumes are the largest single CPU payload. In-memory trajectories that are
too large to copy should use a `source`; GPU recording (`ahc.5`) already needs a
viewer-internal GPU seam rather than `createTrajectory({ frames })`.

## Contract by constructor and source

| Entry                          | Input arrays                                               | Validation                                          | Identity / revision                                        |
| ------------------------------ | ---------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------- |
| `createStructure`              | Copied (typed arrays sliced, string arrays frozen copies)  | Full, at construction                               | New identity; revisions 0                                  |
| `withPositions`                | Copied                                                     | Length and finiteness                               | Same identity; new branch positions revision               |
| `withAttributes`               | Copied                                                     | Name, domain, kind, type, length, finiteness        | Same identity; new attributes revision (none if unchanged) |
| `attributeColumn` (built-in)   | Returns the structure's own column (no copy)               | n/a                                                 | Cached per identity                                        |
| `createVolume`                 | `values` **adopted (transfer)**; `dims`/`transform` copied | Full, at construction; stats from values            | Value identity only                                        |
| `createVolumeGrid`             | `dims`/`transform` copied                                  | Full                                                | Value identity only                                        |
| `createTrajectory({ frames })` | Today **borrowed**; target **copied** (crj.24)             | Each frame at construction                          | Value identity only; frames are immutable                  |
| `createTrajectory({ source })` | Source retained; frames owned by the source                | Today none in table; target every read (crj.24)     | Value identity only                                        |
| `trajectoryFromDcd/Xtc/Trr`    | Fresh arrays per read                                      | Reader checks plus, after crj.24, the table wrapper | Through `createTrajectory`                                 |
| `time`, `atomMap`              | Copied                                                     | Construction                                        | n/a                                                        |

Immutable update rule: derive a new value with `withPositions`/`withAttributes`
(or re-create a volume/trajectory). Never write an array obtained from a molgpu
value; typed arrays cannot be frozen, so this is enforced by contract and by
revision-based consumers, not by the runtime.

## Evidence from current source

A scratch Deno probe on `90fba5c` printed:

| Probe                                                            | Result                                   |
| ---------------------------------------------------------------- | ---------------------------------------- |
| Mutate `createStructure` input positions                         | Structure unchanged                      |
| Mutate `createTrajectory({ frames })` input positions; `read(0)` | `99` (borrowed, no revision)             |
| Write `read(0).positions[1]`; read again                         | `42` (shared frame, contract-only)       |
| Custom source returns `Float64Array` of NaN                      | Returned as-is; not `Float32Array`       |
| Custom source `read(7)` with `frameCount: 1`                     | Resolves                                 |
| Mutate `createVolume` input `values`                             | `values[0] = 100`, `stats.max` still `1` |
| `structuredClone(structure)` then `withPositions`                | `TypeError` (identity is module-private) |
| `structuredClone(trajectory)`                                    | `DataCloneError` (source is a function)  |
| `structuredClone(volume)`                                        | Succeeds; clone is not frozen            |
| Transfer `volume.values.buffer` through a `MessageChannel`       | `volume.values.length === 0` afterwards  |

- `viewer/src/trajectory.ts` checks only `frame.positions.length` before
  `writeBuffer`; a `Float64Array` of the right length passes and writes 24
  B/atom into a 12 B/atom slot; the frame type is never checked. `FrameCache`
  retains source frames by index.
- `table/src/frame-ss.ts` reads `frame.positions` directly when unmapped, then
  copies through `withPositions`.
- DCD/XTC/TRR readers allocate fresh arrays per read and check finiteness
  themselves; `parsedTrajectory` wraps `createTrajectory` errors as `IoError`.
- No production source uses `postMessage`, `structuredClone` or a transfer list
  today; the worker rule documents a boundary rather than fixing a bug.
- `table/README.md` already says structures copy and volumes adopt; it says
  nothing about trajectory frames or source validation. The bead description's
  claim that volume constructors copy columns was inaccurate.

## Kernel responsibility inventory

`geo` has no `@molgpu/*` dependency and its kernels take typed arrays. The
candidates below all take `StructureData` or `VolumeData`, so moving them to
`geo` would add a `table` dependency there without removing coupling elsewhere.

| Module                                           | Lines | Imports                                    | Non-test consumers                          | Decision                                               |
| ------------------------------------------------ | ----: | ------------------------------------------ | ------------------------------------------- | ------------------------------------------------------ |
| `table/trace.ts` `traceTable`                    |   182 | table                                      | viewer ribbon, tube, ribbon-geometry        | Keep: topology derivation; CPU oracle                  |
| `table/secondary-structure.ts`                   |   111 | table                                      | viewer ribbon, ribbon-geometry              | Keep                                                   |
| `table/dssp.ts` `dssp`, `withSecondaryStructure` |   438 | table                                      | viewer gpu-dssp, ribbon                     | Keep: Mol* parity oracle for GPU DSSP                  |
| `table/frame-ss.ts` `frameSecondaryStructure`    |    92 | table                                      | none (io DSSP oracle test, private path)    | crj.25: unexported despite CHANGELOG                   |
| `table/bond-topology.ts` `bondTopology`          |   192 | table                                      | select expr/bond-graph, viewer bond-columns | Keep: display policy (crj.6)                           |
| `select/bond-graph.ts`, `bond-thresholds.ts`     |     — | table, Mol* thresholds                     | select, viewer snapshot publication         | Keep: chemical graph (crj.6); 868 vs 860 edges on 1EJG |
| `table/spatial-grid.ts`                          |   119 | none                                       | select (3), dynamics (2), table bonds       | Keep: shared, already in the lowest package            |
| `viewer/internal/ribbon-geometry.ts`             |   381 | geo, table, instrumentation                | ribbon                                      | Keep: single consumer, counters                        |
| `viewer/internal/tube-geometry.ts`               |   134 | table, `@use-gpu/core`, instrumentation    | tube                                        | Keep: not renderer-free                                |
| `viewer/internal/surface-geometry.ts`            |   126 | geo, table, io, viewer types, geometry-job | surface, isosurface                         | Keep: scheduling and Mol* adapter                      |
| `viewer/internal/isosurface-geometry.ts`         |    26 | geo, table, instrumentation                | isosurface                                  | Keep: thin adapter over geo marching cubes             |
| `viewer/internal/field-line-geometry.ts`         |   116 | fields, table                              | field-lines                                 | Keep: single consumer                                  |
| `viewer/internal/centroid.ts`, `slice-plane.ts`  |   166 | table                                      | annotations, superpose; field-arrows, slice | Keep: small, viewer-only consumers                     |
| `viewer/internal/tooltip.ts`                     |    64 | fields, table                              | none (tooltip.test.ts only)                 | crj.25: wire, document or delete                       |

Connectivity is already settled by
[the snapshot chemistry contract](2026-09-28-snapshot-chemistry-contract.md):
`select` owns the chemical graph used by selections and snapshots, `table`'s
`bondTopology` is a display policy, charges and unwrap use declared bonds.
Converging the two inference policies stays a separate scientific decision.

## Alternatives considered

- **Borrow everywhere, document "immutable by contract".** Smallest memory,
  matches volumes, but leaves the reproduced aliasing and makes the common
  simulation-loop producer silently wrong. Rejected for trajectories.
- **Copy volumes too.** Uniform, but doubles the largest CPU payload for
  producers that never retain their array. Rejected; transfer is documented.
- **Validate frames in each consumer.** The viewer, `frameSecondaryStructure`
  and `superpose` would each need the same check; a single wrapper at the
  constructor is one location and covers external sources.
- **Freeze or snapshot-hash frames to detect mutation.** Typed arrays with
  elements cannot be frozen, and hashing every read costs more than copying.
- **Move trace/DSSP/geometry into `geo` or a new package.** Adds dependencies
  and no second consumer; rejected per the package boundary rules.

## Follow-ups

- `molgpu-sept-crj.24`: copy in-memory frames and validate every source read;
  un-ignore the two acceptance tests; update README/type docs, api.txt review,
  CHANGELOG.
- `molgpu-sept-crj.25`: resolve `viewer/internal/tooltip.ts` and the unexported
  `frameSecondaryStructure`.
