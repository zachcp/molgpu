# @molgpu/io

Read molecular structures, trajectories and volume maps into plain data for
`@molgpu/table`. Supported inputs are BinaryCIF (BCIF), PQR, DCD, XTC, TRR and
CCP4/MRC. The package also parses selection text and computes molecular surface
grids. It works without a renderer.

Mol* is loaded on demand for the operations that use it. Public inputs and
outputs are typed arrays and plain objects. Import failures use `IoError` with
`format` and `code`; cancellation preserves the abort signal's reason.

## Install

```sh
deno add jsr:@molgpu/io jsr:@molgpu/table
```

## Dependencies

| Package         | Range               | Kind       | Notes                                                                                                                                                                                                                                               |
| --------------- | ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@molgpu/table` | caret, same release | dependency | Provides `StructureData`; compatible JSR caret ranges resolve one shared table copy.                                                                                                                                                                |
| `molstar`       | `5.12.0`            | dependency | Loaded dynamically for BCIF, molecular surfaces, CCP4/MRC, text selections and XTC frame decoding. Bundlers can place these imports in lazy chunks; callers using other formats need not load them. Loader failures are reported through `IoError`. |

Keep all `@molgpu/*` packages on compatible versions so the application resolves
one shared `@molgpu/table`; see
[one shared table copy](https://jsr.io/@molgpu/table#one-shared-table-copy).

Mol* is a regular npm dependency, loaded lazily. IO pins the tested version
`5.12.0` exactly; upgrades require parser and scientific-oracle validation
before changing the published pin.

## Example

After `deno add`, run this as a Deno module with network permission
(`deno run --allow-net example.ts`). Browser applications need a bundler or
import map that resolves the same package names:

```js
import { IoError, molecularSurfaceField, structureFromBcif } from "@molgpu/io";
import { atomRadii } from "@molgpu/table";

// Bytes, a Blob/File, or a URL (fetched once).
const data = await structureFromBcif("https://models.rcsb.org/1crn.bcif");
const { atoms, residues, chains } = data.topology;
console.log(atoms.count, residues.count, chains.count);

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
  radius: atomRadii(data),
}, { resolution: 1 });
console.log(field.dims, field.level); // grid dimensions and surface isovalue

try {
  await structureFromBcif(new Uint8Array([0, 1, 2]));
} catch (error) {
  if (error instanceof IoError) console.log(error.format, error.code);
} // bcif INVALID_BCIF
```

Surface inputs require finite coordinates and positive finite radii. Options
follow the pinned Mol* numeric ranges: `probeRadius` 0–10 Å, `resolution`
0.01–20 Å, and integer `probePositions` 12–90. Invalid inputs/options raise
`IoError` with `format: "surface"` and `code: "INVALID_INPUT"` before Mol*
loads. `maxSamples` defaults to 256³ (16,777,216), bounding the predicted scalar
grid before Mol* allocation. Oversized grids raise `VOLUME_TOO_LARGE`; a larger
positive safe-integer `maxSamples` explicitly raises the cap. Infinity is
rejected. This caps samples, not total memory: Mol* also allocates an ID grid,
lookup data and temporary arrays, and lowering allocates the output grid.

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
| `IoError`               | stable       | Import failures, with `format` and a stable `code`; cancellation preserves the abort reason.                                                                                                          |
| `IoErrorCode`           | stable       | Union of failure codes across importers; see its doc comment for which importer raises each.                                                                                                          |
| `IoFormat`              | stable       | `"bcif" \| "ccp4" \| "pqr" \| "trajectory" \| "surface" \| "selection"`.                                                                                                                              |
| `molecularSurfaceField` | experimental | Solvent-excluded-surface scalar grid over plain atom columns, via Mol*.                                                                                                                               |
| `SurfaceFieldAtoms`     | experimental | Input atom columns: `count` and `Float32Array` `x`/`y`/`z`/`radius`.                                                                                                                                  |
| `SurfaceFieldOptions`   | experimental | `probeRadius`, `resolution`, `probePositions` and preflight `maxSamples`.                                                                                                                             |
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

## Structure and selection details

BCIF import preserves source atom order and all models. It imports component
bond templates and explicit connections; it does not infer all missing bonds
from distances. Secondary-structure annotations are available as the `ssCode`
attribute. Coordinates use Ångström units.

`structureFromBcif` always sets the derived `formalCharge` attribute: the file's
`pdbx_formal_charge` values (provenance `imported:mmcif`), or zeros marked
`default` when the file has none, as Mol* reads them.

`parseSelection` uses only Mol*'s selection parsers (none of its structure
model) and returns plain JSON. It does not fill argument defaults, because Mol*
branches on whether some arguments are present. Evaluation happens in
`@molgpu/select`:

```js
import { parseSelection, structureFromBcif } from "@molgpu/io";
import { compile, resolve, supportedSymbols } from "@molgpu/select";

const structure = await structureFromBcif("https://models.rcsb.org/1crn.bcif");
const expr = await parseSelection("pymol", "chain A and resi 1-5", {
  symbols: supportedSymbols,
});
const selected = resolve(compile(expr), structure);
console.log(selected.indices); // atom rows in chain A, residues 1–5
```

## Read a trajectory

```ts
import { openTrajectory } from "@molgpu/io";

const trajectory = await openTrajectory("https://example.org/run.xtc");
const frame = await trajectory.source.read(0);
console.log(trajectory.atomCount, trajectory.frameCount, trajectory.timeUnit);
console.log(frame.positions); // packed xyz coordinates in Ångström
```

Replace the example URL with your trajectory. For bytes or a `Blob` without a
filename, pass `{ format: "xtc" }` (or `"dcd"` / `"trr"`). Opening indexes frame
headers; `source.read(index, signal?)` decodes frames on demand. Topology comes
from a separate structure and must match the trajectory's atom order. For a
subset trajectory, call `createTrajectory` from `@molgpu/table` with the opened
trajectory's `atomCount`, `frameCount`, `source`, `time` and `timeUnit`, plus
`atomMap`: entry `i` is the structure atom row moved by trajectory atom `i`.
Unmapped structure rows retain their upstream positions. Times use the reported
`timeUnit`; TRR velocities are available in Å/ps when opening with
`{ velocities: true }`.

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

`maxDownload` must be a finite nonnegative safe integer in bytes; invalid values
fail before transport. Zero permits only an empty whole-file response (Range
reads remain available). Infinity is rejected; raise the finite cap explicitly
when a larger whole-file fallback is needed. The cap includes chunked responses
and accepts a body whose size equals the cap.
