# @molgpu/geo

Pure molecular geometry kernels: the curve-segment math behind ribbons and
cartoons, marching-cubes isosurface extraction, and nearest-atom attribution for
surface vertices. Typed arrays and plain `[x, y, z]` vectors go in, and owned
typed arrays come out. Nothing here knows about GPUs, Live components or Mol*
data structures, so the same kernels serve the WebGPU viewer, tests, and any
future headless backend.

## Install

```sh
deno add jsr:@molgpu/geo
```

No runtime dependencies.

## Example

```js
import { marchingCubes, nearestAtomAttribution } from "@molgpu/geo";

// Signed distance to a sphere of radius 3 centred in an 8×8×8 grid.
const n = 8, values = new Float32Array(n * n * n);
for (let z = 0; z < n; z++) {
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      values[x + n * (y + n * z)] = Math.hypot(x - 3.5, y - 3.5, z - 3.5) - 3;
    }
  }
}

const mesh = marchingCubes({ values, dims: [n, n, n], level: 0 });
console.log(mesh.vertexCount, mesh.triangleCount); // 768 380

// Which of two "atoms" each surface vertex is nearest to.
const atoms = new Float32Array([2, 3.5, 3.5, 5, 3.5, 3.5]);
const owner = nearestAtomAttribution(mesh.positions, atoms, 4); // Uint32Array per vertex
```

The ribbon kernels are driven one segment at a time. See
`packages/viewer/src/internal/ribbon-geometry.mjs` for a complete caller:

```js
const state = createCurveSegmentState(linearSegments);
interpolateCurveSegment(state, controls, 0.5, 0.5); // points, tangents, normals, binormals
interpolateSizes(state, w0, w1, w2, h0, h1, h2, 0.5); // widths and heights
```

## API

| Export                    | Stability    | Description                                                                     |
| ------------------------- | ------------ | ------------------------------------------------------------------------------- |
| `marchingCubes`           | stable       | Indexed isosurface mesh from an x-major scalar grid.                            |
| `MarchingCubesInput`      | stable       | Grid, isovalue, and origin/spacing or a full index-to-world affine `transform`. |
| `MarchingCubesMesh`       | stable       | Positions, normals, indices and counts returned by `marchingCubes`.             |
| `nearestAtomAttribution`  | stable       | Exact nearest atom per vertex, with a uniform-grid fast path.                   |
| `createCurveSegmentState` | experimental | Allocate the per-segment scratch buffers.                                       |
| `interpolateCurveSegment` | experimental | Points, tangents, normals and binormals for one segment.                        |
| `interpolateSizes`        | experimental | Width and height profile along a segment.                                       |
| `CurveSegmentState`       | experimental | Scratch buffers, mutated in place by the interpolators.                         |
| `CurveSegmentControls`    | experimental | Guide points p0–p4 and end directions d12/d23 for a segment.                    |

The curve-segment kernels are experimental because they mirror Mol*'s
mutable-state calling convention. They may later be wrapped in a whole-trace
API.

## Place in the graph

`geo` sits at the bottom of the graph next to `@molgpu/table`, and
`@molgpu/viewer` consumes it. It must not import Mol* or any `@use-gpu/*`
package at runtime, and it has no dependencies at all (see `docs/DESIGN.md`).
This is what keeps it renderer-free for a future headless backend. The tests may
import Mol* as a golden-file oracle.

## Provenance

These are ports of MIT-licensed Mol* 5.11.0 code (Copyright (c) 2017 - now, Mol*
contributors). The attribution headers in each source file must be kept.

- `src/marching-cubes-tables.ts` is a mechanical copy of the lookup tables in
  `mol-geo/util/marching-cubes/tables.js`.
- `marchingCubes` in `src/index.ts` ports the inner loop of
  `mol-geo/util/marching-cubes/algorithm.js`.
- `src/curve-segment.ts` ports
  `mol-repr/structure/visual/util/polymer/curve-segment.js`.
- `src/vec3.ts` ports the needed parts of `mol-math/linear-algebra/3d/vec3.js`
  and `mol-math/interpolate.js`.
