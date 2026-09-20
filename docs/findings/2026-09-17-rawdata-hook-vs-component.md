# `useRawSource` is not a drop-in for `RawData` with packed vec3 columns

Found while building the composed scene. This corrects the headline conclusion
of `2026-09-16-structure-component.md` and the original version of this finding.

## Correction (2026-09-17-b)

The original finding correctly identified that the hook and component paths are
not interchangeable, but it blamed the wrong column. `segments` is `i32` and
works through either path. The actual failure is a packed `vec3<f32>` position
column passed to `useRawSource`.

`RawData` copies packed CPU vec3 rows into four GPU slots per row. The hook
uploads `array.buffer` verbatim, while the shader reads a 16-byte vec3 stride.
After the first vertex, the shader therefore reads the wrong coordinates. That
made the bonds appear to connect cross-pairs; their segment codes were correct.

The isolated controls live in `spikes/examples/?ex=adapter` and
`packages/viewer/test/`. `?rep=bonds` uses `ColumnSource`/`RawData` for positions
and renders correct bonds; `?rep=bonds&src=hook` changes only the position source
and fails. `hook-segments` remains a valid control.

**Current rule:** never bind packed `vec3<f32>` data through `useRawSource`.
Use `RawData` or the internal `ColumnSource` adapter, which delegates to it.

## The earlier claim that was wrong

The Structure writeup said:

> `useRawSource(array, format) -> StorageSource` is the hook-level equivalent
> of the `RawData` component.

It is not equivalent. With identical geometry and layer props, a `LineLayer`
with hook-uploaded packed positions draws cross-pair connectors; the same
positions supplied through `RawData` draw correct discrete strokes.

## How it presented

Bonds looked wrong in the composed scene — long lines joining atoms that are not
bonded. The user spotted it as “the bonds don't seem to be connecting the correct
atoms”. On crambin, real bonds max at 1.82 Å while the false cross-pair connectors
reach 8.68 Å.

## What was eliminated first

- the segment encoding — a dumbbell isolation test confirms `[1,2]` repeated
  gives three clean strokes and no connectors;
- the segment data — codes alternate 1,2 correctly and positions match pairs;
- shaded/sides/depth, width, source order, and stale modules.

The component path fixed the result outright. Reading `raw-data.mjs` against
`useRawSource.mjs` then identified the material difference: GPU-dimension packing
for vec3 inputs.

## Consequences

Packed `vec3<f32>` sources must come from `RawData`, not `useRawSource`. Scalar,
i32, u32, vec2 and vec4 behavior is separately covered by the adapter regression
suite; do not generalize one result to every source format without a test.

`useRawSource` remains unsuitable as the viewer's general column uploader. The
fixed schema must preserve logical row counts, typed-array views, versioning and
resource cleanup, all now owned by `ColumnSource`.

`<Structure>` must not directly upload packed vec3 columns through the hook.
`ColumnSource` removes the component nesting pyramid without bypassing `RawData`.
The hook is an opt-in, format-specific optimization only after its behavior is
verified for the pinned upstream version.

## Remaining scope

The root cause for packed vec3 is established. The internal adapter bead remains
open because its full browser lifecycle fixture still needs to prove rendering,
updates and teardown across all supported formats. The upstream report bead must
not claim a `segments` bug; any report should be limited to the documented
vec3-packing contract mismatch.
