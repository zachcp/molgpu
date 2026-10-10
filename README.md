# molgpu

Molecular visualization on WebGPU, built as small ESM packages. Use the data
packages for loading, selection and scientific calculations, or compose
[use.gpu](https://usegpu.live) Live components to draw a molecular scene. The
viewer runs in a browser with WebGPU; your application supplies the canvas,
device, camera, lights and render passes.

## Get started

All eight packages are available on
[JSR](https://jsr.io/packages?search=molgpu). For a data-only workflow, install
the loader and selection packages:

```sh
deno add jsr:@molgpu/io jsr:@molgpu/select
```

```ts
import { structureFromBcif } from "@molgpu/io";
import { comp, resolve } from "@molgpu/select";

const data = await structureFromBcif("https://models.rcsb.org/1crn.bcif");
const cysteines = resolve(comp(["CYS"]), data);
console.log(data.topology.atoms.count, cysteines.indices.length);
```

Save this as `example.ts` and run `deno run --allow-net example.ts`. For
rendering, start with the
[viewer setup and scene example](packages/viewer/README.md). Use the same
use.gpu version as the viewer (`0.20.0`) throughout your application.

## Packages

| Package                                           | What it is                                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [`@molgpu/table`](packages/table/README.md)       | Validated columnar structures, identities, view policies, bonds and polymer traces.                |
| [`@molgpu/select`](packages/select/README.md)     | Selection queries, resolution, set operations and domain conversions.                              |
| [`@molgpu/fields`](packages/fields/README.md)     | Typed per-row colour/scalar/label fields with CPU and WGSL evaluators.                             |
| [`@molgpu/io`](packages/io/README.md)             | Import BinaryCIF, DCD/XTC/TRR, CCP4/MRC and PQR into plain molecular data.                         |
| [`@molgpu/geo`](packages/geo/README.md)           | Geometry kernels: curve segments, marching cubes, surface attribution.                             |
| [`@molgpu/timeline`](packages/timeline/README.md) | Scrubbable time values: named beats and keyframe curves.                                           |
| [`@molgpu/dynamics`](packages/dynamics/README.md) | Coordinate transforms, secondary structure, charges, and dynamics kernels.                         |
| [`@molgpu/viewer`](packages/viewer/README.md)     | use.gpu components: structures, representations, materials, lights, picking, annotations, cameras. |

The table links open local guides; the
[JSR package pages](https://jsr.io/packages?search=molgpu) also provide
generated API documentation. Each package has a `CHANGELOG.md` next to its
README.

## Contributor docs and examples

- [Single-file no-build viewer](examples/README.md).
- [Project site](site/README.md): the landing page and maintained WebGPU
  demonstrations.
- [Current architecture and reading guide](docs/ARCHITECTURE.md).
- [Design](docs/DESIGN.md), [roadmap](docs/ROADMAP.md) and
  [hardening criteria](docs/HARDENING.md).
- [Releasing](docs/RELEASING.md): versioning, changelogs and the publish
  dry-run.
- [Findings](docs/findings/): dated investigation notes.

## Development

Lint covers package source, tests, browser harnesses and the site. Playwright
page callbacks use `globalThis` for browser globals so the harnesses stay in
Deno's regular lint scope.

```bash
deno task fmt                  # verify Deno formatting
deno task lint                 # lint package source, tests, browser harnesses and site
deno task test                 # type-checked unit tests
deno task typecheck            # check package source and tests
deno task check:hardening      # per-package manifest/types/API checks
deno task test:components      # typed consumer in Chrome WebGPU
deno task test:site            # check the project site in Chrome
deno task test:gpu             # run run-browser.mjs; other GPU suites have separate tasks
```

MIT licensed; see [LICENSE](LICENSE). `geo`, `io` and `table` contain code
ported from [Mol*](https://github.com/molstar/molstar) under its MIT license
(see each package's `LICENSE`).
