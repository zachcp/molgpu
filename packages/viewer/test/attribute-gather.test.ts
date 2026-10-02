import { assertEquals, assertThrows } from "@std/assert";
import { byChain, compile } from "@molgpu/fields";
import { createStructure } from "@molgpu/table";
import { fixture } from "../../table/test/fixture.ts";
import { gatherAtomColumns } from "./gather-oracle.ts";

Deno.test("byChain fields gather the derived atom-chain column", () => {
  const data = createStructure(fixture());
  const names = compile(byChain(), { target: "link", domain: "atom" }).bindings
    .filter((binding) => binding.id.startsWith("attr:"))
    .map((binding) => binding.id.slice(5));
  assertEquals(names, ["atomChain"]);
  const gathered = gatherAtomColumns(data, null, names, "test");
  assertEquals(
    [...gathered.atomChain],
    [...data.topology.atoms.residue].map(
      (r) => data.topology.residues.chain[r],
    ),
  );
  assertThrows(
    () => gatherAtomColumns(data, null, ["chain"], "test"),
    TypeError,
    "missing atom attribute",
  );
});
