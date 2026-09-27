// Ported from the inner loop of Mol* 5.11.0's MIT-licensed
// mol-geo/util/marching-cubes/{algorithm,tables}.js. Deliberately no Mol*
// Task/Tensor/Mesh types: this consumes a packed scalar grid and returns owned
// typed arrays suitable for any renderer.
import { CubeEdges, EdgeTable, TriTable } from "./marching-cubes-tables.ts";
import type { MarchingCubesInput, MarchingCubesMesh } from "./types.ts";

export type {
  CurveSegmentControls,
  CurveSegmentState,
  MarchingCubesInput,
  MarchingCubesMesh,
  Vec3Like,
} from "./types.ts";

export {
  createCurveSegmentState,
  interpolateCurveSegment,
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
  const { values, dims, transform } = input;
  if (
    transform !== undefined &&
    (input.origin !== undefined || input.spacing !== undefined)
  ) {
    throw new TypeError("pass either transform or origin/spacing, not both");
  }
  if (transform !== undefined) {
    const mesh = marchingCubes({ values, dims, level: input.level });
    return transformMesh(mesh, transform);
  }
  const { level = 0, origin = [0, 0, 0], spacing = [1, 1, 1] } = input;
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

/** Map an index-space mesh through a column-major 4×4 affine. */
function transformMesh(
  mesh: MarchingCubesMesh,
  m: ArrayLike<number>,
): MarchingCubesMesh {
  if (
    m.length !== 16 || !Array.prototype.every.call(m, Number.isFinite) ||
    m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1
  ) {
    throw new TypeError("transform must be 16 finite numbers, affine");
  }
  // Cofactor matrix of the linear part = det * inverse-transpose.
  const c = [
    m[5] * m[10] - m[6] * m[9],
    m[6] * m[8] - m[4] * m[10],
    m[4] * m[9] - m[5] * m[8],
    m[2] * m[9] - m[1] * m[10],
    m[0] * m[10] - m[2] * m[8],
    m[1] * m[8] - m[0] * m[9],
    m[1] * m[6] - m[2] * m[5],
    m[2] * m[4] - m[0] * m[6],
    m[0] * m[5] - m[1] * m[4],
  ];
  const det = m[0] * c[0] + m[4] * c[3] + m[8] * c[6];
  if (!(Math.abs(det) > 0)) throw new TypeError("transform must be invertible");
  // Dividing by det's sign keeps the normal on the same side of the surface.
  const s = Math.sign(det);
  const { positions: p, normals: n, indices } = mesh;
  const positions = new Float32Array(p.length);
  const normals = new Float32Array(n.length);
  for (let v = 0; v < p.length; v += 3) {
    const x = p[v], y = p[v + 1], z = p[v + 2];
    positions[v] = m[0] * x + m[4] * y + m[8] * z + m[12];
    positions[v + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    positions[v + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    const nx = n[v], ny = n[v + 1], nz = n[v + 2];
    const [ux, uy, uz] = unit(
      s * (c[0] * nx + c[3] * ny + c[6] * nz),
      s * (c[1] * nx + c[4] * ny + c[7] * nz),
      s * (c[2] * nx + c[5] * ny + c[8] * nz),
    );
    normals[v] = ux;
    normals[v + 1] = uy;
    normals[v + 2] = uz;
  }
  let out = indices;
  if (det < 0) {
    out = new Uint32Array(indices.length);
    for (let t = 0; t < indices.length; t += 3) {
      out[t] = indices[t];
      out[t + 1] = indices[t + 2];
      out[t + 2] = indices[t + 1];
    }
  }
  return { ...mesh, positions, normals, indices: out };
}
