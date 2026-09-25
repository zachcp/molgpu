# @molgpu/select

Pure selection queries and dataset-bound resolved selections for molgpu. You
build a reusable `SelectionQuery` (by element, residue component, predicate or
distance), resolve it against one `@molgpu/table` `StructureData` into a sorted,
deduplicated `Selection`, and then combine selections (`union` / `intersect` /
`difference`), convert them between atom, residue and bond domains, and check
whether they are stale after the data changes. It is CPU index math only. There
is no renderer, no GPU or use.gpu concept, no string selection language and no
WGSL. The viewer takes the resulting `Selection` and uploads its indices.

## Install

```sh
npm install @molgpu/select @molgpu/table
```

**Peer dependencies:** `@molgpu/table` (it provides `StructureData`). It is a
peer so the app holds one shared copy; structure identity is module-private and
two copies reject each other's structures.

## Example

```js
import { createStructure, withPositions } from '@molgpu/table';
import { element, comp, within, resolve, toAtoms, union, count, isStale } from '@molgpu/select';

// Two residues (CYS, GLY), four atoms, one bond. Real data comes from @molgpu/io.
const data = createStructure({
  positions: Float32Array.from([0, 0, 0, 1.8, 0, 0, 5, 0, 0, 6, 0, 0]),
  topology: {
    atoms: {
      count: 4, id: ['1', '2', '3', '4'], name: ['CB', 'SG', 'CA', 'O'], altloc: ['', '', '', ''],
      residue: Uint32Array.from([0, 0, 1, 1]), element: Uint8Array.from([6, 16, 6, 8]),
      occupancy: Float32Array.from([1, 1, 1, 1]), bfactor: new Float32Array(4),
    },
    residues: {
      count: 2, chain: Uint32Array.from([0, 0]), labelSeq: Int32Array.from([1, 2]),
      authSeq: ['1', '2'], insertionCode: ['', ''], comp: ['CYS', 'GLY'], polymer: ['protein', 'protein'],
    },
    chains: { count: 1, model: Int32Array.from([1]), labelId: ['A'], authId: ['A'] },
    bonds: { count: 1, a: Uint32Array.from([0]), b: Uint32Array.from([1]), order: Uint8Array.from([1]), source: ['explicit'] },
    instances: { count: 1, chain: Uint32Array.from([0]), operatorId: ['identity'], transform: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) },
  },
});

// Queries are pure recipes; resolve binds them to one dataset.
const sulfur = resolve(element(16), data);
const cysAtoms = toAtoms(resolve(comp(['CYS']), data), data); // residue -> atom, keeps a source map
const near = resolve(within(2, element(16)), data);           // position-dependent

console.log([...sulfur.indices], [...cysAtoms.indices], [...cysAtoms.source.rows]); // [ 1 ] [ 0, 1 ] [ 0, 0 ]
console.log(count(union(sulfur, near)));                                          // 2

const moved = withPositions(data, Float32Array.from([0, 0, 0, 9, 0, 0, 5, 0, 0, 6, 0, 0]));
console.log(isStale(sulfur, moved), isStale(near, moved)); // false true
```

## Concepts

Two concepts, kept apart on purpose:

- **`SelectionQuery`**: a reusable, structure-independent recipe. Building one
  (`all`, `where`, `element`, `comp`, `within`) touches no dataset, so the same
  query resolves against many structures independently.
- **`Selection`**: the result of `resolve(query, data)`. It carries the
  dataset's identity, its `domain` (`atom` | `residue` | `bond`), the sorted
  unique in-range `indices`, the dependency **revisions** it read (`deps`), and a
  library-owned `id`. The caller's label is only a label, never the cache key.
  Identity is derived from dataset, revisions and membership, so two datasets
  that share a query label still get distinct ids, and changed membership changes
  the id.

### Invalidation

`deps` records which revision streams a resolution read. Structural queries read
`topology`/`attributes`, and `within` also reads `positions`. `isStale(sel, data)`
returns true once any stream it read has advanced (for example after
`withPositions`). Structural selections survive a coordinate-only update;
position-dependent ones do not.

### Set operations and conversions

`union` / `intersect` / `difference` act on resolved selections and reject mixing
datasets, domains or inconsistent revisions. Results stay sorted and deduplicated.

Conversions cross domains and keep a source map back to the originating rows,
for picking and field lookup:

- `toAtoms`: residue→atom expansion keeps `source.rows[k]` = the residue row of
  atom `indices[k]`; bond→atom unions both endpoints (deduplicated).
- `toResidues`: collapse to the residues an atom or bond selection touches.
- `toBonds(sel, data, { endpoints })`: `both` keeps bonds whose endpoints are
  both selected, `either` keeps any touched bond; `source.a`/`source.b` are the
  endpoint atom rows per bond.

Empty selections are valid and explicit (`isEmpty`, `count`).

## API

| Export | Stability | Description |
|---|---|---|
| `all` | stable | Query for every row of a domain (default `atom`). |
| `where` | stable | Query from a labelled row predicate `(data, row) => boolean`, run once at resolve time. |
| `element` | stable | Query for atoms with a given atomic number. |
| `comp` | stable | Query for residues whose chemical component name is in a list. |
| `within` | stable | Query for atoms within a distance (Angstrom) of an inner query; depends on positions. |
| `resolve` | stable | Resolve a query against one `StructureData` into a `Selection`. |
| `union` | stable | Union of two selections from the same dataset and domain. |
| `intersect` | stable | Intersection of two selections from the same dataset and domain. |
| `difference` | stable | Rows in the first selection but not the second. |
| `toAtoms` | stable | Expand a residue or bond selection to atoms, keeping a residue source map. |
| `toResidues` | experimental | Collapse a selection to the residues it touches. |
| `toBonds` | experimental | Bonds incident on a selection (`endpoints: 'both' \| 'either'`), with endpoint source map. |
| `isStale` | experimental | True once any revision stream the selection read has advanced on `data`. |
| `isEmpty` | experimental | True when a selection has no rows. |
| `count` | stable | Number of rows in a selection. |
| `Selection` | stable | Type: a resolved, dataset-, domain- and revision-bound set of sorted indices. |
| `SelectionQuery` | stable | Type: a pure, dataset-independent query recipe. |
| `Domain` | stable | Type: `'atom' \| 'residue' \| 'bond'`. |
| `RevisionStream` | experimental | Type: `'topology' \| 'positions' \| 'attributes'`, the streams a selection may depend on. |
| `SourceMap` | experimental | Type: mapping from a converted selection's rows back to the source domain rows. |

## Place in the dependency graph

`@molgpu/select` depends only on `@molgpu/table` (runtime) and is consumed by
`@molgpu/viewer` and the examples. It sits beside `@molgpu/fields` above `table`.

It must not import `molstar` (only `@molgpu/io` may), any `@use-gpu/*` package
(only `@molgpu/viewer` may import `live`/`workbench`/`shader`), or any other
`@molgpu/*` package besides `table`. Its public types must not mention GPU,
use.gpu or Mol* concepts.

Run `npm test` from the repository root.
