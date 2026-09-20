# @molgpu/table

Renderer-free columnar molecular data. Import `createStructure`, `withPositions`,
`activeAtoms`, `residueKey`, and `coordinateBounds` from the package.

The schema and TypeScript declarations are in `src/index.d.ts`. Every domain has
an explicit logical `count`. Atom positions are packed XYZ Float32 in Angstrom;
instance operators are column-major Float64 affine matrices. Atom `element` is
an atomic number (0 = unknown), not the spike's palette index. Missing residue
`labelSeq` uses -1; author identifiers remain strings, with insertion codes in a
separate column. Empty strings represent absent string identifiers/altlocs.

`createStructure({ topology, positions })` validates cardinalities and foreign
keys and takes copies, so changing importer-owned arrays cannot mutate a dataset.
All returned arrays are **immutable by contract**: JavaScript cannot freeze a
nonempty typed array. Do not mutate them. Metadata records and string arrays are
frozen. Use `withPositions` for coordinate updates, which copies positions while
preserving dataset and topology identity. Position revisions are monotonic per
dataset, including branched updates. Topology/attribute replacement currently
requires a new dataset; no trajectory system or mutable store is implemented.

All source models and alternate locations are retained. `activeAtoms(data)` is
an explicit default view: first encountered model, plus blank-altloc atoms and
the residue conformer with largest summed occupancy (lexical tie-break). This
is a documented display policy, not a scientific claim about the best conformer.
Use `{ model: 'all', altloc: 'all' }` to keep everything or a numeric model ID.

Bonds retain endpoints, order (0 unknown, 1/2/3, 4 aromatic), and explicit/inferred
provenance. No bond inference is performed here. Each instance row applies one
operator to one chain; atoms are not duplicated for assemblies. Imports must
supply identity rows for chains displayed without assembly expansion. Empty
instance tables are valid data, but represent no explicit assembly instances.

`residueKey` includes model, both chain namespaces, label/author sequence,
insertion code and component. Never join annotations using sequence number alone.
`coordinateBounds` returns null for empty data/selection and covers raw selected
coordinates only. It does not apply instance transforms or display radii; viewer
framing must account for those separately.

Run `npm test` from the repository root. The fixtures are adversarial synthetic
contract tests, not the still-pending curated scientific oracle corpus (jy6.4).
