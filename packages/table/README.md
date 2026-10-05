# @molgpu/table

Renderer-free columnar molecular data for molgpu. A structure is a set of packed
CPU columns (atoms, residues, chains, bonds, assembly instances) plus packed XYZ
positions. This package validates those columns, gives each dataset a stable
identity and revision counters, and derives the pure values that the rest of the
library builds on: the default atom view, residue join keys, coordinate bounds,
bond topology and polymer traces. It has no GPU, parser or Mol* runtime
dependency; importers (`@molgpu/io`) lower into it and the viewer reads from it.

## Install

```sh
deno add jsr:@molgpu/table
```

No runtime dependencies. Written in TypeScript (`src/*.ts`) with explicit types
on every export, published as ES modules.

## Example

```js
import {
  activeAtoms,
  coordinateBounds,
  createStructure,
  residueKey,
  withPositions,
} from "@molgpu/table";

// One chain, one residue, two atoms (N and CA of an alanine).
const identity = new Float64Array(16);
identity[0] =
  identity[5] =
  identity[10] =
  identity[15] =
    1;
const data = createStructure({
  positions: Float32Array.from([0, 0, 0, 1.46, 0, 0]),
  topology: {
    atoms: {
      count: 2,
      id: ["1", "2"],
      name: ["N", "CA"],
      altloc: ["", ""],
      residue: Uint32Array.of(0, 0),
      element: Uint8Array.of(7, 6),
      occupancy: Float32Array.of(1, 1),
      bfactor: new Float32Array(2),
    },
    residues: {
      count: 1,
      chain: Uint32Array.of(0),
      labelSeq: Int32Array.of(1),
      authSeq: ["1"],
      insertionCode: [""],
      comp: ["ALA"],
      polymer: ["protein"],
    },
    chains: {
      count: 1,
      model: Int32Array.of(1),
      labelId: ["A"],
      authId: ["A"],
    },
    bonds: {
      count: 0,
      a: new Uint32Array(0),
      b: new Uint32Array(0),
      order: new Uint8Array(0),
      source: [],
    },
    instances: {
      count: 1,
      chain: Uint32Array.of(0),
      operatorId: ["1"],
      transform: identity,
    },
  },
});

const atoms = activeAtoms(data); // Uint32Array [0, 1]
console.log(coordinateBounds(data, atoms)?.center); // [0.73, 0, 0]
console.log(residueKey(data, 0)); // [1,"A","A",1,"1","","ALA"]

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
keys and takes copies, so changing importer-owned arrays cannot mutate a
dataset. All returned arrays are **immutable by contract**: JavaScript cannot
freeze a nonempty typed array. Do not mutate them. Metadata records and string
arrays are frozen. Use `withPositions` for coordinate updates, which copies
positions while preserving dataset and topology identity. Position revisions are
monotonic per dataset, including branched updates. Replacing topology requires a
new dataset. Use `withAttributes` to replace derived attribute columns while
retaining dataset identity. Identity is tracked in module-private state, so
`withPositions` and `bondTopology` only accept structures made by
`createStructure` from the same module instance; see
[one shared table copy](#one-shared-table-copy).

Ownership follows one rule with one exception. Constructors copy caller arrays:
`createStructure`, `withPositions`, `withAttributes` and the in-memory `frames`
of `createTrajectory`. `createVolume` adopts `values` as a transfer (one CPU
copy of a large grid): do not write that array afterwards, or its `stats` go
stale. A trajectory `source` owns the frames it returns; `createTrajectory`
validates each read, and consumers may cache frames, so a source must not reuse
decode buffers. Molecular values are local to one JavaScript realm: to cross a
worker boundary, send plain columns or bytes and call the constructor on the
receiving side (a new identity), and never transfer a buffer owned by a molgpu
value.

All source models and alternate locations are retained. `activeAtoms(data)` is
an explicit default view: first encountered model, plus blank-altloc atoms and
the residue conformer with largest summed occupancy (lexical tie-break). This is
a documented display policy, not a scientific claim about the best conformer.
Use `{ model: 'all', altloc: 'all' }` to keep everything or a numeric model ID.

Bonds retain endpoints, order (0 unknown, 1/2/3, 4 aromatic), and
explicit/inferred provenance. `bondTopology` returns explicit bonds when the
source supplied any; otherwise it infers covalent bonds from distances (cached
per position revision and policy). Each instance row applies one operator to one
chain; atoms are not duplicated for assemblies. Imports must supply identity
rows for chains displayed without assembly expansion. Empty instance tables are
valid data, but represent no explicit assembly instances. Importers emit one
identity row per chain unless asked for an assembly
(`structureFromBcif(input, { assembly })`).
[`@molgpu/viewer`](https://jsr.io/@molgpu/viewer) draws one copy per operator.

`residueKey` includes model, both chain namespaces, label/author sequence,
insertion code and component. Never join annotations using sequence number
alone. `coordinateBounds` returns null for empty data/selection and covers raw
selected coordinates only. It does not apply instance transforms or display
radii; viewer framing must account for those separately.

`traceTable` derives a segmented polymer trace (guide points and frames, split
into runs at gaps, chain/model changes and polymer-kind changes) from a
selection; `secondaryStructureTrace` adds per-sample direction vectors and
helix/sheet/coil labels over that trace. Both are inputs to the viewer's tube
and ribbon geometry.

### One shared table copy

JSR publishes the `@molgpu/*` packages' dependencies on each other as caret
ranges of the release they were built with. Keep every `@molgpu/*` package on
compatible versions so the application resolves one shared copy of this package:
identity and revision state are module-private, so identity-dependent operations
can reject values from divergent copies. Use `deno info` and the lockfile to
find duplicate versions, then align the application and package dependency
ranges.

## Chemical data and display policies

Chemical identity, query radii and display radii serve different purposes. Use
the named API for the operation you need; a display fallback is not a physical
measurement.

| Data                     | Source and consumers                                                 | Meaning                                                                                                            |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Atomic number and symbol | `ELEMENT_SYMBOL`; IO decoders, selection queries and dynamics labels | Atomic identity, with 0/empty for unknown; D/T and modern superheavy spellings are input aliases.                  |
| Selection atomic mass    | `@molgpu/select` expression evaluation                               | Mol* 5.12.0 atomic-weight query values; no other package currently consumes these query semantics.                 |
| Selection VDW radius     | `@molgpu/select` expression evaluation                               | Mol* `ElementVdwRadii` values and Mol* query default; `NaN` preserves an absent Mol* value.                        |
| Display fallback radius  | `elementRadius`, `atomRadii` and IO's zero-PQR-radius fallback       | Common-element display radius, default 1.7 Å. A positive input `atoms.radius` overrides it.                        |
| PQR radius               | `@molgpu/io` PQR attributes and `pqr:radius`                         | Value carried by the PQR file; zero remains in `pqr:radius`, while display radius falls back to the table default. |
| Covalent radius          | `bondTopology`                                                       | Small-element radii used only to infer covalent connectivity.                                                      |
| Mol* bond thresholds     | `@molgpu/select` connectivity and proximity expressions              | Query-specific search and pair thresholds; not display or covalent radii.                                          |
| CPK colors               | `@molgpu/fields` element-color preset                                | Visualization policy, independent of chemical identity.                                                            |

`ATTRIBUTE_DOMAINS` is the single domain registry for built-in and well-known
column names. `attributeColumn` uses it when resolving table columns, and
`@molgpu/fields` uses the same exported map when constructing attribute fields.

Element identity exports:

| Export                         | Description                                                                |
| ------------------------------ | -------------------------------------------------------------------------- |
| `ELEMENT_SYMBOL`               | MolQL-compatible uppercase symbols indexed by atomic number (0 = unknown). |
| `atomicNumberForSymbol`        | Atomic number lookup for symbols and accepted aliases (0 = unknown).       |
| `elementSymbolForAtomicNumber` | MolQL-compatible uppercase symbol lookup (empty for unknown numbers).      |

## API

| Export                    | Stability    | Description                                                                                                                        |
| ------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `createStructure`         | stable       | Validate and copy a `StructureInput` into a frozen `StructureData` with a fresh identity.                                          |
| `withPositions`           | stable       | Replace coordinates, keeping dataset/topology identity and bumping the positions revision.                                         |
| `withAttributes`          | experimental | Add, replace or remove validated atom or residue columns while preserving structure identity.                                      |
| `attributeColumn`         | experimental | Resolve built-in and derived columns through one provenance-aware view.                                                            |
| `attributeNames`          | experimental | List resolvable column names for a structure.                                                                                      |
| `ATTRIBUTE_DOMAINS`       | experimental | Shared atom/residue domain registry for built-in and well-known columns.                                                           |
| `AttributeDomain`         | experimental | Atom or residue row domain for an attribute.                                                                                       |
| `AttributeValues`         | experimental | Supported numeric typed arrays for attribute values.                                                                               |
| `AttributeProvenance`     | experimental | Origin label for an attribute column.                                                                                              |
| `AttributeColumnInput`    | experimental | Input values, domain, kind and provenance for `withAttributes`.                                                                    |
| `AttributeColumn`         | experimental | Resolved immutable-by-contract column descriptor.                                                                                  |
| `activeAtoms`             | stable       | Atom indices for a view policy (default: first model, primary altloc conformer).                                                   |
| `residueKey`              | stable       | Namespaced, join-safe string key for one residue row.                                                                              |
| `atomRadii`               | experimental | Per-atom display radii: the `atoms.radius` column, else element van der Waals defaults (cached).                                   |
| `elementRadius`           | experimental | Van der Waals radius in Ångström for an atomic number (1.7 when unlisted).                                                         |
| `coordinateBounds`        | stable       | Untransformed min/max/center of selected atom positions, or null when empty.                                                       |
| `StructureData`           | stable       | Validated, identity-branded structure value accepted by every other package.                                                       |
| `bondTopology`            | experimental | Explicit bonds, or distance-inferred covalent bonds cached per position revision and policy.                                       |
| `spatialGrid`             | experimental | Uniform spatial hash over packed positions for neighbour queries within one cell size, optionally partitioned.                     |
| `traceTable`              | experimental | Segmented polymer trace (guide points, tangent/normal/binormal frames, runs) for a selection.                                      |
| `secondaryStructureTrace` | experimental | Per-sample direction vectors, helix/sheet/coil labels and block-boundary flags over a `Trace`.                                     |
| `SS_CODES`                | experimental | DSSP letters in `ssCode` order: 0 coil, H, B, E, G, I, T, S, P (reserved).                                                         |
| `ssKind`                  | experimental | Cartoon kind of an `ssCode` value: H/G/I helix, E/B sheet, otherwise coil.                                                         |
| `dssp`                    | experimental | Mol*-ported DSSP: `ssCode` values per residue, per chain and model; accepts optional atom rows.                                    |
| `withSecondaryStructure`  | experimental | Set `ssCode` by Mol*'s `auto`, `dssp` or `model` mode; computed codes carry `computed:dssp`.                                       |
| `StructureInput`          | experimental | Unvalidated `{ topology, positions }` input to `createStructure`.                                                                  |
| `Topology`                | experimental | The five column domains of a structure.                                                                                            |
| `Atoms`                   | experimental | Per-atom columns (names, altloc, residue FK, element, occupancy, B-factor, optional radius).                                       |
| `Residues`                | experimental | Per-residue columns (chain FK, label/author sequence, insertion code, component, polymer kind, optional SS).                       |
| `Chains`                  | experimental | Per-chain columns (model, label and author chain IDs).                                                                             |
| `Bonds`                   | experimental | Bond columns (endpoints, order, explicit/inferred provenance, optional type flags).                                                |
| `Links`                   | experimental | Type: source-declared bonds (chem_comp_bond templates, struct_conn) with type flags; add to inferred connectivity, not drawn.      |
| `BOND_FLAGS`              | experimental | Bond type bits (covalent, metallic, hydrogen, disulfide, aromatic, computed) with Mol*'s values.                                   |
| `Instances`               | experimental | Assembly rows: one chain times one column-major affine operator.                                                                   |
| `Trace`                   | experimental | Return type of `traceTable`.                                                                                                       |
| `SecondaryStructureTrace` | experimental | Return type of `secondaryStructureTrace`.                                                                                          |
| `createVolume`            | experimental | Validate and wrap a grid plus index-to-world affine as a frozen `VolumeData`; adopts `values`, computes stats.                     |
| `MAX_VOLUME_SAMPLES`      | experimental | Default `createVolume` ceiling: 256³ samples (64 MiB of scalar f32).                                                               |
| `sampleVolume`            | experimental | Trilinear sample at a world position; 0 outside the grid, clamped on its faces.                                                    |
| `sampleVolumeGradient`    | experimental | World-space gradient of `sampleVolume` by central differences; zero within a step of the grid boundary.                            |
| `volumeGradientStep`      | experimental | Default central-difference step: half the shortest grid axis.                                                                      |
| `createVolumeGrid`        | experimental | Validate a samples-free grid (dims, transform, components, unit) for a GPU-computed volume.                                        |
| `VolumeGrid`              | experimental | A volume's geometry without samples; every `VolumeData` is one.                                                                    |
| `volumeIndexToWorld`      | experimental | World position of a fractional grid index.                                                                                         |
| `volumeWorldToIndex`      | experimental | Fractional grid index of a world position.                                                                                         |
| `volumeInverseTransform`  | experimental | Cached double-precision world-to-index affine.                                                                                     |
| `volumeComponent`         | experimental | Scalar volume from one channel or the magnitude of a 3-component volume.                                                           |
| `volumeLevel`             | experimental | Absolute isovalue for `number` or `{ sigma: k }` (`mean + k * sigma`).                                                             |
| `VolumeData`              | experimental | Immutable grid: x-fastest `values`, `dims`, index-to-Å `transform`, `stats`, `components`, `unit`.                                 |
| `VolumeInput`             | experimental | Input to `createVolume`.                                                                                                           |
| `VolumeLevel`             | experimental | Absolute isovalue or `{ sigma }`.                                                                                                  |
| `createTrajectory`        | experimental | Validate and freeze a trajectory from in-memory `frames` (copied) or a streaming `source` plus `frameCount` (each read validated). |
| `validateTrajectory`      | experimental | Throw a `TypeError` unless a trajectory can move a structure (atom count, or in-range `atomMap` rows); frames are not decoded.     |
| `TrajectoryData`          | experimental | Immutable trajectory: `atomCount`, `frameCount`, per-frame `time` and `timeUnit`, optional `atomMap`, and a `FrameSource`.         |
| `TrajectoryInput`         | experimental | Input to `createTrajectory`.                                                                                                       |
| `TrajectoryFrame`         | experimental | One decoded frame: Å `positions`, optional column-major `box`, optional Å/ps `velocities`.                                         |
| `FrameSource`             | experimental | `read(index, signal?)`: decode one frame on demand, cancellable; returned arrays are never written again.                          |
| `TrajectoryTimeUnit`      | experimental | `"ps"`, `"step"` or `"index"`.                                                                                                     |

### Element identity exports

| Export                         | Stability    | Description                                                                |
| ------------------------------ | ------------ | -------------------------------------------------------------------------- |
| `ELEMENT_SYMBOL`               | experimental | MolQL-compatible uppercase symbols indexed by atomic number (0 = unknown). |
| `atomicNumberForSymbol`        | experimental | Resolve an element symbol or accepted alias to its atomic number.          |
| `elementSymbolForAtomicNumber` | experimental | Resolve an atomic number to its MolQL-compatible uppercase symbol.         |

The column schema interfaces are experimental because columns may still be
added; `StructureData` as the nominal value passed between packages is stable.
[JSR API reference](https://jsr.io/@molgpu/table/doc) lists the exported types
and signatures.

## Integration

This package has no runtime dependencies. It supplies data to
[`@molgpu/io`](https://jsr.io/@molgpu/io),
[`@molgpu/select`](https://jsr.io/@molgpu/select),
[`@molgpu/fields`](https://jsr.io/@molgpu/fields) and
[`@molgpu/viewer`](https://jsr.io/@molgpu/viewer), and can also be used without
a renderer or parser.

## Tests

From the repository root, run `deno test -A packages/table/test`. Tests cover
validation, array ownership, views, attributes, traces, volumes and
trajectories. Synthetic contract fixtures exercise edge cases; they do not
constitute an exhaustive scientific validation corpus.
