# Moving-surface cost of the CPU Surface pipeline

Date: 2026-10-02. Baseline: `bae7ba6`. Bead: `molgpu-sept-t1s`. Benchmark:
`deno run -A packages/viewer/test/surface-bench.ts` (Apple silicon, Deno 2.9).

## Method

`<Surface>` rebuilds its mesh for every coordinate generation: gather atoms,
compute Mol*'s SES field (probe 1.4 Å, resolution 0.5 Å), extract a marching
cubes mesh, and attribute each vertex to its nearest atom. The benchmark runs
each stage and the whole `buildSurfaceGeometry` call on six warm frames,
jittered by ±0.1 Å as a trajectory would publish them, and reports medians plus
grid and mesh memory.

## Before

| Protein |  Atoms | Vertices |  Field |   Mesh | Attribution |  Total |     Grid |     Mesh |
| ------- | -----: | -------: | -----: | -----: | ----------: | -----: | -------: | -------: |
| 1crn    |    327 |      55k |  48 ms |  16 ms |      446 ms | 510 ms |  0.8 MiB |  1.8 MiB |
| 1ejg    |    641 |      55k |  93 ms |  16 ms |      468 ms | 579 ms |  0.9 MiB |  1.8 MiB |
| 1tqn    |  3,999 |     499k | 543 ms | 176 ms |    4,841 ms |  5.6 s |  8.2 MiB | 16.2 MiB |
| 1a4y    |  8,939 |   1,109k | 1.23 s | 385 ms |   10,856 ms | 12.6 s | 18.1 MiB |   36 MiB |
| 4c7r    | 12,208 |   1,549k | 1.70 s | 574 ms |   15,116 ms | 17.5 s | 33.1 MiB | 50.2 MiB |

Attribution took about 88% of every rebuild: about 10 µs per vertex for a
nearest-atom lookup. Its grid was a `Map` keyed by freshly built strings, with
125 lookups, array spreads and tuple allocations per vertex.

## Fix

`@molgpu/geo` `nearestAtomAttribution` now uses a dense integer cell grid in CSR
form. It visits cells and atoms in the same order and keeps the same
certification and exhaustive fallback, so results are identical apart from exact
distance ties. Widely scattered atoms double the effective cell size until the
grid fits within max(8 × atoms, 2²⁰) cells, which bounds memory. The certificate
uses that size, so results stay exact. The surface and EField browser suites
report the same pixel counts and complementarity means as before.

## After

| Protein |  Atoms |  Field |   Mesh | Attribution |  Total | Speedup |
| ------- | -----: | -----: | -----: | ----------: | -----: | ------: |
| 1crn    |    327 |  48 ms |  16 ms |       33 ms |  97 ms |    5.3× |
| 1ejg    |    641 |  94 ms |  17 ms |       42 ms | 155 ms |    3.7× |
| 1tqn    |  3,999 | 538 ms | 165 ms |      436 ms | 1.15 s |    4.8× |
| 1a4y    |  8,939 | 1.24 s | 378 ms |      934 ms | 2.59 s |    4.9× |
| 4c7r    | 12,208 | 1.69 s | 565 ms |    1,307 ms | 3.64 s |    4.8× |

## Decision

Keep the CPU path, now about 5× faster. It is interactive (around 10 Hz) for
small proteins and is the static and reference path. It does not make moving
surfaces above roughly 1k atoms interactive: about 1 Hz at 4k atoms, with the
SES field now the largest stage. A GPU field, mesh and attribution path is
therefore still justified for live coordinates. It is scoped as
`molgpu-sept-mqo` with a 100 ms target for 1tqn, and keeps this benchmark as its
baseline.
