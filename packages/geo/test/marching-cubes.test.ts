import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { marchingCubes, marchingCubesTables } from "../src/index.ts";
import { Tensor } from "molstar/lib/mol-math/linear-algebra/tensor.js";
import { computeMarchingCubesMesh } from "molstar/lib/mol-geo/util/marching-cubes/algorithm.js";

Deno.test("extracts a deterministic plane from one cube", () => {
  const mesh = marchingCubes({
    values: Float32Array.from([0, 1, 1, 1, 1, 1, 1, 1]),
    dims: [2, 2, 2],
    level: 0.5,
  });
  assertStrictEquals(mesh.vertexCount, 3);
  assertStrictEquals(mesh.triangleCount, 1);
  // Mol*'s copied triangle table fixes this winding/order.
  assertEquals([...mesh.indices], [0, 2, 1]);
  assertEquals([...mesh.positions], [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5]);
});

Deno.test("matches the pinned Mol* oracle triangle count", async () => {
  const dims: [number, number, number] = [3, 3, 3],
    values = new Float32Array(27);
  for (let z = 0; z < 3; z++) {
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        values[x + 3 * (y + 3 * z)] = x + y + z - 1.4;
      }
    }
  }
  const ours = marchingCubes({ values, dims, level: 0 });
  const space = Tensor.Space(dims, [0, 1, 2], Float32Array);
  const oracle = await computeMarchingCubesMesh({
    scalarField: Tensor.create(space, Tensor.Data1(values)),
    isoLevel: 0,
  }).run();
  assertStrictEquals(ours.triangleCount, oracle.triangleCount);
});

Deno.test("maps grid coordinates into world coordinates and validates shape", () => {
  const values = Float32Array.from([0, 1, 1, 1, 1, 1, 1, 1]);
  const mesh = marchingCubes({
    values,
    dims: [2, 2, 2],
    level: 0.5,
    origin: [10, 20, 30],
    spacing: [2, 3, 4],
  });
  assertStrictEquals(mesh.positions[0], 11);
  assertThrows(
    () => marchingCubes({ values, dims: [2, 2, 3] }),
    Error,
    "length",
  );
});

// A distance field around `center`, sampled on a grid placed by `m`.
function sphereGrid(
  m: number[],
  n = 12,
  center = [1.2, -2.1, 3.3],
  radius = 3,
) {
  const values = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = m[0] * i + m[4] * j + m[8] * k + m[12] - center[0];
        const y = m[1] * i + m[5] * j + m[9] * k + m[13] - center[1];
        const z = m[2] * i + m[6] * j + m[10] * k + m[14] - center[2];
        values[i + n * (j + n * k)] = Math.hypot(x, y, z) - radius;
      }
    }
  }
  return { values, dims: [n, n, n] as [number, number, number], center };
}

// Sign of (winding face normal · vertex normal) and of (vertex normal · radial).
function orientation(mesh: ReturnType<typeof marchingCubes>, center: number[]) {
  const { positions: p, normals: n, indices } = mesh;
  let face = 0, radial = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const f = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const avg = [0, 1, 2].map((q) => n[a + q] + n[b + q] + n[c + q]);
    face += Math.sign(f[0] * avg[0] + f[1] * avg[1] + f[2] * avg[2]);
  }
  for (let v = 0; v < p.length; v += 3) {
    radial += Math.sign(
      n[v] * (p[v] - center[0]) + n[v + 1] * (p[v + 1] - center[1]) +
        n[v + 2] * (p[v + 2] - center[2]),
    );
  }
  return {
    face: face / (indices.length / 3),
    radial: radial / (p.length / 3),
  };
}

Deno.test("a sheared or mirroring transform places vertices and orients normals in world space", () => {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -5, -8, -3, 1];
  const sheared = [
    0.9,
    0.2,
    0,
    0,
    0.3,
    1.1,
    0.1,
    0,
    0,
    -0.2,
    0.7,
    0,
    -6,
    -9,
    -1,
    1,
  ];
  // Mirror x: negative determinant.
  const mirrored = [
    -0.9,
    0,
    0,
    0,
    0.3,
    1.0,
    0,
    0,
    0,
    0.1,
    0.8,
    0,
    7,
    -8,
    -2,
    1,
  ];
  const reference = (() => {
    const g = sphereGrid(identity);
    return orientation(
      marchingCubes({ values: g.values, dims: g.dims, transform: identity }),
      g.center,
    );
  })();
  assertStrictEquals(Math.abs(reference.face), 1, "winding is consistent");
  assertStrictEquals(Math.abs(reference.radial), 1, "normals are radial");
  for (const m of [identity, sheared, mirrored]) {
    const g = sphereGrid(m);
    const mesh = marchingCubes({
      values: g.values,
      dims: g.dims,
      transform: m,
    });
    for (let v = 0; v < mesh.positions.length; v += 3) {
      const r = Math.hypot(
        mesh.positions[v] - g.center[0],
        mesh.positions[v + 1] - g.center[1],
        mesh.positions[v + 2] - g.center[2],
      );
      // Linear interpolation of a distance field lands within a cell of it.
      assert(Math.abs(r - 3) < 0.15, `vertex at radius ${r}`);
    }
    assertEquals(orientation(mesh, g.center), reference);
  }
});

Deno.test("transform excludes origin/spacing and must be an invertible affine", () => {
  const values = Float32Array.from([0, 1, 1, 1, 1, 1, 1, 1]);
  const dims: [number, number, number] = [2, 2, 2];
  const eye = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assertThrows(
    () => marchingCubes({ values, dims, transform: eye, origin: [0, 0, 0] }),
    TypeError,
    "not both",
  );
  assertThrows(
    () => marchingCubes({ values, dims, level: 0.5, transform: eye.slice(1) }),
    TypeError,
  );
  const singular = [...eye];
  singular[10] = 0;
  assertThrows(
    () => marchingCubes({ values, dims, level: 0.5, transform: singular }),
    TypeError,
    "invertible",
  );
});

Deno.test("marchingCubesTables: each configuration's triangles use exactly its cut edges", () => {
  const { edges, triangles, triangleLengths, cubeEdges } =
    marchingCubesTables();
  assertEquals(edges.length, 256);
  assertEquals(cubeEdges.length, 72);
  for (let mask = 0; mask < 256; mask++) {
    const length = triangleLengths[mask];
    assertEquals(length % 3, 0);
    let used = 0;
    for (let k = 0; k < 16; k++) {
      const edge = triangles[mask * 16 + k];
      if (k < length) used |= 1 << edge;
      else assertEquals(edge, 255);
    }
    assertEquals(used, edges[mask], `configuration ${mask}`);
  }
  // Fresh arrays per call.
  marchingCubesTables().edges[1] = 0;
  assertEquals(marchingCubesTables().edges[1], edges[1]);
});
