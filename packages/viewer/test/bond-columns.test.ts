import { assertEquals, assertNotEquals, assertStrictEquals } from "@std/assert";
import { createStructure } from "@molgpu/table";
import { byElement, evaluate } from "@molgpu/fields";
import {
  buildBondColumns,
  buildBondRows,
} from "../src/representations/bonds/bond-columns.ts";
import { gatherAtomColumns } from "./gather-oracle.ts";

const data = createStructure({
  positions: Float32Array.from([-4, 0, 0, -2, 0, 0, 1, -1, 0, 3, 3, 2]),
  topology: {
    atoms: {
      count: 4,
      id: ["1", "2", "3", "4"],
      name: ["C", "O", "N", "S"],
      altloc: ["", "", "", ""],
      residue: Uint32Array.from([0, 0, 0, 0]),
      element: Uint8Array.from([6, 8, 7, 16]),
      occupancy: Float32Array.from([1, 1, 1, 1]),
      bfactor: new Float32Array(4),
      radius: Float32Array.from([1.7, 1.52, 1.55, 1.8]),
    },
    residues: {
      count: 1,
      chain: Uint32Array.of(0),
      labelSeq: Int32Array.of(1),
      authSeq: ["1"],
      insertionCode: [""],
      comp: ["GLY"],
      polymer: ["protein"],
    },
    chains: {
      count: 1,
      model: Int32Array.of(1),
      labelId: ["A"],
      authId: ["A"],
    },
    bonds: {
      count: 2,
      a: Uint32Array.from([0, 2]),
      b: Uint32Array.from([1, 3]),
      order: Uint8Array.of(1, 1),
      source: ["explicit", "explicit"],
    },
    instances: {
      count: 1,
      chain: Uint32Array.of(0),
      operatorId: ["1"],
      transform: Float64Array.of(
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
      ),
    },
  },
});

Deno.test("default bonds split C-O and diagonal N-S at exact midpoints with matching endpoint colors", () => {
  const built = buildBondColumns(data, null, "both", true);
  const live = buildBondRows(data, null, "both", true);
  assertEquals([...live.endpoints], [0, 1, 2, 3]);
  assertEquals([...live.rows], [...built.rows]);
  assertEquals([...live.segments], [...built.segments]);
  assertEquals([...built.rows], [0, 0, 1, 1, 2, 2, 3, 3]);
  assertEquals([...built.segments], [1, 2, 1, 2, 1, 2, 1, 2]);
  assertEquals([...built.positions], [
    -4,
    0,
    0,
    -3,
    0,
    0,
    -3,
    0,
    0,
    -2,
    0,
    0,
    1,
    -1,
    0,
    2,
    1,
    1,
    2,
    1,
    1,
    3,
    3,
    2,
  ]);
  assertEquals([
    ...gatherAtomColumns(data, built.rows, ["element"], "bonds").element,
  ], [
    6,
    6,
    8,
    8,
    7,
    7,
    16,
    16,
  ]);
  const colors = evaluate(byElement(), data, { domain: "atom" });
  assertNotEquals([...colors.slice(0, 4)], [...colors.slice(4, 8)]);
  assertNotEquals([...colors.slice(8, 12)], [...colors.slice(12, 16)]);
});

Deno.test("explicit styling keeps one unsplit stroke per bond and selection endpoint policy", () => {
  const unsplit = buildBondColumns(data, null, "both", false);
  const live = buildBondRows(data, null, "both", false);
  assertEquals([...live.endpoints], [0, 1, 2, 3]);
  assertEquals([...live.rows], [...unsplit.rows]);
  assertEquals([...unsplit.rows], [0, 1, 2, 3]);
  assertEquals([...unsplit.segments], [1, 2, 1, 2]);
  assertEquals([...unsplit.positions], [...data.positions]);
  assertStrictEquals(
    buildBondColumns(data, Uint32Array.of(0), "both", true).n,
    0,
  );
  assertEquals([
    ...buildBondColumns(data, Uint32Array.of(0), "either", true).rows,
  ], [0, 0, 1, 1]);
});
