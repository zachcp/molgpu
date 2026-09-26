// Ported from the inner loop of Mol* 5.11.0's MIT-licensed
// mol-geo/util/marching-cubes/{algorithm,tables}.js. Deliberately no Mol*
// Task/Tensor/Mesh types: this consumes a packed scalar grid and returns owned
// typed arrays suitable for any renderer.
import { CubeEdges, EdgeTable, TriTable } from "./marching-cubes-tables.ts";
import type { MarchingCubesInput, MarchingCubesMesh } from "./types.ts";

export type * from "./types.ts";

export {
  createCurveSegmentState,
  interpolateCurveSegment,
  interpolateNormals,
  interpolatePointsAndTangents,
  interpolateSizes,
} from "./curve-segment.ts";

export { nearestAtomAttribution } from "./attribution.ts";

const offset = (
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
): number => x + nx * (y + ny * z);

function unit(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/**
 * Extract an isosurface from an x-major scalar grid.
 *
 * `origin` and `spacing` map grid coordinates to world coordinates. Vertices
 * are intentionally not shared across cells in this first portable builder;
 * that keeps ownership simple and produces valid indexed triangle geometry.
 */
export function marchingCubes(input: MarchingCubesInput): MarchingCubesMesh {
  const { values, dims, level = 0, origin = [0, 0, 0], spacing = [1, 1, 1] } =
    input;
  if (!(values instanceof Float32Array)) {
    throw new TypeError("values must be a Float32Array");
  }
  if (
    !Array.isArray(dims) || dims.length !== 3 ||
    dims.some((n) => !Number.isInteger(n) || n < 2)
  ) {
    throw new TypeError("dims must contain three integers of at least 2");
  }
  const [nx, ny, nz] = dims;
  if (values.length !== nx * ny * nz) {
    throw new RangeError("values length does not match dims");
  }
  if (
    !Number.isFinite(level) || !origin.every(Number.isFinite) ||
    !spacing.every((v) => Number.isFinite(v) && v !== 0)
  ) {
    throw new TypeError("level, origin, and spacing must be finite");
  }

  const positions: number[] = [],
    normals: number[] = [],
    indices: number[] = [];
  const valueAt = (x: number, y: number, z: number): number =>
    values[offset(x, y, z, nx, ny)];
  const gradient = (
    x: number,
    y: number,
    z: number,
  ): [number, number, number] => [
    valueAt(Math.max(0, x - 1), y, z) - valueAt(Math.min(nx - 1, x + 1), y, z),
    valueAt(x, Math.max(0, y - 1), z) - valueAt(x, Math.min(ny - 1, y + 1), z),
    valueAt(x, y, Math.max(0, z - 1)) - valueAt(x, y, Math.min(nz - 1, z + 1)),
  ];

  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        const corner = [
          valueAt(x, y, z),
          valueAt(x + 1, y, z),
          valueAt(x + 1, y + 1, z),
          valueAt(x, y + 1, z),
          valueAt(x, y, z + 1),
          valueAt(x + 1, y, z + 1),
          valueAt(x + 1, y + 1, z + 1),
          valueAt(x, y + 1, z + 1),
        ];
        let mask = 0;
        for (let i = 0; i < 8; i++) if (corner[i] < level) mask |= 1 << i;
        if (mask === 0 || mask === 255) {
          continue;
        }
        const vertices = new Int32Array(12).fill(-1);
        const addEdge = (edge: number): number => {
          if (vertices[edge] >= 0) return vertices[edge];
          const { a, b } = CubeEdges[edge];
          const ax = x + a.i, ay = y + a.j, az = z + a.k;
          const bx = x + b.i, by = y + b.j, bz = z + b.k;
          const va = valueAt(ax, ay, az), vb = valueAt(bx, by, bz);
          const t = va === vb ? 0.5 : (level - va) / (vb - va);
          const ga = gradient(ax, ay, az), gb = gradient(bx, by, bz);
          const [gx, gy, gz] = unit(
            ga[0] + t * (gb[0] - ga[0]),
            ga[1] + t * (gb[1] - ga[1]),
            ga[2] + t * (gb[2] - ga[2]),
          );
          const id = positions.length / 3;
          positions.push(
            origin[0] + (ax + t * (bx - ax)) * spacing[0],
            origin[1] + (ay + t * (by - ay)) * spacing[1],
            origin[2] + (az + t * (bz - az)) * spacing[2],
          );
          normals.push(gx, gy, gz);
          return vertices[edge] = id;
        };
        const edgeMask = EdgeTable[mask];
        for (let edge = 0; edge < 12; edge++) {
          if (edgeMask & (1 << edge)) addEdge(edge);
        }
        for (const triangle of TriTable[mask]) indices.push(vertices[triangle]);
      }
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}
