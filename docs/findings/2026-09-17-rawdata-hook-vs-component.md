# useRawSource is NOT a drop-in for the RawData component

Found while building the composed scene. This **corrects the main conclusion of**
`2026-09-16-structure-component.md`.

## The claim that was wrong

The `<Structure>` writeup said:

> `useRawSource(array, format) -> StorageSource` is the **hook-level** equivalent
> of the `RawData` component. This is the single most useful discovery here.

It is not equivalent. With **identical data and identical props**, a
`LineLayer` fed `segments` from the hook **ignores the segment codes** and draws
the cross-pair connectors; fed the same array through the `RawData` component it
draws correct discrete strokes.

## How it presented

Bonds looked wrong in the composed scene — long lines joining atoms that are not
bonded. The user spotted it as "the bonds don't seem to be connecting the correct
atoms", which is exactly right: the spurious lines run from bond *k*'s end to
bond *k+1*'s start.

Measured on crambin: real bonds max **1.82 A**, but the cross-pair connectors
reach **8.68 A** — and 333 of them were being drawn alongside the 334 real bonds.

## What was eliminated first

Each of these was tested and is **not** the cause:

- the segment encoding — a dumbbell isolation test (three short segments placed
  far apart, so a connector cannot be mistaken for a real segment) confirms
  `[1,2]` repeated gives exactly 3 clean strokes and no connectors
- the data — the built arrays were dumped and verified: codes alternate 1,2
  correctly, positions match the pairs, real lengths all <= 1.82 A
- `shaded` / `sides` / `depth` — connectors appear in both shaded and flat modes
- `width` — same at 0.22 and 3
- source creation order — creating `segments` before `positions` changed nothing
- stale modules — reproduced in fresh tabs

The only remaining difference from the known-good `ex/lines.mjs` was hook vs
component. Switching to `RawData` components fixed it outright.

## Consequences

**Rule for now: any source a layer interprets structurally — `segments` above
all — must come from the `RawData` component, not `useRawSource`.**

`useRawSource` does appear to work for plain per-element attributes
(`positions`, `colors`, `sizes` in `<Spacefill>` render correctly). But "appears
to work" is exactly what was believed about `segments` too, so treat the hook as
**unverified** for anything else until each case is checked.

This partially undoes the ergonomic win in `<Structure>`:

- `<Structure>`'s fixed-schema column upload still uses `useRawSource`, and its
  columns are plain attributes, so it stands for now — but it needs a deliberate
  audit rather than an assumption.
- Representations that need structurally-interpreted sources are back to the
  `RawData` nesting pyramid. `<Bonds>` and `<Tube>` now use components.
- The "hook removes the pyramid" framing should be stated much more narrowly:
  it removes it for plain attribute columns only.

## Not yet root-caused

Why the hook's source differs is unknown. `RawData` does more than allocate a
buffer — it computes bounds via `getBoundingBox`/`toDataBounds`, tracks
dimensions through `toCPUDims`/`toGPUDims`, and versions its uploads. One of
those is probably what the segment lookup depends on. Worth reading
`data/raw-data.mjs` against `hooks/useRawSource.mjs` properly before relying on
the hook anywhere new, and worth an upstream question since the two are
presented as interchangeable.
