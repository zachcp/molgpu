import { assert, assertEquals, assertThrows } from "@std/assert";
import { createStructure, withAttributes } from "@molgpu/table";
import {
  checkPairBudget,
  efieldChargeColumn,
  efieldGrid,
  rowBounds,
} from "../src/internal/efield-grid.ts";
import {
  latticeSeeds,
  lineSegments,
} from "../src/internal/field-line-geometry.ts";

function structure(n: number) {
  return createStructure({
    positions: Float32Array.from({ length: n * 3 }, (_, i) => i),
    topology: {
      atoms: {
        count: n,
        id: Array.from({ length: n }, (_, i) => String(i + 1)),
        name: Array.from({ length: n }, (_, i) => `C${i + 1}`),
        altloc: new Array(n).fill(""),
        residue: new Uint32Array(n),
        element: new Uint8Array(n).fill(6),
        occupancy: new Float32Array(n).fill(1),
        bfactor: new Float32Array(n),
        radius: new Float32Array(n).fill(1),
      },
      residues: {
        count: 1,
        chain: new Uint32Array(1),
        labelSeq: new Int32Array([1]),
        authSeq: ["1"],
        insertionCode: [""],
        comp: ["UNK"],
        polymer: ["other"],
      },
      chains: {
        count: 1,
        model: new Int32Array([1]),
        labelId: ["A"],
        authId: ["A"],
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
        chain: new Uint32Array(1),
        operatorId: ["identity"],
        transform: Float64Array.from([
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
        ]),
      },
    },
  });
}

Deno.test("efieldGrid pads the bounds and names a spacing that fits", () => {
  const grid = efieldGrid(
    { min: [0, 0, 0], max: [10, 4, 2] },
    1,
    8,
    "kT/e",
    128 ** 3,
  );
  assertEquals(grid.dims, [27, 21, 19]);
  assertEquals([...grid.transform.subarray(12, 15)], [-8, -8, -8]);
  assertEquals(grid.transform[0], 1);
  assertEquals(grid.unit, "kT/e");
  // Two samples minimum per axis even for a single atom and no padding.
  assertEquals(
    efieldGrid({ min: [1, 1, 1], max: [1, 1, 1] }, 1, 0, "kT/e", 8).dims,
    [2, 2, 2],
  );
  assertThrows(
    () =>
      efieldGrid(
        { min: [0, 0, 0], max: [100, 100, 100] },
        0.5,
        8,
        "kT/e",
        64 ** 3,
      ),
    RangeError,
    "exceeds maxSamples 262144; use spacing ≥ 1.85 Å",
  );
  // The suggested spacing does fit.
  assertEquals(
    efieldGrid(
      { min: [0, 0, 0], max: [100, 100, 100] },
      1.85,
      8,
      "kT/e",
      64 ** 3,
    )
      .dims,
    [64, 64, 64],
  );
});

Deno.test("checkPairBudget bounds samples × atoms", () => {
  const grid = efieldGrid(
    { min: [0, 0, 0], max: [9, 9, 9] },
    1,
    0,
    "kT/e",
    1e6,
  );
  checkPairBudget(grid, 1000, 1e6);
  assertThrows(
    () => checkPairBudget(grid, 1001, 1e6),
    RangeError,
    "1000 samples × 1001 charged atoms",
  );
});

Deno.test("efieldChargeColumn requires a per-atom column and says how to add one", () => {
  const data = structure(3);
  assertThrows(
    () => efieldChargeColumn(data, "partialCharge", undefined),
    TypeError,
    "templateCharges",
  );
  const charged = withAttributes(data, {
    partialCharge: {
      domain: "atom",
      kind: "scalar",
      values: Float32Array.of(0.5, 0, -0.5),
      provenance: "user",
    },
    "user:residueCharge": {
      domain: "residue",
      kind: "scalar",
      values: Float32Array.of(1),
      provenance: "user",
    },
  });
  assertEquals(
    [...efieldChargeColumn(charged, "partialCharge", undefined)!.values],
    [0.5, 0, -0.5],
  );
  assertThrows(
    () => efieldChargeColumn(charged, "user:residueCharge", undefined),
    TypeError,
    "per atom",
  );
  // A kernel-produced column has no CPU values to read.
  assertEquals(
    efieldChargeColumn(data, "partialCharge", {
      domain: "atom",
      kind: "scalar",
      generation: 1,
      provenance: "user",
      source: {} as never,
    }),
    null,
  );
});

Deno.test("rowBounds covers only the summed rows", () => {
  const positions = Float32Array.of(0, 0, 0, 5, -2, 1, -3, 9, 4);
  assertEquals(rowBounds(positions, Uint32Array.of(0, 1)), {
    min: [0, -2, 0],
    max: [5, 0, 1],
  });
  assertEquals(rowBounds(positions, new Uint32Array()), null);
});

Deno.test("latticeSeeds thins a lattice by a fixed stride", () => {
  const grid = efieldGrid(
    { min: [0, 0, 0], max: [20, 20, 20] },
    1,
    0,
    "kT/e",
    1e6,
  );
  const all = latticeSeeds(grid, 4, 1e6);
  assertEquals(all.length / 3, 125);
  assertEquals([...all.subarray(0, 3)], [2, 2, 2]);
  const few = latticeSeeds(grid, 4, 40);
  assert(few.length / 3 <= 40 && few.length / 3 >= 30);
  assertEquals([...few.subarray(0, 3)], [2, 2, 2]);
});

Deno.test("lineSegments makes one strip per line", () => {
  assertEquals([...lineSegments(2, 2)], [1, 3, 3, 3, 2, 1, 3, 3, 3, 2]);
});
