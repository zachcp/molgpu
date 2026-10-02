# Changelog

All notable changes to `@molgpu/geo` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- `nearestAtomAttribution` is 11–14× faster: a dense CSR cell grid replaces
  per-vertex string-keyed map lookups. Results are unchanged (same search order
  and certificate); widely scattered atoms widen the grid's cells to bound its
  memory.

- Keep the composed `interpolateCurveSegment` API and remove its low-level
  interpolation helpers from the package entry.
- `marchingCubes` accepts a full index-to-world affine `transform` in place of
  `origin`/`spacing`. Normals map through the inverse transpose, and a mirroring
  affine keeps triangle winding consistent.
- Source is TypeScript (`src/*.ts`); the hand-written `index.d.ts` is gone. The
  public API is unchanged.

First public release (0.1.0). APIs marked _experimental_ in the README may still
change in 0.x minor releases.

- Pure geometry kernels ported from Mol* 5.11.0: curve segments for tubes and
  cartoons, marching cubes and nearest-atom surface attribution. Has no
  dependencies.
- `LICENSE` includes the Mol* MIT notice for the ported code.
