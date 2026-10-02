// Ported from the inner loop of Mol* 5.11.0's MIT-licensed
// mol-geo/util/marching-cubes/{algorithm,tables}.js. Deliberately no Mol*
// Task/Tensor/Mesh types: this consumes a packed scalar grid and returns owned
// typed arrays suitable for any renderer.
import { CubeEdges, EdgeTable, TriTable } from "./marching-cubes-tables.ts";
import type {
  MarchingCubesInput,
  MarchingCubesMesh,
  MarchingCubesTables,
} from "./types.ts";

export type {
  CurveSegmentControls,
  CurveSegmentState,
  MarchingCubesInput,
  MarchingCubesMesh,
  MarchingCubesTables,
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
    !Number.isFinite(level) || origin.length !== 3 || spacing.length !== 3 ||
    !Array.from(origin).every(Number.isFinite) ||
    !Array.from(spacing).every((v) => Number.isFinite(v) && v !== 0)
  ) {
    throw new TypeError("level, origin, and spacing must be finite");
  }

  // Validate before visiting cells or allocating geometry. Both forms use the
  // same inverse-transpose normals and reflection winding rules.
  const plan = transform !== undefined || input.origin !== undefined ||
      input.spacing !== undefined
    ? prepareTransform(
      transform ?? [
        spacing[0],
        0,
        0,
        0,
        0,
        spacing[1],
        0,
        0,
        0,
        0,
        spacing[2],
        0,
        origin[0],
        origin[1],
        origin[2],
        1,
      ],
    )
    : null;
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
            ax + t * (bx - ax),
            ay + t * (by - ay),
            az + t * (bz - az),
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
  const mesh = {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
  return plan ? transformMesh(mesh, plan) : mesh;
}

/**
 * The tables `marchingCubes` reads, packed flat. Corner `i` of a cube is
 * set when its value is below the level, in the corner order (0,0,0),
 * (1,0,0), (1,1,0), (0,1,0), then the same at k = 1; a cut cube emits one
 * vertex per set edge in edge order and its `triangles` slots index those
 * edges.
 */
export function marchingCubesTables(): MarchingCubesTables {
  const triangles = new Uint8Array(256 * 16).fill(255);
  const triangleLengths = new Uint8Array(256);
  TriTable.forEach((list, mask) => {
    triangles.set(list, mask * 16);
    triangleLengths[mask] = list.length;
  });
  const cubeEdges = new Uint8Array(12 * 6);
  CubeEdges.forEach(({ a, b }, e) =>
    cubeEdges.set([a.i, a.j, a.k, b.i, b.j, b.k], e * 6)
  );
  return {
    edges: Uint16Array.from(EdgeTable),
    triangles,
    triangleLengths,
    cubeEdges,
  };
}

/** Map an index-space mesh through a column-major 4×4 affine. */
function prepareTransform(m: ArrayLike<number>) {
  if (
    m.length !== 16 || !Array.from(m).every(Number.isFinite) ||
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
  if (
    !Number.isFinite(det) || !c.every(Number.isFinite) || !(Math.abs(det) > 0)
  ) throw new TypeError("transform must be invertible");
  return { m, c, det };
}

function transformMesh(
  mesh: MarchingCubesMesh,
  { m, c, det }: ReturnType<typeof prepareTransform>,
): MarchingCubesMesh {
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
