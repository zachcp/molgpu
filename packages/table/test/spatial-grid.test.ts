import { assertEquals, assertThrows } from "@std/assert";
import { bondTopology, createStructure, spatialGrid } from "../src/index.ts";

const IDENTITY = new Float64Array([
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
]);

/** One chain, one residue per atom, all in model 1 unless `models` says otherwise. */
const atomsAt = (
  positions: number[],
  element: number[],
  models: number[] = element.map(() => 1),
) => {
  const n = element.length, chainModels = [...new Set(models)];
  return createStructure({
    positions: Float32Array.from(positions),
    topology: {
      atoms: {
        count: n,
        id: element.map((_, i) => String(i)),
        name: element.map(() => "X"),
        altloc: element.map(() => ""),
        residue: Uint32Array.from(element, (_, i) => i),
        element: Uint8Array.from(element),
        occupancy: new Float32Array(n).fill(1),
        bfactor: new Float32Array(n),
      },
      residues: {
        count: n,
        chain: Uint32Array.from(models, (m) => chainModels.indexOf(m)),
        labelSeq: Int32Array.from(element, (_, i) => i + 1),
        authSeq: element.map((_, i) => String(i + 1)),
        insertionCode: element.map(() => ""),
        comp: element.map(() => "UNK"),
        polymer: element.map(() => "other" as const),
      },
      chains: {
        count: chainModels.length,
        model: Int32Array.from(chainModels),
        labelId: chainModels.map(() => "A"),
        authId: chainModels.map(() => "A"),
      },
      bonds: {
        count: 0,
        a: new Uint32Array(),
        b: new Uint32Array(),
        order: new Uint8Array(),
        source: [],
      },
      instances: {
        count: 1,
        chain: Uint32Array.of(0),
        operatorId: ["1"],
        transform: IDENTITY,
      },
    },
  });
};

const visited = (
  grid: ReturnType<typeof spatialGrid>,
  point: number[],
  partition?: number,
) => {
  const rows: number[] = [];
  grid.near(point[0], point[1], point[2], (r) => {
    rows.push(r);
  }, partition);
  return rows.sort((a, b) => a - b);
};

Deno.test("grid covers every indexed row within one cell size, including exact boundaries", () => {
  const P = Float32Array.from([0, 0, 0, 2, 0, 0, 4, 0, 0, 2, 2, 0, 9, 9, 9]);
  const grid = spatialGrid(P, null, 2);
  // Row 2 is exactly 2 Å from row 1, two cells from row 0.
  assertEquals(visited(grid, [2, 0, 0]).filter((r) => r !== 4), [0, 1, 2, 3]);
  assertEquals(visited(grid, [9, 9, 9]), [4]);
  assertEquals(visited(grid, [100, 100, 100]), []);
  // `rows` restricts the index.
  assertEquals(visited(spatialGrid(P, [1, 3], 2), [2, 0, 0]), [1, 3]);
  // Early exit reports the hit.
  assertEquals(spatialGrid(P, null, 2).near(0, 0, 0, () => true), true);
});

Deno.test("grid partitions keep superposed rows apart", () => {
  const P = Float32Array.from([0, 0, 0, 0, 0, 0, 1, 0, 0]);
  const parts = [1, 2, 1];
  const grid = spatialGrid(P, null, 2, (r) => parts[r]);
  assertEquals(visited(grid, [0, 0, 0], 1), [0, 2]);
  assertEquals(visited(grid, [0, 0, 0], 2), [1]);
  assertEquals(visited(grid, [0, 0, 0], 3), []);
  assertThrows(() => spatialGrid(P, null, 2, () => 0.5), TypeError, "integer");
  assertThrows(() => spatialGrid(P, null, 0), TypeError, "cellSize");
  assertEquals(
    visited(spatialGrid(new Float32Array(), null, 1), [0, 0, 0]),
    [],
  );
});

Deno.test("inferred bonds reach the largest cutoff across two 3 Å cells", () => {
  // Two sulfurs 3.02 Å apart straddle x = 3 and x = 6. With padding 1 their
  // cutoff is 1.05 + 1.05 + 1 = 3.1 Å, so they bond.
  const data = atomsAt([2.99, 0, 0, 6.01, 0, 0], [16, 16]);
  const bonds = bondTopology(data, { padding: 1 });
  assertEquals([bonds.count, [...bonds.a], [...bonds.b]], [1, [0], [1]]);
  assertEquals(bondTopology(data, { padding: 0.45 }).count, 0);
});

Deno.test("inferred bonds never cross models and use canonical row order", () => {
  // Carbons 1.5 Å apart: rows 0-1 and 2-3 share model 1; row 4 is model 2,
  // superposed on row 0.
  const data = atomsAt(
    [0, 0, 0, 1.5, 0, 0, 0, 1.5, 0, 1.5, 1.5, 0, 0, 0, 0],
    [6, 6, 6, 6, 6],
    [1, 1, 1, 1, 2],
  );
  const bonds = bondTopology(data);
  const pairs = [...bonds.a].map((a, i) => [a, bonds.b[i]]);
  assertEquals(pairs, [[0, 1], [0, 2], [1, 3], [2, 3]]);
});
