import { assert, assertRejects, assertStrictEquals } from "@std/assert";
import { readFile } from "node:fs/promises";
import { BcifParseError, structureFromBcif } from "../src/index.ts";

Deno.test("lowers public 1TQN BinaryCIF into owned table domains", async () => {
  const data = await structureFromBcif(
    new Uint8Array(
      await readFile(new URL("./fixtures/1tqn.bcif", import.meta.url)),
    ),
  );
  assertStrictEquals(data.topology.atoms.count, 3999);
  assertStrictEquals(data.positions.length, 11997);
  assert(data.topology.residues.count > 500);
  assert(data.topology.chains.count >= 1);
  assertStrictEquals(data.topology.bonds.count, 0);
});

Deno.test("reports malformed BCIF through a structured boundary error", async () => {
  const error = await assertRejects(
    () => structureFromBcif(new Uint8Array([0, 1, 2])),
    BcifParseError,
  );
  assertStrictEquals(error.code, "INVALID_BCIF");
});
