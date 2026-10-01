# Source and playback decision for Trajectory

Date: 2026-10-01. Baseline: `aaa6a81`, use.gpu `0.20.0`, Deno `2.9.7`. Plan:
`molgpu-sept-s5o.3`. Builds on the
[source presentation decision](2026-10-01-source-presentation-decision.md)
(s5o.2) and the
[ordinary JSX decision](2026-10-01-ordinary-jsx-selection-styling-decision.md)
(crj.9). Production code and exports are unchanged. Executable example:
`packages/viewer/test/tsx/trajectory-source-spike.tsx`, type-checked by
`deno task typecheck:components`.

## Decision

1. **Keep one `<Trajectory>`.** It continues to accept exactly one of `src` or
   `data` plus playback props (`frame`, `interpolate`, `pbc`). Do not add a
   separate source component, a source hook, or a playback-only component.
2. **The separated form already exists.** An application that wants to own
   opening — its own pending UI, retries, caching, or a source shared by several
   players — calls `openTrajectory` from `@molgpu/io` and passes the result as
   `<Trajectory data>`. That path is playback only and never opens anything.
   Document it as the advanced form; do not wrap it.
3. **Failures are reported, not thrown (`s5o.18`).** `<Trajectory>` is a
   coordinate provider. Following crj.9's rule for failed coordinate selections,
   a failed source open or frame read passes upstream coordinates through and
   reports a `TrajectoryStatus` through `onStatus`. Without a callback it logs a
   deduplicated `console.error`. It gets no `loading`/`error` element props,
   because pass-through already is its pending presentation. Prop misuse, a
   frame curve without a timeline, and `TrajectoryImageBoxLimitError` still
   throw: they are programming or scientific errors, not source states.
4. **Retry reuses the s5o.2 contract.** A failure stays until `src`, `loader` or
   a keyed remount (in an array) changes the request.
5. **Opening should not remount descendants (`s5o.19`, measured first).**

## Evidence from current source

- `Trajectory` (`viewer/src/trajectory.ts`) validates props, runs
  `useSourceRequest`, and then returns `children` while pending, throws the
  failure, or returns `viewer(use(TrajectoryProvider, { …, children }))`.
  `TrajectoryProvider` passes through on an empty structure, otherwise runs
  `TrajectoryPlayer`, which owns the frame cache, scheduler, GPU window,
  interpolation/PBC kernel and `TrajectoryContext`.
- Opening and playback are already separate functions. The public coupling is
  only the prop union, and `data` bypasses the request entirely, so a public
  split would add a name without a new capability.
- `TrajectoryContext` carries the trajectory to `Superpose to="first"`,
  `UnitCell`, `Unwrap` and `useTrajectoryFrame`. A source component split from
  its player would have to provide that context without moving anything, or
  descendants would need two ancestors. Keeping one component avoids that.
- `TrajectoryPlayer` throws `<Trajectory>: frame N failed to load` from render,
  and `Trajectory` throws a source failure. Live 0.20.0 has no error boundary,
  so `run-trajectory.mjs` observes both as `pageerror`. Those are the only
  source/IO errors the component cannot contain.
- With `src`, the return shape changes from `children` to a provider wrapping
  `children` when the file opens. The component's doc comment says children
  "remount once under the trajectory". This is source-reviewed, not measured;
  `s5o.19` measures it before changing anything.

## Alternatives considered

| Option                                                       | Outcome                                                                                                                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separate `<TrajectorySource>` + playback component           | Rejected: duplicates `openTrajectory` + `data`, adds a second ancestor for `TrajectoryContext` consumers, and forces two-level JSX for the common case. |
| `useTrajectorySource(src)` hook in the main entry            | Rejected for now: crj.9 keeps new main-entry hooks out, and `openTrajectory` with the app's own state already does this.                                |
| `loading`/`error` element props on Trajectory (s5o.2 parity) | Rejected: a loading element would hide the structure that pass-through deliberately keeps visible.                                                      |
| `error` element prop only, rendered beside children          | Rejected: mixes a scene element into a coordinate provider; a callback matches `onStatus` on Superpose/Unwrap and `onSelectionStatus`.                  |
| Keep throwing                                                | Rejected: with no Live error boundary, applications cannot present or recover from it in JSX.                                                           |

## Follow-ups

- `molgpu-sept-s5o.18` (P2, blocks crj.13): `onStatus` with pass-through on
  source and frame failure. Its acceptance removes the `@ts-expect-error` in the
  spike and replaces `pageerror` waits in `run-trajectory.mjs`.
- `molgpu-sept-s5o.19` (P3): measure and remove the descendant remount when a
  `src` trajectory opens.
