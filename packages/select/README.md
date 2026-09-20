# @molgpu/select

Pure selection queries and dataset-bound resolved selections. No renderer, no
string parser, no WGSL — CPU index math over a `@molgpu/table` `StructureData`.

Two concepts, kept apart on purpose:

- **`SelectionQuery`** — a reusable, structure-independent recipe. Building one
  (`all`, `where`, `element`, `comp`, `within`) touches no dataset, so the same
  query resolves against many structures independently.
- **`Selection`** — the result of `resolve(query, data)`. It carries the
  dataset's identity, its `domain` (`atom` | `residue` | `bond`), the sorted
  unique in-range `indices`, the dependency **revisions** it read (`deps`), and a
  library-owned `id`. The caller's label is a label, never the cache key:
  identity is derived from dataset, revisions, and membership, so two datasets
  that share a query label still get distinct ids, and changed membership changes
  the id.

## Invalidation

`deps` records which revision streams a resolution read — structural queries read
`topology`/`attributes`; `within` also reads `positions`. `isStale(sel, data)`
returns true once any read stream has advanced (e.g. after `withPositions`).
Structural selections survive a coordinate-only update; position-dependent ones
do not.

## Set operations and conversions

`union` / `intersect` / `difference` act on resolved selections and reject mixing
datasets, domains, or inconsistent revisions; results stay sorted and deduped.

Conversions cross domains and retain a source map back to the originating rows,
for picking and field lookup:

- `toAtoms` — residue→atom expansion keeps `source.rows[k]` = the residue row of
  atom `indices[k]`; bond→atom unions both endpoints (deduped).
- `toResidues` — collapse to the residues an atom/bond selection touches.
- `toBonds(sel, data, { endpoints })` — `both` keeps bonds whose endpoints are
  both selected, `either` keeps any touched bond; `source.a`/`source.b` are the
  endpoint atom rows per bond.

Empty selections are valid and explicit (`isEmpty`, `count`).

Run `npm test` from the repository root.
