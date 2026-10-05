import { assert, assertEquals, assertNotStrictEquals } from "@std/assert";
import { createStructure } from "@molgpu/table";
import { difference, intersect, resolve, union, where } from "../src/index.ts";

// Two disjoint 5-row sets whose FNV-1a membership hash is identical on a
// 1,000-row structure (reproduced in the post-overhaul pure review).
const LEFT = [265, 316, 363, 518, 554];
const RIGHT = [176, 293, 558, 652, 787];

const structure = (n: number) =>
  createStructure({
    positions: new Float32Array(n * 3),
    topology: {
      atoms: {
        count: n,
        id: Array.from({ length: n }, (_, i) => String(i)),
        name: Array.from({ length: n }, (_, i) => `A${i}`),
        altloc: Array(n).fill(""),
        residue: new Uint32Array(n),
        element: new Uint8Array(n).fill(6),
        occupancy: new Float32Array(n).fill(1),
        bfactor: new Float32Array(n),
      },
      residues: {
        count: 1,
        chain: Uint32Array.of(0),
        labelSeq: Int32Array.of(1),
        authSeq: ["1"],
        insertionCode: [""],
        comp: ["UNK"],
        polymer: ["other"],
      },
      chains: {
        count: 1,
        model: Int32Array.of(1),
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
        count: 0,
        chain: new Uint32Array(),
        operatorId: [],
        transform: new Float64Array(),
      },
    },
  });

const data = structure(1000);
const rows = (list: readonly number[], label = "rows") =>
  resolve(
    where("atom", label, (_, row) => list.includes(row), ["topology"]),
    data,
  );

Deno.test("colliding membership hashes still resolve to distinct ids", () => {
  const left = rows(LEFT), right = rows(RIGHT);
  assertEquals([...left.indices], LEFT);
  assertEquals([...right.indices], RIGHT);
  assertNotStrictEquals(left.id, right.id);
});

Deno.test("equal membership reuses one id regardless of label or query", () => {
  const left = rows(LEFT, "a");
  assertEquals(rows(LEFT, "b").id, left.id);
  assertEquals(rows(RIGHT, "c").id, rows(RIGHT, "d").id);
  assertNotStrictEquals(rows(RIGHT).id, left.id);
});

Deno.test("set operations disambiguate colliding results", () => {
  const left = rows(LEFT), right = rows(RIGHT);
  const all = rows([...LEFT, ...RIGHT]);
  const onlyLeft = difference(all, right);
  const onlyRight = difference(all, left);
  assertEquals([...onlyLeft.indices], LEFT);
  assertEquals([...onlyRight.indices], RIGHT);
  assertEquals(onlyLeft.id, left.id);
  assertEquals(onlyRight.id, right.id);
  assertNotStrictEquals(onlyLeft.id, onlyRight.id);
  assertEquals(intersect(all, left).id, left.id);
  assertEquals(union(left, right).id, all.id);
});

Deno.test("ids stay distinct per dataset for equal membership", () => {
  const other = structure(1000);
  const query = where("atom", "same", (_, row) => LEFT.includes(row), [
    "topology",
  ]);
  const a = resolve(query, data), b = resolve(query, other);
  assertEquals([...a.indices], [...b.indices]);
  assert(a.id !== b.id);
});
