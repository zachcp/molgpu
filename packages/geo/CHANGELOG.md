# Changelog

All notable changes to `@molgpu/geo` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[docs/RELEASING.md](../../docs/RELEASING.md) for the procedure.

## [Unreleased]

- Source is TypeScript (`src/*.ts`); the hand-written `index.d.ts` is gone.
  The public API is unchanged.

First public release (0.1.0). APIs marked *experimental* in the README may still change
in 0.x minor releases.

- Pure geometry kernels ported from Mol* 5.11.0: curve segments for tubes and cartoons, marching cubes and nearest-atom surface attribution. Has no dependencies.
- `LICENSE` includes the Mol* MIT notice for the ported code.
