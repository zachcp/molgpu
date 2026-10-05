# Coordinate Bounds Readback Stays Separate

Date: 2026-10-05. `molgpu-sept-9es.8`. Source review of
`packages/viewer/src/use-coordinate-bounds.ts` against the shared
`internal/status-readback.ts` and `internal/throttled-readback.ts` helpers. No
production behavior changed.

## Decision

Keep `useCoordinateBounds` on its own staging and publication path. Its staging
retirement resembles `useStatusReadback` (two map-read buffers, a busy buffer
destroyed only after its map settles, late results from a retired owner
discarded), but the publication contracts differ:

| Concern                | `useStatusReadback` (Superpose, Unwrap)               | `useCoordinateBounds`                                            |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| Work encoded           | Copy appended to the provider's own encoder           | Own reduction dispatch, then copy                                |
| No free staging slot   | Copy dropped; the next provider dispatch reports      | Run retried until the latest generation lands                    |
| Result identity        | `(data, generation)` for one provider's status buffer | Source buffer, selected rows and generation captured at dispatch |
| Consumer of the result | Optional `onStatus` callback                          | Hook return value, also used by `useCoordinateFocus`             |

Generations are local to their provider
([publication contract](2026-09-28-gpu-publication-contract.md)). The nearest
coordinate stream can switch provider at an equal generation, so a
generation-only report could attribute bounds to the wrong stream. Adapting the
shared helper would require adding source and layout identity to its reports,
which `ReadbackToken` already models for snapshots; neither existing helper fits
without changing its contract.

`ThrottledReadback` is also unsuitable: it is rate limited and demand driven for
CPU snapshots, whereas bounds reads a fixed 12 KiB reduction once per
generation.

## Follow-up Observations

- Runs are serialized by an in-flight flag, so at most one of the two staging
  buffers is mapped at a time. A single staging buffer would suffice; this was
  not changed because it would alter retirement timing covered by the
  [acceptance matrix](2026-10-01-gpu-retirement-acceptance.md).
- The raw compute pipeline remains documented in the module header.
