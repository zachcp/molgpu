# @molgpu/io

The one place molgpu touches Mol* at runtime. `structureFromBcif` parses
BinaryCIF (mmCIF) bytes with the Mol* reader and lowers the first data block to
the owned, renderer-free columns of `@molgpu/table` (atoms, residues with
polymer kind and imported secondary structure, chains, identity instances; no
bonds). `molecularSurfaceField` computes a solvent-excluded-surface scalar grid
from plain atom columns with Mol*'s `calcMolecularSurface`. Both import Mol*
lazily inside the call, so loading this module never loads Mol*, and nothing
Mol*-typed crosses the public API: inputs and outputs are typed arrays and plain
objects, and failures are this package's own error classes with a `code` you can
branch on.

## Install

```sh
deno add jsr:@molgpu/io jsr:@molgpu/table
```

## Dependencies

| Package         | Range     | Kind       | Notes                                                                                                                                                                                                                                                                                                                          |
| --------------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@molgpu/table` | `^0.1.0`  | peer       | Provides the `StructureData` output type; a peer so the app shares one copy (structure identity is module-private).                                                                                                                                                                                                            |
| `molstar`       | `^5.11.0` | dependency | Installed with `io`, but loaded only inside `structureFromBcif`, `molecularSurfaceField` and `volumeFromCcp4`, through dynamic `import()`. Bundlers put it in separate lazy chunks, so code that never calls them never downloads it. If it fails to load, those calls reject with `PARSER_UNAVAILABLE` / `FIELD_UNAVAILABLE`. |

Mol* was an optional peer before the move to JSR, which has no optional
dependencies. It is now a regular dependency, because the viewer needs it for
both `<Structure src>` and `<Surface>` anyway. It is still loaded lazily, as
before.

## Example

Runs in Node as an ES module, with `1crn.bcif` from
`https://models.rcsb.org/1crn.bcif` in the working directory:

```js
import { readFile } from "node:fs/promises";
import {
  BcifParseError,
  molecularSurfaceField,
  structureFromBcif,
} from "@molgpu/io";

const data = await structureFromBcif(
  new Uint8Array(await readFile("1crn.bcif")),
);
const { atoms, residues, chains } = data.topology;
console.log(atoms.count, residues.count, chains.count); // 327 46 1

const field = await molecularSurfaceField({
  count: atoms.count,
  x: Float32Array.from(
    { length: atoms.count },
    (_, i) => data.positions[i * 3],
  ),
  y: Float32Array.from(
    { length: atoms.count },
    (_, i) => data.positions[i * 3 + 1],
  ),
  z: Float32Array.from(
    { length: atoms.count },
    (_, i) => data.positions[i * 3 + 2],
  ),
  radius: atoms.radius,
}, { resolution: 1 });
console.log(field.dims, field.level); // [ 33, 28, 33 ] 1.4

try {
  await structureFromBcif(new Uint8Array([0, 1, 2]));
} catch (error) {
  if (error instanceof BcifParseError) console.log(error.code);
} // INVALID_BCIF
```

`field.values` is **x-fastest**: sample `(i, j, k)` is
`values[i + dims[0] * (j + dims[1] * k)]`, the layout `@molgpu/geo`'s
`marchingCubes` reads, so the field can be passed to it directly. Grid index
maps to Angstrom through `field.transform` (column-major; spacing on the
diagonal, origin in elements 12–14), and the surface is the `field.level`
isosurface.

## API

| Export                  | Stability    | Description                                                                                                     |
| ----------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `structureFromBcif`     | stable       | Parse BinaryCIF bytes and lower them to a `@molgpu/table` `StructureData`.                                      |
| `BcifParseError`        | stable       | Error thrown by `structureFromBcif`, with a `code: BcifErrorCode`.                                              |
| `BcifErrorCode`         | stable       | Union of `structureFromBcif` failure codes.                                                                     |
| `molecularSurfaceField` | experimental | Solvent-excluded-surface scalar grid over plain atom columns, via Mol*.                                         |
| `SurfaceFieldError`     | experimental | Error thrown by `molecularSurfaceField`, with a `code: SurfaceFieldErrorCode`.                                  |
| `SurfaceFieldErrorCode` | experimental | Union of `molecularSurfaceField` failure codes.                                                                 |
| `SurfaceFieldAtoms`     | experimental | Input atom columns: `count` and `Float32Array` `x`/`y`/`z`/`radius`.                                            |
| `SurfaceFieldOptions`   | experimental | `probeRadius`, `resolution` and `probePositions`.                                                               |
| `SurfaceField`          | experimental | `VolumeData` plus surface metadata: `resolution`, `maxRadius`, `level`.                                         |
| `volumeFromCcp4`        | experimental | CCP4/MRC map (modes 0–2, either endianness) to a scalar `VolumeData` with Mol*'s full grid-to-Cartesian affine. |
| `VolumeParseError`      | experimental | Error thrown by `volumeFromCcp4`, with a `code: VolumeErrorCode`.                                               |
| `VolumeErrorCode`       | experimental | Union of `volumeFromCcp4` failure codes, including `VOLUME_TOO_LARGE`.                                          |
| `parseSelection`        | experimental | Parse MolScript, PyMOL, VMD or Jmol selection text into a plain MolQL tree for `@molgpu/select`'s `compile`.    |
| `SelectionParseError`   | experimental | Error thrown by `parseSelection`, with the `language` and `text` that failed.                                   |
| `SelectionExpr`         | experimental | Type: a MolQL expression as plain JSON; the same shape as `@molgpu/select`'s.                                   |
| `SelectionLanguage`     | experimental | Type: `"mol-script" \| "pymol" \| "vmd" \| "jmol"`.                                                             |
| `ParseSelectionOptions` | experimental | `symbols`: reject any symbol outside this list at parse time, e.g. `supportedSymbols`.                          |

The surface exports are experimental while the result shape settles.

`parseSelection` uses only Mol*'s selection parsers (none of its structure
model) and returns plain JSON. It does not fill argument defaults, because Mol*
branches on whether some arguments are present. Evaluation happens in
`@molgpu/select`:

```js
import { parseSelection } from "@molgpu/io";
import { compile, resolve, supportedSymbols } from "@molgpu/select";

const expr = await parseSelection("pymol", "byres resn HEM around 4", {
  symbols: supportedSymbols,
});
const pocket = resolve(compile(expr), structure);
```

## Place in the dependency graph

`io` sits directly above `table`: it depends on `@molgpu/table` (a peer) and
`molstar`, and `@molgpu/viewer` loads it lazily through a dynamic import. It is
the **only** molgpu package allowed to import `molstar` at runtime, and it does
so only through dynamic `import()` inside its functions. It must not import
`@use-gpu/*`, `@molgpu/viewer`, or any other `@molgpu/*` package besides
`table`, and its type declarations must not mention Mol* or use.gpu types.

## Tests

`deno task test` from the repository root runs this package's suites, which
compare against Mol* directly; `deno task test:corpus` runs the curated
structure corpus.
