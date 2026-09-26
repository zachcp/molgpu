import { assertEquals, assertRejects } from "@std/assert";
import {
  parseSelection,
  type SelectionExpr,
  SelectionParseError,
} from "../src/index.ts";

const call = (
  name: string,
  args?: SelectionExpr[] | Record<string, SelectionExpr>,
) => args === undefined ? { head: { name } } : { head: { name }, args };
const SQ = "structure-query.";
const compId = call(`${SQ}atom-property.macromolecular.label_comp_id`);

Deno.test("PyMOL, VMD and Jmol parse to the same plain tree", async () => {
  const expected = call(`${SQ}generator.atom-groups`, {
    "residue-test": call("core.rel.eq", [compId, "HEM"]),
  });
  assertEquals(await parseSelection("pymol", "resn HEM"), expected);
  assertEquals(await parseSelection("jmol", "[HEM]"), expected);
  const vmd = await parseSelection("vmd", "resname HEM");
  // VMD's resname reads auth_comp_id.
  assertEquals(
    JSON.stringify(vmd).includes("macromolecular.auth_comp_id"),
    true,
  );
});

Deno.test("MolScript: bare properties become calls, bare words become strings", async () => {
  const e = await parseSelection(
    "mol-script",
    "(sel.atom.atom-groups :residue-test (= atom.label_comp_id HEM))",
  );
  assertEquals(
    e,
    call(`${SQ}generator.atom-groups`, {
      "residue-test": call("core.rel.eq", [compId, "HEM"]),
    }),
  );
  // Plain JSON: no Mol* objects survive.
  assertEquals(JSON.parse(JSON.stringify(e)), e);
});

Deno.test("MolScript sel.atom.res groups by residue", async () => {
  const e = await parseSelection(
    "mol-script",
    "(sel.atom.res (= atom.resname ALA))",
  );
  assertEquals(
    JSON.stringify(e).includes(`"group-by"`),
    true,
  );
});

Deno.test("defaults are not filled in", async () => {
  // PyMOL 'around' relies on filter.within without :min-radius.
  const e = JSON.stringify(await parseSelection("pymol", "name CA around 4"));
  assertEquals(e.includes("min-radius"), false);
  assertEquals(e.includes("atom-radius"), false);
});

Deno.test("options.symbols rejects anything else, naming the language", async () => {
  const symbols = [
    `${SQ}generator.atom-groups`,
    "core.rel.eq",
    `${SQ}atom-property.macromolecular.label_comp_id`,
  ];
  assertEquals(
    await parseSelection("pymol", "resn HEM", { symbols }),
    call(`${SQ}generator.atom-groups`, {
      "residue-test": call("core.rel.eq", [compId, "HEM"]),
    }),
  );
  const error = await assertRejects(
    () => parseSelection("pymol", "byring resn PHE", { symbols }),
    SelectionParseError,
    "(pymol)",
  );
  assertEquals(error.language, "pymol");
  assertEquals(error.message.includes("is not supported"), true);
});

Deno.test("parse failures are SelectionParseErrors", async () => {
  await assertRejects(
    () => parseSelection("pymol", "resn ((("),
    SelectionParseError,
    "cannot parse",
  );
  await assertRejects(
    () => parseSelection("vmd", "   "),
    SelectionParseError,
    "empty selection",
  );
  await assertRejects(
    // deno-lint-ignore no-explicit-any
    () => parseSelection("chimera" as any, "x"),
    TypeError,
    "language must be one of",
  );
});
