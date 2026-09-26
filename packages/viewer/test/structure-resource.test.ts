import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { createStructure, withPositions } from "@molgpu/table";
import { createStructureResource } from "../src/internal/structure-resource.ts";

const structure = () =>
  createStructure({
    positions: new Float32Array([0, 0, 0, 2, 4, 6]),
    topology: {
      atoms: {
        count: 2,
        id: ["1", "2"],
        name: ["C", "O"],
        altloc: ["", ""],
        residue: new Uint32Array([0, 0]),
        element: new Uint8Array([6, 8]),
        occupancy: new Float32Array([1, 1]),
        bfactor: new Float32Array(2),
        radius: new Float32Array([1.7, 1.52]),
      },
      residues: {
        count: 1,
        chain: new Uint32Array([0]),
        labelSeq: new Int32Array([1]),
        authSeq: ["1"],
        insertionCode: [""],
        comp: ["GLY"],
        polymer: ["protein"],
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
        chain: new Uint32Array([0]),
        operatorId: ["identity"],
        transform: new Float64Array([
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

Deno.test("shares bounded atom mappings and stamps their structure identity", () => {
  const data = structure(),
    resource = createStructureResource(data, { maxSelections: 2 });
  const one = resource.selection(new Uint32Array([0]));
  assertStrictEquals(resource.selection(new Uint32Array([0])), one);
  assertEquals(one.bounds, {
    min: [0, 0, 0],
    max: [0, 0, 0],
    center: [0, 0, 0],
  });
  assertStrictEquals(resource.selection(new Uint32Array()).bounds, null);
  resource.selection(new Uint32Array([1]));
  resource.selection(new Uint32Array([0, 1]));
  assertNotStrictEquals(resource.selection(new Uint32Array([0])), one);
  assertThrows(
    () => resource.selection(new Uint32Array([1, 0])),
    Error,
    "sorted and unique",
  );
  assertThrows(
    () => resource.selection(new Uint32Array([2])),
    Error,
    "out of range",
  );
});

Deno.test("coordinate versions receive fresh resources but preserve topology identity", () => {
  const original = structure();
  const moved = withPositions(original, new Float32Array([10, 0, 0, 12, 4, 6]));
  const before = createStructureResource(original),
    after = createStructureResource(moved);
  assertStrictEquals(before.identity, after.identity);
  assertNotStrictEquals(before.positionsRevision, after.positionsRevision);
  assertStrictEquals(
    after.accepts(before.selection(new Uint32Array([0]))),
    false,
  );
  assertEquals(after.bounds?.center, [11, 2, 3]);
});

Deno.test("foreign resources and disposed resources cannot be reused", () => {
  const left = createStructureResource(structure()),
    right = createStructureResource(structure());
  const selection = left.selection(new Uint32Array([0]));
  assertStrictEquals(right.accepts(selection), false);
  left.dispose();
  assertStrictEquals(left.accepts(selection), false);
  assertThrows(() => left.selection(new Uint32Array([0])), Error, "disposed");
});
