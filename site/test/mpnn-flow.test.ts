import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { proteinMpnnGraph, type ProteinMpnnInput } from "@molgpu/nn";
import {
  edgeFeaturesOf,
  neighborsOf,
  oneHot,
} from "../src/experiments/mpnn/flow.ts";

// Four residues on a line 3.8 Å apart, with N/C/O offset from each CA.
const input: ProteinMpnnInput = {
  backbone: Float32Array.from(
    [0, 1, 2, 3].flatMap((r) => {
      const x = 3.8 * r;
      return [x - 1.2, 0.5, 0, x, 0, 0, x + 1.3, 0.4, 0, x + 1.5, 1.6, 0];
    }),
  ),
  residueIndex: Int32Array.from([0, 1, 2, 3]),
  chain: Int32Array.from([0, 0, 0, 0]),
  sequence: Uint8Array.from([0, 20, 5, 0]),
  residues: Uint32Array.from([0, 1, 2, 3]),
};

Deno.test("oneHot sets exactly the native letter of each residue", () => {
  const rows = oneHot(input.sequence);
  assertEquals(rows.length, 4 * 21);
  assertEquals([...rows.subarray(21, 42)].indexOf(1), 20);
  assertEquals(rows.reduce((a, b) => a + b, 0), 4);
  assertThrows(() => oneHot(Uint8Array.from([21])));
});

Deno.test("neighborsOf lists the graph's edges nearest first with CA distances", () => {
  const graph = proteinMpnnGraph(input, 3);
  // Residue 1: itself, then residues 0 and 2 at 3.8 Å (ties keep index order).
  const near = neighborsOf(input, graph, 1);
  assertEquals(near.map((n) => [n.position, n.rank]), [[1, 0], [0, 1], [
    2,
    2,
  ]]);
  assertAlmostEquals(near[0].distance, 0, 1e-6);
  assertAlmostEquals(near[2].distance, 3.8, 1e-5);
  assertEquals(neighborsOf(input, graph, 3).map((n) => n.position), [3, 2, 1]);
  assertThrows(() => neighborsOf(input, graph, 4));
});

Deno.test("edgeFeaturesOf returns residue i's own [K, 400] block", () => {
  const graph = proteinMpnnGraph(input, 3);
  const block = edgeFeaturesOf(graph, 2);
  assertEquals(block.length, 3 * 400);
  // The self edge's CA-CA distance is sqrt(1e-6) Å (upstream's epsilon), so
  // its first RBF (centre 2 Å, sigma 1.25) is exp(-((0.001 - 2) / 1.25)^2)
  // and the last (centre 22 Å) is ~0.
  assertAlmostEquals(block[0], Math.exp(-(((0.001 - 2) / 1.25) ** 2)), 1e-6);
  assertAlmostEquals(block[15], 0, 1e-6);
  assertEquals(block, graph.rbf.subarray(2 * 3 * 400, 3 * 3 * 400));
});
