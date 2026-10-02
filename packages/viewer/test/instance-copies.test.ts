// Assembly copies drawn at render time (molgpu-sept-fch.2).
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { structureFromBcif } from "@molgpu/io";
import {
  copyRows,
  instanceCopies,
  type InstanceCopy,
} from "../src/internal/instance-plan.ts";

const bytes = await Deno.readFile(
  new URL("../../io/test/fixtures/1tqn.bcif", import.meta.url),
);

Deno.test("instances: the asymmetric unit draws as is", async () => {
  assertEquals(instanceCopies(await structureFromBcif(bytes)), []);
});

Deno.test("instances: 1tqn assembly 2 draws four copies of chains A-C", async () => {
  const data = await structureFromBcif(bytes, { assembly: "2" });
  const copies = instanceCopies(data);
  assertEquals(copies.map((c) => c.operatorId), ["1", "2", "3", "4"]);
  const { atoms, residues, chains } = data.topology;
  const asymRows = Array.from({ length: atoms.count }, (_, a) => a).filter((
    a,
  ) =>
    ["A", "B", "C"].includes(chains.labelId[residues.chain[atoms.residue[a]]])
  );
  for (const copy of copies) {
    assertEquals(Array.from(copy.rows), asymRows, `copy ${copy.operatorId}`);
  }
  // The same object for the same topology: representations share it.
  assertStrictEquals(instanceCopies(data), copies);
});

Deno.test("instances: copy rows intersect a representation's rows", () => {
  const copy = { rows: Uint32Array.of(1, 3, 5, 7) } as InstanceCopy;
  assertEquals([...copyRows(Uint32Array.of(0, 1, 2, 5, 9), copy)], [1, 5]);
  const rows = Uint32Array.of(4, 2);
  assert(copyRows(rows, null) === rows);
});
