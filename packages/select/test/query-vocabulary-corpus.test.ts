import { assertEquals } from "@std/assert";
import { activeAtoms } from "@molgpu/table";
import { parseSelection, structureFromBcif } from "@molgpu/io";
import {
  all,
  and,
  chain,
  comp,
  compile,
  ligand,
  not,
  nucleic,
  protein,
  residues,
  resolve,
  secondaryStructure,
  type SelectionQuery,
  type SelectionView,
  toAtoms,
  water,
  within,
} from "@molgpu/select";

// The existing selection oracle validates these MolQL front ends against Mol*.
// Compare named authoring to the same expressions on crystal/altloc/NMR data.
const cases: readonly [SelectionQuery, "vmd" | "pymol", string][] = [
  [protein(), "vmd", "protein"],
  [nucleic(), "vmd", "nucleic"],
  [water(), "pymol", "solvent"],
  [ligand(), "pymol", "not polymer and not solvent"],
  [chain("A"), "pymol", "chain A"],
  [residues([1, 10]), "vmd", "resid 1 to 10"],
  [secondaryStructure("helix"), "vmd", "structure H G I"],
  [and(protein(), not(comp(["CYS"]))), "vmd", "protein and not resname CYS"],
  [within(5, comp(["HEM"])), "vmd", "within 5 of resname HEM"],
];

for (const id of ["1crn", "1ejg", "2k39"]) {
  Deno.test(`named query vocabulary matches oracle expressions on ${id}`, async () => {
    const bytes = await Deno.readFile(
      new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url),
    );
    const data = await structureFromBcif(bytes);
    for (const [query, language, text] of cases) {
      const expression = compile(await parseSelection(language, text));
      for (
        const view of [undefined, { model: "first", altloc: "primary" }, {
          model: "all",
          altloc: "all",
        }] as const
      ) {
        const options = view ? { view } : {};
        const actual = toAtoms(resolve(query, data, options), data);
        const expected = toAtoms(resolve(expression, data, options), data);
        assertEquals(
          [...actual.indices],
          [...expected.indices],
          `${id}: ${text}, ${JSON.stringify(view)}`,
        );
      }
    }
    // The view contract itself is the table policy on the same retained rows.
    const views: SelectionView[] = [{ model: "first", altloc: "primary" }, {
      model: "all",
      altloc: "all",
    }];
    if (id === "2k39") views.push({ model: 2, altloc: "primary" });
    for (const view of views) {
      assertEquals(
        resolve(all(), data, { view }).indices,
        activeAtoms(data, view),
      );
    }
  });
}
