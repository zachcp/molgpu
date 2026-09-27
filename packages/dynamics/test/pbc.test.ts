import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import type { Topology } from "@molgpu/table";
import {
  createUnwrapForest,
  minimumImage,
  PbcSearchLimitError,
  unwrapFrame,
} from "../src/index.ts";

const CUBE = Float32Array.of(10, 0, 0, 0, 10, 0, 0, 0, 10);

function topology(
  n: number,
  edges: [number, number, number][],
  models = Array<number>(n).fill(0),
  altloc = Array<string>(n).fill(""),
): Topology {
  return {
    atoms: {
      count: n,
      residue: Uint32Array.from({ length: n }, (_, i) => i),
      altloc,
    },
    residues: { chain: Uint32Array.from(models) },
    chains: { model: Int32Array.of(0, 1) },
    bonds: {
      count: edges.length,
      a: Uint32Array.from(edges, (e) => e[0]),
      b: Uint32Array.from(edges, (e) => e[1]),
      flags: Uint8Array.from(edges, (e) => e[2]),
    },
  } as unknown as Topology;
}

Deno.test("nearest Cartesian image handles a skew box that defeats fractional rounding", () => {
  const skew = Float32Array.of(10, 0, 0, 9, 1, 0, 0, 0, 10);
  const image = minimumImage([9.31, 0.49, 0], skew);
  assertAlmostEquals(image[0], 0.31, 1e-5);
  assertAlmostEquals(image[1], -0.51, 1e-5);
  assertAlmostEquals(image[2], 0, 1e-5);
  assertThrows(
    () => minimumImage([9.31, 0.49, 0], skew, 1),
    PbcSearchLimitError,
  );
});

Deno.test("nearest Cartesian image agrees with brute lattice enumeration", () => {
  const box = Float32Array.of(10, 0, 0, 9, 1, 0, 2, 1, 8);
  for (let k = 0; k < 24; k++) {
    const delta = [
      ((k * 17) % 31) - 15,
      ((k * 11) % 13) - 6,
      ((k * 7) % 19) - 9,
    ];
    const image = minimumImage(delta, box);
    const actual = Math.hypot(...image);
    let oracle = Infinity;
    for (let x = -10; x <= 10; x++) {
      for (let y = -10; y <= 10; y++) {
        for (let z = -10; z <= 10; z++) {
          oracle = Math.min(
            oracle,
            Math.hypot(
              delta[0] - 10 * x - 9 * y - 2 * z,
              delta[1] - y - z,
              delta[2] - 8 * z,
            ),
          );
        }
      }
    }
    assertAlmostEquals(actual, oracle, 1e-10);
  }
});

Deno.test("unwrap makes a repeatedly wrapped chain whole per frame", () => {
  const forest = createUnwrapForest(
    topology(5, [[0, 1, 1], [1, 2, 1], [2, 3, 1]]),
  );
  assertEquals([...forest.parent], [-1, 0, 1, 2, -1]);
  const first = Float32Array.of(8, 0, 0, 9, 0, 0, 0, 0, 0, 1, 0, 0, 1, 2, 0);
  const result = unwrapFrame(first, forest, CUBE);
  assertEquals(result.status, "ok");
  assertEquals([
    result.positions[0],
    result.positions[3],
    result.positions[6],
    result.positions[9],
    result.positions[12],
  ], [8, 9, 10, 11, 1]);
  const previous = unwrapFrame(
    Float32Array.of(7, 0, 0, 8, 0, 0, 9, 0, 0, 0, 0, 0, 1, 2, 0),
    forest,
    CUBE,
  );
  assertEquals([
    previous.positions[0],
    previous.positions[3],
    previous.positions[6],
    previous.positions[9],
  ], [7, 8, 9, 10]);
  assertEquals([...unwrapFrame(first, forest, CUBE).positions], [
    ...result.positions,
  ]);
});

Deno.test("forest excludes metallic, different-model and incompatible-altloc links", () => {
  const graph = topology(4, [[0, 1, 1], [1, 2, 2], [1, 3, 1], [0, 2, 1]], [
    0,
    0,
    0,
    1,
  ], ["A", "A", "B", "A"]);
  const forest = createUnwrapForest(graph);
  assertEquals([...forest.parent], [-1, 0, -1, -1]);
  assertEquals([...forest.roots], [0, 2, 3]);
});

Deno.test("rings report closure ambiguity; invalid and absent boxes pass through", () => {
  const forest = createUnwrapForest(
    topology(3, [[0, 1, 1], [1, 2, 1], [0, 2, 1]]),
  );
  const positions = Float32Array.of(0, 0, 0, 4, 0, 0, 8, 0, 0);
  const result = unwrapFrame(positions, forest, CUBE);
  assertEquals(result.status, "ambiguous");
  assertEquals(result.ambiguousRingEdges, 1);
  assertEquals(unwrapFrame(positions, forest, null).status, "missing-box");
  assertEquals(
    unwrapFrame(positions, forest, new Float32Array(9)).status,
    "invalid-box",
  );
});

Deno.test("centering shifts each component independently into its box", () => {
  const forest = createUnwrapForest(topology(4, [[0, 1, 1], [2, 3, 1]]));
  const positions = Float32Array.of(18, 0, 0, 19, 0, 0, -9, 0, 0, -8, 0, 0);
  const result = unwrapFrame(positions, forest, CUBE, [0, 1, 2, 3]);
  assertEquals([...result.positions.filter((_, i) => i % 3 === 0)], [
    8,
    9,
    1,
    2,
  ]);
});
