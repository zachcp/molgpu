import { assertEquals, assertThrows } from "@std/assert";
import { spatialGrid } from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import { createCellList, planCellList } from "../src/index.ts";

function tablePairs(
  positions: Float32Array,
  rows: Uint32Array | null,
  cutoff: number,
): number[] {
  const indexed = rows ?? Uint32Array.from(
    { length: positions.length / 3 },
    (_, i) => i,
  );
  const grid = spatialGrid(positions, indexed, cutoff);
  const out: number[][] = [];
  for (const row of indexed) {
    const i = row * 3;
    grid.near(
      positions[i],
      positions[i + 1],
      positions[i + 2],
      (other) => {
        if (other <= row) return;
        const j = other * 3;
        const dx = positions[i] - positions[j];
        const dy = positions[i + 1] - positions[j + 1];
        const dz = positions[i + 2] - positions[j + 2];
        if (dx * dx + dy * dy + dz * dz <= cutoff * cutoff) {
          out.push([row, other]);
        }
      },
    );
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.flat();
}

Deno.test("count/prefix/scatter handles boundaries, subsets and exact pair sets", () => {
  const positions = Float32Array.of(
    -2,
    0,
    0,
    -1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    3,
    0,
    0,
  );
  for (const cutoff of [0.5, 1, 2]) {
    const grid = createCellList(positions, Math.max(1, cutoff), {
      maxCells: 100,
    });
    assertEquals(grid.offsets[grid.offsets.length - 1], 5);
    assertEquals(
      [...grid.pairsWithin(cutoff)],
      tablePairs(positions, null, cutoff),
    );
  }
  const rows = Uint32Array.of(0, 2, 3);
  const selected = createCellList(positions, 2, { rows, maxCells: 100 });
  assertEquals([...selected.pairsWithin(2)], tablePairs(positions, rows, 2));
  assertEquals([...selected.rows].sort(), [...rows]);
  const empty = createCellList(new Float32Array(), 3);
  assertEquals([...empty.pairsWithin(2)], []);
  assertEquals([...empty.offsets], [0]);
});

Deno.test("dense-grid and occupancy limits fail before unbounded work", () => {
  assertThrows(
    () => createCellList(Float32Array.of(0, 0, 0, 10_000, 0, 0), 1),
    RangeError,
    "dense cells",
  );
  const positions = new Float32Array(5000 * 3);
  const grid = createCellList(positions, 1);
  assertThrows(() => grid.pairsWithin(1), RangeError, "candidates");
  const three = createCellList(positions.slice(0, 9), 1);
  assertThrows(() => three.pairsWithin(1, 0), TypeError, "maxPairs");
  assertThrows(() => three.pairsWithin(1, 0.5), TypeError, "maxPairs");
  assertThrows(() => three.pairsWithin(1, 1), RangeError, "pairs");
});

Deno.test("cell-list validation rejects malformed and stale inputs", () => {
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0);
  assertThrows(() => createCellList(positions, 0), TypeError);
  assertThrows(() => createCellList(positions, 1, { rows: [1, 0] }), TypeError);
  assertThrows(() => createCellList(positions, 1, { rows: [0, 0] }), TypeError);
  assertThrows(() => createCellList(positions, 1, { rows: [2] }), TypeError);
  assertThrows(() => createCellList(Float32Array.of(NaN, 0, 0), 1), TypeError);
  const grid = createCellList(positions, 1);
  assertThrows(() => grid.near(0, 0, 0, 2, () => {}), TypeError);
});

Deno.test("GPU bounds planning rejects stale, invalid and excessive grids", () => {
  const bounds = {
    generation: 7,
    values: Float32Array.of(-2, 0, 0, 0, 2, 0, 0, 2),
  };
  assertEquals(planCellList(bounds, 8, 2, 1, 128), null);
  const plan = planCellList(bounds, 7, 2, 1, 128, 10)!;
  assertEquals(plan.dims, [4, 1, 1]);
  assertEquals(plan.cellCount, 4);
  assertEquals(plan.persistentBytes, 52);
  assertEquals(plan.coordinateReadBytes, 48);
  assertThrows(
    () => planCellList(bounds, 7, 2, 1, 16, 10),
    RangeError,
    "storage-buffer limit",
  );
  assertThrows(
    () => planCellList(bounds, 7, 2, 1, 128, 3),
    RangeError,
    "dense cells",
  );
  const invalid = {
    generation: 7,
    values: Float32Array.of(-2, 0, 0, 1, 2, 0, 0, 1),
  };
  assertThrows(
    () => planCellList(invalid, 7, 2, 1, 128),
    RangeError,
    "non-finite",
  );
});

for (const id of ["1crn", "1bna"]) {
  Deno.test(`${id}: pair sets agree with table.spatialGrid at several cutoffs`, async () => {
    const bytes = await Deno.readFile(
      new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url),
    );
    const data = await structureFromBcif(bytes);
    for (const cutoff of [2, 4, 8]) {
      const grid = createCellList(data.positions, cutoff, {
        maxCells: 1_000_000,
        maxCandidates: 20_000,
      });
      assertEquals(
        [...grid.pairsWithin(cutoff)],
        tablePairs(data.positions, null, cutoff),
      );
    }
  });
}
