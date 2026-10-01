# Source presentation decision

Date: 2026-10-01. Baseline: `b68c940`, use.gpu `0.20.0`, Deno `2.9.7`. Bead:
`molgpu-sept-s5o.2`. The shared request lifecycle (`useSourceRequest`, PR #41)
is unchanged. This records the presentation contract and adds its public
executable evidence; no component props or exports change.

## Decision

Keep the asymmetry crj.9 set, now with evidence:

- **Structure and Volume are dataset gates.** A pending `src` renders `loading`;
  a failed one renders `error(failure)`; the subtree mounts only with data. No
  change.
- **Trajectory is an upstream pass-through.** While opening, children render
  with upstream coordinates; a source failure is thrown from render. No
  `loading`/`error` props are added for parity.
- **Failure is sticky until the request changes.** A new `src`, a new `loader`
  identity or a remount starts a request. Re-rendering with identical props does
  not retry.
- **Retry is a keyed remount, in an array.** Live reconciles a single child in
  place and ignores its `key` (`mountFiberCall` in
  `@use-gpu/live/mjs/fiber.mjs:335`); keys apply only to array siblings. The
  public retry is therefore `[<Structure key={attempt} src={src} … />]`. This is
  documented rather than wrapped in a new prop.
- **Source to data and back.** The same element switching from `src` to `data`
  mounts the data at once and cancels a pending request, whose late result is
  ignored. Switching from `data` to `src` renders `loading` and never the
  previous data.

## Evidence

`packages/viewer/test/run-components.mjs` case 7b drives a new `lifecycle` mode
in the public consumer `packages/viewer/test/tsx/consumer.tsx` with a controlled
loader. A local run on this branch passed:

| Step                                     | Asserted                                                    |
| ---------------------------------------- | ----------------------------------------------------------- |
| Rejected loader                          | History `loading → error`; `error` receives the failure     |
| Unrelated re-render, same `src`/`loader` | No new request; still `error`                               |
| New key in an array                      | New request; `loading → ready` with the retried result      |
| `src` → `data`, same instance            | Data mounts; no loading transition                          |
| `data` → `src`                           | `loading`; no dataset in the subtree; nothing drawn         |
| `src` (pending) → `data`                 | Request reported cancelled; late result ignored; data draws |

A first attempt with a lone keyed `<Structure key={attempt}>` timed out waiting
for the retry request, which is how the Live key behaviour above was found.

Existing coverage already proves the rest and is not duplicated: Structure
replacement and stale suppression (cases 5 and 6), Volume `loading → ready` and
error (`run-volume.mjs` case 8), Trajectory retry by changed `src`, `src`/`data`
reloads, frame-failure isolation and replacement abort (`run-trajectory.mjs`
reload cases).

## Trajectory failure presentation

Live 0.20.0 exports no error boundary (no catch builtin among `MORPH` …
`SIGNAL`). A thrown Trajectory source failure therefore reaches the page as an
uncaught error, which the trajectory suite observes as `pageerror`. Other
subtrees keep rendering, and a later `src` change recovers without rethrowing,
but an application cannot present that failure from JSX.

That is a real limitation, but the fix belongs to `s5o.3`. Separating the source
from playback would let the source side gate like Structure/Volume, with the
same `loading`/`error` props, while playback stays a pass-through. Adding an
`error` prop to the combined component now would fix a public prop shape that
`s5o.3` may replace. `s5o.3` must decide Trajectory failure presentation
explicitly; the current throw is not to be treated as the long-term contract.

## Alternatives considered

- **Give Trajectory `loading`/`error` props now.** Gives parity, but a `loading`
  element would hide the upstream structure that pass-through deliberately
  keeps. An `error` prop alone is reasonable, but it pre-empts `s5o.3`.
- **A `retry`/`reloadToken` prop on every source.** Duplicates what a keyed
  remount already does and adds a dependency to the request hook. Rejected
  unless keyed remount proves inadequate in real use.
- **Retry automatically on re-render after failure.** That would re-fire failed
  network requests on every unrelated state change. Rejected.

## Follow-ups

None in this bead. `s5o.3` (now unblocked) owns the Trajectory failure
presentation question above.
