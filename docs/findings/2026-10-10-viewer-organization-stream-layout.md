# Viewer source organization: stream layout and counter-opinion

Date: 2026-10-10. Source baseline `d54ace6`. This document follows the
[proposal](2026-10-10-viewer-organization.md) and its
[counter-review](2026-10-10-viewer-organization-counter-review.md). Tracking
decision: `molgpu-sept-9fw`. Exploration only. No production files moved.
[File map and measurements](evidence/2026-10-10-viewer-organization-stream-map.json).

The goal stated on 2026-10-10 is a folder structure that gives humans and agents
a mental model. This document describes one candidate, then argues against it
before the decision is made.

## Candidate: name folders for what a component passes to its children

Placement rule: ask what a component makes available to the components nested
inside it. A structure goes in `structure/`, positions in `coordinates/`,
per-atom values in `attributes/`, a grid in `volume/`. A component that passes
nothing down and only draws goes in `representations/`. Code that is not a JSX
concept goes in `runtime/`. Helpers live with the component that owns them.

```text
src/
  index.ts  advanced.ts  types.ts  timeline-context.ts
  structure/              4   Structure/StructureProvider, resource, immutable-column cache
  coordinates/           12   context, snapshot, kernel, Transform, Superpose, Unwrap, NormalMode, ElasticNetwork
    trajectory/           6   Trajectory, player, frame cache/window, useTrajectoryFrame
  attributes/             7   contexts, snapshots, AttributeProducer, GpuDssp
  volume/                 5   Volume, context, buffers, EField, efield-grid
  representations/       11   Spacefill, BallAndStick, Tube, annotations, UnitCell, Ramachandran, ...
    bonds/ 3   ribbon/ 4   surface/ 7   volume/ 8
  interaction/            6   picking, pointer-plane, camera curve, coordinate focus
  runtime/                5   instrumentation, repaint, binding probe, source request, status
    gpu/ 9   styling/ 15   selection/ 5   instances/ 3
```

All 114 files are assigned. Two rules about import direction hold today with
**no violations**:

- **R1.** Nothing outside `representations/` imports from it. Providers never
  depend on what draws them.
- **R2.** Representations reach provider folders only through scope contracts:
  `structure-context`, `coordinates-context`, `coordinate-snapshot`,
  `attribute-snapshot`, `volume-context` and `use-trajectory-frame`. At the
  symbol level, they import hooks and types: `useStructure`,
  `useCoordinateSnapshot`, `useCoordinates`, `useVolume` and similar.

Path patterns are enough to check both rules, so a short `check:hardening` test
could enforce them. That would let an agent learn about a misplaced file from a
failing test.

## Counter-opinion

### C1. The rules hold because of the code, not because of the layout

R1 and R2 already hold in today's flat tree. The layout only lets path patterns
check them. The hybrid layout could check the same rules with a list of
filenames. R2 also relies on a list of contract files chosen after reading the
imports, and two of those files are large: `structure-context.ts` (228 lines,
contains `StructureProvider`) and `coordinate-snapshot.ts` (187 lines, contains
a boundary component and readback). A file-level rule cannot detect a
representation that starts importing implementation from those files. Treat the
rules as cheap guards against drift, not as evidence that this layout is better.

### C2. The placement rule decides a minority of files

About 13 exported Live components actually pass something to their children. The
remaining ~80 files follow the rule "live with your owner", which is the same
rule as the hybrid. Two files that do pass something down sit outside provider
folders:

- `picking.ts` provides the picking registry.
- `instance-copies.ts` provides draw copies.

So the single question needs a qualifier: what does it pass down **as one of the
dataset streams** (structure, coordinates, attributes, volume)?

### C3. `runtime/` is the old `internal/` under a new name

`runtime/` holds 37 files. The hybrid's mechanics folders (`internal`,
`rendering`, `selection`, `fields`) hold 32 in total. The top level becomes
tidier because the leftover helpers move one level down, not because they are
organized. `runtime/styling` (15 files) is the vaguest folder. It contains
`representation.ts`, which mixes selection validation, active rows, field
identity and column binding.

### C4. Nesting hides one of the three dataset entry points

Users and issue reports speak in terms of Structure, Trajectory and Volume.
Running `ls src/` shows `structure/` and `volume/` but not Trajectory. It is
correct that Trajectory provides coordinates, but discoverability matters more
here.

### C5. Separating Volume from its visuals separates code that is debugged together

Debugging a mismatch between the isosurface and the volume slice means moving
between `volume/` and `representations/volume/`. Molecular visuals are separated
from `Structure` the same way, but they are many and varied. The four volume
visuals form one small family next to a small provider.

### C6. Deeper paths

Under the candidate, 125 of 419 relative imports become `../../` paths. Under
the hybrid, none do. Moving Trajectory to the top level reduces this to 115.
Also moving the volume visuals under `volume/representations/` reduces it to
111. Most of the remaining depth comes from the `runtime/*` and
`representations/*` subfolders.

## What survives

Under C1–C6, the candidate and the corrected hybrid differ in three independent
choices, not in two whole layouts:

| Choice                 | Candidate                      | Counter-opinion favors                                                                                           |
| ---------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Trajectory location    | `coordinates/trajectory/`      | Top-level `trajectory/`. Rules unaffected; one entry concept visible.                                            |
| Volume visuals         | `representations/volume/`      | `volume/representations/`. R1 is still checkable with a `**/representations/**` pattern (0 violations measured). |
| Mechanics at top level | One `runtime/` with subfolders | Undecided. One folder makes the top level read as JSX; four named folders say more about each file.              |

Both views keep these parts:

- Feature subfolders under representations: `surface/`, `ribbon/`, `bonds/`.
- The counter-review's placement corrections, such as moving the instance files
  to rendering or runtime.
- Dropping the colliding `fields/` name.
- R1 and R2 as hardening guards.

Whichever way these choices go, `representation.ts` needs its own split before
`runtime/styling` or `rendering/` can have a meaning a reader can learn.

## Decision inputs requested

1. Should Trajectory be top-level or under `coordinates/`?
2. Should volume visuals go under `representations/volume/` or
   `volume/representations/`?
3. Should mechanics go in one `runtime/` folder or in named top-level folders?
4. Should R1 and R2 become hardening checks as part of the first move batch?

This document authorizes no implementation. The migration gates in the
counter-review (F7) apply to any of these choices.
