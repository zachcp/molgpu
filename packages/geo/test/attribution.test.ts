import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { nearestAtomAttribution } from "../src/index.ts";

Deno.test("assigns each vertex to its nearest atom within the local cell window", () => {
  const atoms = Float32Array.from([0, 0, 0, 10, 0, 0, 20, 0, 0]);
  const vertices = Float32Array.from([
    0.5,
    0,
    0,
    9.6,
    0,
    0,
    19.9,
    0,
    0,
    5,
    0,
    0,
  ]);
  const result = nearestAtomAttribution(vertices, atoms, 2);
  assertEquals([...result], [0, 1, 2, 0]); // v3 at x=5 is equidistant-ish but closer to atom 0
});

Deno.test("falls back to a full scan when a vertex has no atoms in its local window", () => {
  const atoms = Float32Array.from([0, 0, 0, 1000, 0, 0]);
  const vertices = Float32Array.from([500, 0, 0]); // far from both atoms' cells, still closer to neither locally
  const result = nearestAtomAttribution(vertices, atoms, 1);
  assertEquals([...result], [0]); // 500 is equidistant; ties resolve to the first encountered (atom 0)
});

Deno.test("matches brute force on a random cloud", () => {
  let seed = 42;
  const rand = () =>
    (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const atomCount = 40, vertexCount = 60;
  const atoms = Float32Array.from(
    { length: atomCount * 3 },
    () => rand() * 20 - 10,
  );
  const vertices = Float32Array.from(
    { length: vertexCount * 3 },
    () => rand() * 20 - 10,
  );
  const result = nearestAtomAttribution(vertices, atoms, 3);
  for (let v = 0; v < vertexCount; v++) {
    let best = -1, bestDist = Infinity;
    for (let a = 0; a < atomCount; a++) {
      const dx = vertices[v * 3] - atoms[a * 3],
        dy = vertices[v * 3 + 1] - atoms[a * 3 + 1],
        dz = vertices[v * 3 + 2] - atoms[a * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = a;
      }
    }
    assertStrictEquals(result[v], best, `vertex ${v} mismatched brute force`);
  }
});

Deno.test("rejects malformed inputs", () => {
  assertThrows(
    () => nearestAtomAttribution(new Float32Array(2), new Float32Array(3), 1),
    Error,
    "positions",
  );
  assertThrows(
    () => nearestAtomAttribution(new Float32Array(3), new Float32Array(2), 1),
    Error,
    "atomPositions",
  );
  assertThrows(
    () => nearestAtomAttribution(new Float32Array(3), new Float32Array(), 1),
    Error,
    "at least one atom",
  );
  assertThrows(
    () => nearestAtomAttribution(new Float32Array(3), new Float32Array(3), 0),
    Error,
    "cellSize",
  );
  assertThrows(
    () => nearestAtomAttribution(new Float32Array(3), new Float32Array(3), -1),
    Error,
    "cellSize",
  );
});
