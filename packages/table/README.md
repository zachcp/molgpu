# @molgpu/table

Renderer-free columnar molecular data for molgpu. A structure is a set of
packed CPU columns (atoms, residues, chains, bonds, assembly instances) plus
packed XYZ positions. This package validates those columns, gives each dataset
a stable identity and revision counters, and derives the pure values that the
rest of the library builds on: the default atom view, residue join keys,
coordinate bounds, bond topology and polymer traces. It has no GPU, parser or
Mol* code; importers (`@molgpu/io`) lower into it and the viewer reads from it.

## Install

```sh
deno add jsr:@molgpu/table
```

No runtime dependencies and no peer dependencies. Written in TypeScript
(`src/*.ts`) with explicit types on every export, published as ES modules.

## Example

```js
import { createStructure, withPositions, activeAtoms, coordinateBounds, residueKey, selectBonds } from '@molgpu/table';

// One chain, one residue, two atoms (N and CA of an alanine).
const data = createStructure({
  positions: Float32Array.from([0, 0, 0, 1.46, 0, 0]),
  topology: {
    atoms: { count: 2, id: ['1', '2'], name: ['N', 'CA'], altloc: ['', ''],
      residue: Uint32Array.of(0, 0), element: Uint8Array.of(7, 6),
      occupancy: Float32Array.of(1, 1), bfactor: new Float32Array(2) },
    residues: { count: 1, chain: Uint32Array.of(0), labelSeq: Int32Array.of(1),
      authSeq: ['1'], insertionCode: [''], comp: ['ALA'], polymer: ['protein'] },
    chains: { count: 1, model: Int32Array.of(1), labelId: ['A'], authId: ['A'] },
    bonds: { count: 0, a: new Uint32Array(0), b: new Uint32Array(0), order: new Uint8Array(0), source: [] },
    instances: { count: 1, chain: Uint32Array.of(0), operatorId: ['1'],
      transform: Float64Array.of(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1) },
  },
});

const atoms = activeAtoms(data);                   // Uint32Array [0, 1]
console.log(coordinateBounds(data, atoms).center); // [0.73, 0, 0]
console.log(residueKey(data, 0));                  // [1,"A","A",1,"1","","ALA"]
console.log(selectBonds(data, atoms).length);      // 1 (inferred N-CA bond)

const moved = withPositions(data, Float32Array.from([0, 0, 0, 0, 1.46, 0]));
console.log(moved.identity === data.identity, moved.revision.positions); // true 1
```

## Data model

Every domain has an explicit logical `count`. Atom positions are packed XYZ
Float32 in Angstrom; instance operators are column-major Float64 affine
matrices. Atom `element` is an atomic number (0 = unknown). Missing residue
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
Identity is tracked in module-private state, so `withPositions` and
`bondTopology` only accept structures made by `createStructure` from the same
module instance. For that reason every other `@molgpu/*` package declares
`@molgpu/table` as a **peer** dependency: an app installs exactly one copy and
all packages share it. If `npm ls @molgpu/table` shows more than one copy,
structures from one will be rejected by the other.

All source models and alternate locations are retained. `activeAtoms(data)` is
an explicit default view: first encountered model, plus blank-altloc atoms and
the residue conformer with largest summed occupancy (lexical tie-break). This
is a documented display policy, not a scientific claim about the best conformer.
Use `{ model: 'all', altloc: 'all' }` to keep everything or a numeric model ID.

Bonds retain endpoints, order (0 unknown, 1/2/3, 4 aromatic), and explicit/inferred
provenance. `bondTopology` returns explicit bonds when the source supplied any;
otherwise it infers covalent bonds from distances (cached per position revision
and policy). Each instance row applies one operator to one chain; atoms are not
duplicated for assemblies. Imports must supply identity rows for chains
displayed without assembly expansion. Empty instance tables are valid data, but
represent no explicit assembly instances.

`residueKey` includes model, both chain namespaces, label/author sequence,
insertion code and component. Never join annotations using sequence number alone.
`coordinateBounds` returns null for empty data/selection and covers raw selected
coordinates only. It does not apply instance transforms or display radii; viewer
framing must account for those separately.

`traceTable` derives a segmented polymer trace (guide points and frames, split
into runs at gaps, chain/model changes and polymer-kind changes) from a
selection; `secondaryStructureTrace` adds per-sample direction vectors and
helix/sheet/coil labels over that trace. Both are inputs to the viewer's tube
and ribbon geometry.

## API

| Export | Stability | Description |
| --- | --- | --- |
| `createStructure` | stable | Validate and copy a `StructureInput` into a frozen `StructureData` with a fresh identity. |
| `withPositions` | stable | Replace coordinates, keeping dataset/topology identity and bumping the positions revision. |
| `activeAtoms` | stable | Atom indices for a view policy (default: first model, primary altloc conformer). |
| `residueKey` | stable | Namespaced, join-safe string key for one residue row. |
| `coordinateBounds` | stable | Untransformed min/max/center of selected atom positions, or null when empty. |
| `StructureData` | stable | Validated, identity-branded structure value accepted by every other package. |
| `validateStructure` | experimental | Throw a `TypeError` naming the offending column if a `StructureInput` is malformed; returns the input. |
| `bondTopology` | experimental | Explicit bonds, or distance-inferred covalent bonds cached per position revision and policy. |
| `selectBonds` | experimental | Bond row indices whose endpoints are both (or either) in an atom selection. |
| `traceTable` | experimental | Segmented polymer trace (guide points, tangent/normal/binormal frames, runs) for a selection. |
| `secondaryStructureTrace` | experimental | Per-sample direction vectors, helix/sheet/coil labels and block-boundary flags over a `Trace`. |
| `StructureInput` | experimental | Unvalidated `{ topology, positions }` input to `createStructure`. |
| `Topology` | experimental | The five column domains of a structure. |
| `Atoms` | experimental | Per-atom columns (names, altloc, residue FK, element, occupancy, B-factor, optional radius). |
| `Residues` | experimental | Per-residue columns (chain FK, label/author sequence, insertion code, component, polymer kind, optional SS). |
| `Chains` | experimental | Per-chain columns (model, label and author chain IDs). |
| `Bonds` | experimental | Bond columns (endpoints, order, explicit/inferred provenance). |
| `Instances` | experimental | Assembly rows: one chain times one column-major affine operator. |
| `ViewPolicy` | experimental | `activeAtoms` options: model (`first`/`all`/id) and altloc (`primary`/`all`). |
| `BondPolicy` | experimental | Bond inference options: distance padding and whether inter-chain bonds are allowed. |
| `Trace` | experimental | Return type of `traceTable`. |
| `SecondaryStructureTrace` | experimental | Return type of `secondaryStructureTrace`. |

The column schema interfaces are experimental because columns may still be
added; `StructureData` as the nominal value passed between packages is stable.
`api.txt` holds the exact signatures and must be updated
(`deno task check:hardening table --update`) with any API change.

## Place in the dependency graph

`table` is the root of the workspace graph: it has no dependencies, and `io`,
`select`, `fields` and `viewer` depend on it. It must stay a pure domain
package. It must not import any other `@molgpu/*` package, `molstar` (only `io`
may), any `@use-gpu/*` package, or browser/WebGPU/DOM APIs.

## Tests

Run `npm test` from the repository root. The fixtures are adversarial synthetic
contract tests, not the still-pending curated scientific oracle corpus (jy6.4).
