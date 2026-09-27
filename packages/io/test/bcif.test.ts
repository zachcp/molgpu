import { assert, assertRejects, assertStrictEquals } from "@std/assert";
import { BOND_FLAGS, type Topology } from "@molgpu/table";
import { BcifParseError, structureFromBcif } from "../src/index.ts";

Deno.test("lowers public 1TQN BinaryCIF into owned table domains", async () => {
  const data = await structureFromBcif(
    new Uint8Array(
      await Deno.readFile(new URL("./fixtures/1tqn.bcif", import.meta.url)),
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
    await Deno.readFile(new URL("./fixtures/4c7r.bcif", import.meta.url)),
  );
  const { element } = data.topology.atoms;
  assertStrictEquals(element.filter((z) => z === 17).length, 5);
  assertStrictEquals(element.filter((z) => z === 0).length, 0);
});

Deno.test("a microheterogeneous position is one residue with per-atom components", async () => {
  // 1EJG residue 22 is modelled as PRO (altloc A) and SER (altloc B).
  const data = await structureFromBcif(
    await Deno.readFile(new URL("./fixtures/1ejg.bcif", import.meta.url)),
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
    await Deno.readFile(new URL("./fixtures/1crn.bcif", import.meta.url)),
  );
  assertStrictEquals(data.topology.atoms.comp, undefined);
});

Deno.test("links carry typed bonds from chem_comp_bond and struct_conn", async () => {
  const load = async (id: string) =>
    (await structureFromBcif(
      await Deno.readFile(new URL(`./fixtures/${id}.bcif`, import.meta.url)),
    )).topology;
  const seen = (id: string, links: NonNullable<Topology["links"]>) => {
    const out = new Map<string, number>();
    for (let r = 0; r < links.count; r++) {
      for (const [name, bit] of Object.entries(BOND_FLAGS)) {
        if (links.flags[r] & bit) {
          const key = `${links.source[r]}:${name}`;
          out.set(key, (out.get(key) ?? 0) + 1);
        }
      }
    }
    return out;
  };
  const crn = seen("1crn", (await load("1crn")).links!);
  assertStrictEquals(crn.get("struct_conn:disulfide"), 3);
  assert(
    (crn.get("component:aromatic") ?? 0) > 0,
    "PHE/TYR rings are aromatic",
  );
  assert((crn.get("component:covalent") ?? 0) > 0);
  assertStrictEquals(
    seen("1tqn", (await load("1tqn")).links!).get("struct_conn:metallic"),
    2,
  );
  assertStrictEquals(
    seen("1bna", (await load("1bna")).links!).get("struct_conn:hydrogen"),
    32,
  );
  // Unknown struct_conn types would carry no flags; none are guessed covalent.
  const tqn = (await load("1tqn")).links!;
  for (let r = 0; r < tqn.count; r++) {
    if (tqn.source[r] === "struct_conn") {
      assertStrictEquals(tqn.flags[r] & BOND_FLAGS.covalent, 0);
    }
  }
});
