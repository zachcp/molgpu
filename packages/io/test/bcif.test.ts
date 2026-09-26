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

Deno.test("every element symbol maps to its atomic number, not only common ones", async () => {
  // 4C7R carries five chloride ions; an 8-symbol table once read them as 0.
  const data = await structureFromBcif(
    await readFile(new URL("./fixtures/4c7r.bcif", import.meta.url)),
  );
  const { element } = data.topology.atoms;
  assertStrictEquals(element.filter((z) => z === 17).length, 5);
  assertStrictEquals(element.filter((z) => z === 0).length, 0);
});

Deno.test("a microheterogeneous position is one residue with per-atom components", async () => {
  // 1EJG residue 22 is modelled as PRO (altloc A) and SER (altloc B).
  const data = await structureFromBcif(
    await readFile(new URL("./fixtures/1ejg.bcif", import.meta.url)),
  );
  const { atoms, residues } = data.topology;
  assert(atoms.comp, "atoms.comp is emitted when a residue mixes components");
  const mixed = new Map<number, Set<string>>();
  for (let i = 0; i < atoms.count; i++) {
    const set = mixed.get(atoms.residue[i]) ?? new Set();
    set.add(atoms.comp[i]);
    mixed.set(atoms.residue[i], set);
  }
  const shared = [...mixed].filter(([, comps]) => comps.size > 1);
  assert(shared.length > 0);
  for (const [r, comps] of shared) {
    assert(comps.has(residues.comp[r]), "residues.comp is one of the atoms'");
  }
  assert(
    shared.some(([, comps]) => comps.has("PRO") && comps.has("SER")),
    "PRO/SER share a residue",
  );
});

Deno.test("atoms.comp is omitted without microheterogeneity", async () => {
  const data = await structureFromBcif(
    await readFile(new URL("./fixtures/1crn.bcif", import.meta.url)),
  );
  assertStrictEquals(data.topology.atoms.comp, undefined);
});
