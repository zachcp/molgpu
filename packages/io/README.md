# @molgpu/io

The one place molgpu touches Mol* at runtime. `structureFromBcif` parses
BinaryCIF (mmCIF) bytes with the Mol* reader and lowers the first data block to
the owned, renderer-free columns of `@molgpu/table` (atoms, residues with
polymer kind and imported secondary structure, chains, identity instances; no
bonds). `molecularSurfaceField` computes a solvent-excluded-surface scalar grid
from plain atom columns with Mol*'s `calcMolecularSurface`. Both import Mol*
lazily inside the call, so loading this module never loads Mol*, and nothing
Mol*-typed crosses the public API: inputs and outputs are typed arrays and
plain objects, and failures are this package's own error classes with a
`code` you can branch on.

## Install

```sh
npm install @molgpu/io @molgpu/table molstar
```

## Peer dependencies

| Package | Range | Notes |
| --- | --- | --- |
| `molstar` | `^5.11.0` | Optional peer. Only needed when you call `structureFromBcif` or `molecularSurfaceField`; without it they reject with code `PARSER_UNAVAILABLE` / `FIELD_UNAVAILABLE`. |

`@molgpu/table` is a regular dependency (the `StructureData` output type).

## Example

Runs in Node as an ES module, with `1crn.bcif` from
`https://models.rcsb.org/1crn.bcif` in the working directory:

```js
import { readFile } from 'node:fs/promises';
import { structureFromBcif, molecularSurfaceField, BcifParseError } from '@molgpu/io';

const data = await structureFromBcif(new Uint8Array(await readFile('1crn.bcif')));
const { atoms, residues, chains } = data.topology;
console.log(atoms.count, residues.count, chains.count); // 327 46 1

const field = await molecularSurfaceField({
  count: atoms.count,
  x: Float32Array.from({ length: atoms.count }, (_, i) => data.positions[i * 3]),
  y: Float32Array.from({ length: atoms.count }, (_, i) => data.positions[i * 3 + 1]),
  z: Float32Array.from({ length: atoms.count }, (_, i) => data.positions[i * 3 + 2]),
  radius: atoms.radius,
}, { resolution: 1 });
console.log(field.dims, field.level); // [ 33, 28, 33 ] 1.4

try { await structureFromBcif(new Uint8Array([0, 1, 2])); }
catch (error) { if (error instanceof BcifParseError) console.log(error.code); } // INVALID_BCIF
```

`field.values` keeps Mol*'s **z-fastest** layout: sample `(i, j, k)` is
`values[k + dims[2] * (j + dims[1] * i)]`. `@molgpu/geo`'s `marchingCubes`
reads an x-fastest grid, so reorder before passing the field to it. Grid index
maps to Angstrom through `field.transform` (column-major; spacing on the
diagonal, origin in elements 12–14), and the surface is the `field.level`
isosurface.

## API

| Export | Stability | Description |
| --- | --- | --- |
| `structureFromBcif` | stable | Parse BinaryCIF bytes and lower them to a `@molgpu/table` `StructureData`. |
| `BcifParseError` | stable | Error thrown by `structureFromBcif`, with a `code: BcifErrorCode`. |
| `BcifErrorCode` | stable | Union of `structureFromBcif` failure codes. |
| `molecularSurfaceField` | experimental | Solvent-excluded-surface scalar grid over plain atom columns, via Mol*. |
| `SurfaceFieldError` | experimental | Error thrown by `molecularSurfaceField`, with a `code: SurfaceFieldErrorCode`. |
| `SurfaceFieldErrorCode` | experimental | Union of `molecularSurfaceField` failure codes. |
| `SurfaceFieldAtoms` | experimental | Input atom columns: `count` and `Float32Array` `x`/`y`/`z`/`radius`. |
| `SurfaceFieldOptions` | experimental | `probeRadius`, `resolution` and `probePositions`. |
| `SurfaceField` | experimental | Result grid: `values`, `dims`, `transform`, `resolution`, `maxRadius`, `level`. |

The surface exports are experimental because the grid layout does not yet match
what `@molgpu/geo` consumes (see above), and the result shape may change when
that is reconciled.

## Place in the dependency graph

`io` sits directly above `table`: it depends on `@molgpu/table` and the optional
peer `molstar`, and `@molgpu/viewer` loads it lazily through a dynamic import.
It is the **only** molgpu package allowed to import `molstar` at runtime, and it
does so only through dynamic `import()` inside its two functions. It must not
import `@use-gpu/*`, `@molgpu/viewer`, or any other `@molgpu/*` package besides
`table`, and its type declarations must not mention Mol* or use.gpu types.

## Tests

`npm test` from the repository root runs this package's suites, which compare
against Mol* directly; `npm run test:corpus` runs the curated structure corpus.
