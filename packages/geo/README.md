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

The ribbon kernels fill reusable buffers for one curve segment:

```ts
import {
  createCurveSegmentState,
  interpolateCurveSegment,
  interpolateSizes,
} from "@molgpu/geo";

const state = createCurveSegmentState(8); // 9 samples
const controls = {
  p0: [0, 0, 0],
  p1: [1, 0, 0],
  p2: [2, 0.5, 0],
  p3: [3, 0.5, 0],
  p4: [4, 0, 0],
  d12: [0, 0, 1],
  d23: [0, 0, 1],
  secStrucFirst: false,
  secStrucLast: false,
};
interpolateCurveSegment(state, controls, 0.5, 0.5);
interpolateSizes(state, 1, 1, 1, 0.2, 0.2, 0.2, 0.5);
console.log(state.curvePoints, state.widthValues);
```

Both interpolators mutate `state`. Copy its arrays before reusing it when a
consumer needs to retain an earlier segment. The example produces a segment
centered on `p2`, halfway toward each adjacent guide point; direction vectors
orient its cross-section.

`origin`/`spacing` are shorthand for a diagonal index-to-world affine. Normals
use its inverse transpose, and negative determinant transforms reverse triangle
winding. Both forms validate the affine before extracting geometry.

## API

| Export                    | Stability    | Description                                                                        |
| ------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `marchingCubes`           | stable       | Indexed isosurface mesh from an x-fastest scalar grid.                             |
| `MarchingCubesInput`      | stable       | Grid, isovalue, and origin/spacing or a full index-to-world affine `transform`.    |
| `MarchingCubesMesh`       | stable       | Positions, normals, indices and counts returned by `marchingCubes`.                |
| `marchingCubesTables`     | experimental | The lookup tables `marchingCubes` reads, packed flat (for example for a GPU port). |
| `MarchingCubesTables`     | experimental | Edge masks, triangle edge lists, their lengths and the cube-edge corners.          |
| `nearestAtomAttribution`  | stable       | Exact nearest atom per vertex, with a uniform-grid fast path.                      |
| `createCurveSegmentState` | experimental | Allocate the per-segment scratch buffers.                                          |
| `interpolateCurveSegment` | experimental | Points, tangents, normals and binormals for one segment.                           |
| `interpolateSizes`        | experimental | Width and height profile along a segment.                                          |
| `CurveSegmentState`       | experimental | Scratch buffers, mutated in place by the interpolators.                            |
| `CurveSegmentControls`    | experimental | Guide points p0–p4 and end directions d12/d23 for a segment.                       |

The curve-segment kernels are experimental because they mirror Mol*'s
mutable-state calling convention. They may later be wrapped in a whole-trace
API.

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
