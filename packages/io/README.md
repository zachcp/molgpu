# @molgpu/io

The one place molgpu touches Mol* at runtime. `structureFromBcif` parses
BinaryCIF (mmCIF) bytes with the Mol* reader and lowers the first data block to
the owned, renderer-free columns of `@molgpu/table` (atoms, residues with
polymer kind and imported secondary structure, chains, identity instances; no
bonds). `molecularSurfaceField` computes a solvent-excluded-surface scalar grid
from plain atom columns with Mol*'s `calcMolecularSurface`. Both import Mol*
lazily inside the call, so loading this module never loads Mol*, and nothing
Mol*-typed crosses the public API: inputs and outputs are typed arrays and plain
objects, and every failure is an `IoError` with a `format` and a `code` you can
branch on.

## Install

```sh
deno add jsr:@molgpu/io jsr:@molgpu/table
```

## Dependencies

| Package         | Range    | Kind       | Notes                                                                                                                                                                                                                                               |
| --------------- | -------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@molgpu/table` | `^0.1.0` | dependency | Provides `StructureData`; compatible JSR caret ranges resolve one shared table copy.                                                                                                                                                                |
| `molstar`       | `5.12.0` | dependency | Loaded dynamically for BCIF, molecular surfaces, CCP4/MRC, text selections and XTC frame decoding. Bundlers can place these imports in lazy chunks; callers using other formats need not load them. Loader failures are reported through `IoError`. |

JSR publishes internal dependencies as caret ranges (for example,
`jsr:@molgpu/table@^0.1.0`). Keep compatible versions so the application
resolves one shared copy: identity and revision state are module-private. Values
from divergent copies can be rejected by identity-dependent operations. Use
`deno info` and the lockfile to find duplicate versions, then align the
application and package dependency ranges.

Mol* is a regular npm dependency, loaded lazily. IO pins the tested version
`5.12.0` exactly; upgrades require parser and scientific-oracle validation
before changing the published pin.

## Example

Runs as an ES module in Deno or a browser:

```js
import { IoError, molecularSurfaceField, structureFromBcif } from "@molgpu/io";

// Bytes, a Blob/File, or a URL (fetched once).
const data = await structureFromBcif("https://models.rcsb.org/1crn.bcif");
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
  if (error instanceof IoError) console.log(error.format, error.code);
} // bcif INVALID_BCIF
```

`field.values` is **x-fastest**: sample `(i, j, k)` is
`values[i + dims[0] * (j + dims[1] * k)]`, the layout `@molgpu/geo`'s
`marchingCubes` reads, so the field can be passed to it directly. Grid index
maps to Angstrom through `field.transform` (column-major; spacing on the
diagonal, origin in elements 12–14), and the surface is the `field.level`
isosurface.

`structureFromBcif(input, { assembly: "2" })` expands a biological assembly into
`topology.instances`: one row per (chain, operator) of that
`pdbx_struct_assembly`, with operator expressions expanded as Mol* does. Atoms
are never duplicated. Without `assembly`, each chain gets one identity row (the
asymmetric unit); an unknown id fails with `UNKNOWN_ASSEMBLY`.

## API

| Export                  | Stability    | Description                                                                                                                                                                                           |
| ----------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `structureFromBcif`     | stable       | Parse BinaryCIF (bytes, a `Blob`/`File`, or a URL fetched once) and lower it to a `@molgpu/table` `StructureData`.                                                                                    |
| `FileInput`             | stable       | `Uint8Array \| Blob \| string \| URL`: what `structureFromBcif` and `volumeFromCcp4` read.                                                                                                            |
| `IoError`               | stable       | Every failure this package raises, with `format` (which importer) and a stable `code`.                                                                                                                |
| `IoErrorCode`           | stable       | Union of failure codes across importers; see its doc comment for which importer raises each.                                                                                                          |
| `IoFormat`              | stable       | `"bcif" \| "ccp4" \| "pqr" \| "trajectory" \| "surface" \| "selection"`.                                                                                                                              |
| `molecularSurfaceField` | experimental | Solvent-excluded-surface scalar grid over plain atom columns, via Mol*.                                                                                                                               |
| `SurfaceFieldAtoms`     | experimental | Input atom columns: `count` and `Float32Array` `x`/`y`/`z`/`radius`.                                                                                                                                  |
| `SurfaceFieldOptions`   | experimental | `probeRadius`, `resolution` and `probePositions`.                                                                                                                                                     |
| `SurfaceField`          | experimental | `VolumeData` plus surface metadata: `resolution`, `maxRadius`, `level`.                                                                                                                               |
| `volumeFromCcp4`        | experimental | CCP4/MRC map (modes 0–2, either endianness; bytes, a `Blob`/`File`, or a URL) to a scalar `VolumeData` with Mol*'s full grid-to-Cartesian affine.                                                     |
| `parseSelection`        | experimental | Parse MolScript, PyMOL, VMD or Jmol selection text into a plain MolQL tree for `@molgpu/select`'s `compile`; `symbols` rejects anything else at parse time.                                           |
| `SelectionExpr`         | experimental | Type: a MolQL expression as plain JSON; the same shape as `@molgpu/select`'s.                                                                                                                         |
| `SelectionLanguage`     | experimental | Type: `"mol-script" \| "pymol" \| "vmd" \| "jmol"`.                                                                                                                                                   |
| `openTrajectory`        | experimental | Open a DCD/XTC/TRR trajectory for streaming from bytes, a `Blob`/`File`, a `ByteSource` or a URL (HTTP Range reads); format from an option or the name.                                               |
| `OpenTrajectoryOptions` | experimental | `format`, `maxDownload` (default 256 MiB when a server ignores Range), `velocities` (TRR), injectable `fetch` and an open-time `signal`.                                                              |
| `ByteSource`            | experimental | Random access to a file's bytes: `size` and `read(offset, length, signal?)`, for custom range readers.                                                                                                |
| `structureFromPqr`      | experimental | Read PQR text or bytes (tokenised, so PDB2PQR's widened fields parse) into a structure with `partialCharge` and raw `pqr:radius` (`imported:pqr`); zero radii display at the element radius.          |
| `applyPqr`              | experimental | Set `partialCharge` on an existing structure from PQR records matched by chain, sequence, insertion code and atom name; folds missing hydrogens onto their heavy atom and reports what did not match. |
| `PqrStructureReport`    | experimental | `atoms` and `radiusFallbacks` from `structureFromPqr`.                                                                                                                                                |
| `PqrApplyReport`        | experimental | `matched`, `unmatchedAtoms`, `unmatchedRecords` and per-model, per-altloc `residueDelta` from `applyPqr`.                                                                                             |

The surface exports are experimental while the result shape settles. The
per-format trajectory readers are internal; `openTrajectory` dispatches to them.

## Parser decisions

| Input             | Mol* reuse                                                                                            | Local adapter work                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BCIF/mmCIF        | BinaryCIF reader and mmCIF model builder supply entity, secondary-structure and connection semantics. | Lower `atom_site` into owned table columns in source order, retaining every model; map Mol* model indices back to those rows.                                   |
| CCP4/MRC          | Mol* CCP4 parser and volume builder.                                                                  | Validate bounds/modes, normalize big-endian input for Mol*'s float reader, then lower its grid to x-fastest `VolumeData`.                                       |
| XTC               | Mol* XTC decoder.                                                                                     | Index frame offsets for streaming and pass one frame at a time to the decoder.                                                                                  |
| DCD               | Mol* parser is the test oracle.                                                                       | Keep the streaming reader because Mol* reads whole files, treats variants as CHARMM, and misreads some cell encodings.                                          |
| TRR               | Mol* parser is the positions test oracle.                                                             | Keep the streaming reader because Mol* drops velocities, which this API can expose.                                                                             |
| PQR               | Mol* reader is the column-aligned comparison oracle.                                                  | Keep whitespace tokenization to accept widened PDB2PQR records and preserve both partial charge and radius; Mol*'s reader only provides the charge needed here. |
| Selections        | Mol* language parsers, transpilers and symbol table.                                                  | Normalize the result to plain JSON and check the requested symbol allow-list.                                                                                   |
| Molecular surface | Mol* `calcMolecularSurface`.                                                                          | Supply probe-inflated search radii and lower the tensor to the shared x-fastest layout.                                                                         |

The BCIF adapter retains source-row columns because the GPU table preserves atom
identity and ensemble order instead of exposing Mol*'s sorted model objects.
Model-derived semantics and all volume conversions remain plain owned values at
the package boundary.

`structureFromBcif` always sets the derived `formalCharge` attribute: the file's
`pdbx_formal_charge` values (provenance `imported:mmcif`), or zeros marked
`default` when the file has none, as Mol* reads them.

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

`io` sits directly above `table`: it depends on `@molgpu/table` and `molstar`,
and `@molgpu/viewer` loads it lazily through a dynamic import. It is the
**only** molgpu package allowed to import `molstar` at runtime, and it does so
only through dynamic `import()` inside its functions. It must not import
`@use-gpu/*`, `@molgpu/viewer`, or any other `@molgpu/*` package besides
`table`, and its type declarations must not mention Mol* or use.gpu types.

## Tests

`deno task test` from the repository root runs this package's suites, which
compare against Mol* directly; `deno task test:corpus` runs the curated
structure corpus.

Trajectory readers have no committed binary fixtures.
`test/trajectory-fixture.ts` writes DCD, XTC and TRR bytes from known
coordinates (the 2k39 NMR models), so each reader is checked against those
coordinates, within the format's precision, and against Mol*'s whole-file parse.
The XTC writer implements the xdr3dfcoord bit packing with fixed-size
small-difference runs.

## Transport and cancellation

`structureFromBcif` and `volumeFromCcp4` accept `signal` and an optional `fetch`
implementation; `openTrajectory` accepts those alongside its format and size
options. Abort is checked before and after byte reads and lazy parser loading.
Mol* parsing/model tasks receive a cooperative abort observer; synchronous
lowering cannot be interrupted mid-loop. An abort preserves the signal's reason.
Frame reads take their own signal, independent of the completed opening request.

HTTP Range reads require exact start/end/total metadata and body lengths. A
strong ETag is pinned with `If-Match`; otherwise Last-Modified is pinned with
`If-Unmodified-Since`. Changed or missing pinned validators are rejected.
Without validators, the URL must identify immutable content: total-size
validation cannot detect same-size changes. Servers ignoring Range are
downloaded once under the configured size cap. Bytes, Blobs and custom
ByteSources share the scan contract; custom implementations should honor the
read signal, and scans also check it around reads and cached blocks.
