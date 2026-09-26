# Core use.gpu simplicity review — 2026-09-26

Tracked by bead `molgpu-sept-1cr`. Reviewed the seven package boundaries, the
viewer resource and representation flow, and the pinned use.gpu 0.20.0 data and
shader components.

## Result

- `table`, `select`, `fields`, `geo`, and `io` retain plain data and pure
  calculation. `timeline` imports only a pinned, pure interpolation helper from
  `@use-gpu/core`. Live, GPU sources, and render components stay in `viewer`.
- `<Structure>` owns the CPU resource and shares one GPU positions and radii
  source with its descendants. `ColumnSource` uses upstream `RawData` for packed
  typed columns. `OwnedSource` adds explicit disposal because RawData 0.20.0
  does not destroy its buffers on unmount. Keep this small adapter while pinned
  upstream behavior requires it.
- `Spacefill` previously created a second per-atom size array from radii, then
  uploaded it. It now feeds the existing GPU radii source through use.gpu's
  `useShader` and `useShaderRef` into `PointLayer.sizes`. Display scale and view
  conversion form one uniform. Both whole and selected draws read the shared
  radii (selected draws through their rows; see `molgpu-sept-202` below). This
  removes one buffer and one camera-dependent CPU array pass per draw.
- `withColumns` remains a narrow composition of `RawData` sources for meshes and
  gathered columns. Upstream `Data` converts JS records to columns, which would
  add conversion work for these already packed typed arrays. The CPU ribbon and
  surface kernels remain appropriate: they generate molecular geometry, while
  their output columns are stored and drawn on the GPU.

## Internal representation pass

- One selection representation. `StructureResource` carried a second resolved
  atom set (`AtomSelection`, `selection()`, `accepts()`) with an LRU cache sized
  by `<Structure maxSelections>`. No representation read it; representations
  take `@molgpu/select` `Selection`s. Its only caller, `focusSelection`, used it
  as a liveness check, and a full-structure focus built a string key of every
  atom index to do so. Removed (experimental API); `resource.bounds` already
  rejects a disposed resource.
- One column copy. `prepareColumn` sliced every packed column before `RawData`
  copied it again into its staging array. Columns are immutable by contract, so
  array identity is the upload key and the slice and the `revision` prop of
  `ColumnSource` are gone. The adapter browser probe now publishes a new array
  instead of mutating one in place.
- One selection guard. The foreign/non-atom check was copied into six components
  and the "selection, else `activeAtoms`" memo into three. `checkAtomSelection`
  and `useActiveRows` in `internal/representation.ts` now own them;
  `gatherAtomColumns` (`internal/gather.ts`, GPU-free for unit tests) replaces
  the Spacefill and Bonds attribute gathers.
- One radius source. `atoms.radius` is optional in `@molgpu/table`, but the
  viewer assumed it: the shared source provider dropped both GPU columns without
  it (Spacefill drew nothing), Surface dereferenced `undefined`, and framing
  used zero extents. The element default table lived in `@molgpu/io`.
  `@molgpu/table` now owns `elementRadius` and `atomRadii` (the column, else
  cached element defaults); io and all four viewer readers use them.
- Cheaper validation keys. `validateStructure` JSON-encoded an array per atom
  and a string per bond for its duplicate checks. A length-prefixed site string
  and an integer bond-pair key cut validation from 264 to 189 ms (min of 20) at
  400k atoms and bonds.

`within` and the selection gathers were left for follow-ups, completed below.

## Follow-ups completed

- `molgpu-sept-emt`: `@molgpu/table` `spatialGrid` backs both bond inference and
  `within`. Cells now span the largest bond cutoff (the old fixed 3 Å cell
  missed S/P pairs up to 3.14 Å apart across two cells) and bond inference
  partitions by model. On the corpus, `within` results are identical and
  inferred bond sets are identical (rows now in canonical order). 2k39 (143k
  atoms, NMR ensemble): bond inference about 5.8 s to 0.55 s for two calls,
  `within` sweep 6.3 s to 1.5 s.
- `molgpu-sept-202`: `internal/indexed.ts` composes `getData(getIndex(i))` with
  use.gpu's `getShader`, so selected Spacefill and field-coloured Bonds read
  shared per-atom columns through an uploaded row column. The drawn instance
  index is unchanged, so Pickable's instance → atom mapping still holds; a new
  picking case draws a selection whose first drawn instance is atom row 1, and
  fails if the indexed read is disabled.

Sources:
[use.gpu data-driven geometry](https://usegpu.live/docs/guides-data-driven-geometry),
[use.gpu shader linking](https://usegpu.live/docs/guides-shaders), and the
pinned `node_modules/@use-gpu/workbench/mjs/data/raw-data.mjs` and
`mjs/layers/point-layer.mjs` implementations.
