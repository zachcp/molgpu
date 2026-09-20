# LineLayer width and depth contract

The pinned use.gpu 0.20.0 shaded-line shader computes tube radius as
`width / 2 * getWorldScale(clipW, depth)`.

- `depth: -1`: `getWorldScale` is `1`; `width` is an absolute world-space
  **diameter**. Molecular bonds should use this mode, with `width = 2 * radius`.
- `depth: 0`: width is screen-space. Its world radius grows with clip distance,
  so it is appropriate for constant-pixel overlays, not molecular geometry.
- `depth: 1`: perspective distance cancels, but radius remains normalized by
  DPR, viewport height, FOV, and camera focus. It is not an Ångström unit.

`line-size.test.mjs` pins these three cases. Existing bond/tube examples already
use shaded lines with `depth: -1`; their `width` values are now documented as
physical diameters.
