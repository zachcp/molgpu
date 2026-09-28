# molgpu

Molecular visualization on WebGPU, built as small ESM packages. At the bottom
are plain-data tables and kernels; at the top are [use.gpu](https://usegpu.live)
Live components.

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

Each package has a `CHANGELOG.md` next to its README.

## Docs and examples

- [Project site](site/README.md): the landing page and maintained WebGPU
  demonstrations.
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
deno task test:gpu             # run viewer WebGPU suites in Chrome
```

MIT licensed; see [LICENSE](LICENSE). `geo`, `io` and `table` contain code
ported from [Mol*](https://github.com/molstar/molstar) under its MIT license
(see each package's `LICENSE`).
