import { assertEquals } from "@std/assert";
import { attributeColumn } from "@molgpu/table";
import { compile, resolve, type SelectionExpr } from "@molgpu/select";
import { structureFromBcif } from "../src/index.ts";
import { type AtomRow, atomSiteBcif } from "./bcif-writer.ts";
import { corpus } from "./corpus.ts";

// A charged ligand (ammonium N+, carboxylate O-) next to a Zn2+ ion.
const LIGAND: AtomRow[] = [
  { element: "N", name: "N1", comp: "LIG", seq: 1, xyz: [0, 0, 0], charge: 1 },
  { element: "C", name: "C1", comp: "LIG", seq: 1, xyz: [1.5, 0, 0] },
  { element: "C", name: "C2", comp: "LIG", seq: 1, xyz: [2.3, 1.2, 0] },
  { element: "O", name: "O1", comp: "LIG", seq: 1, xyz: [3.5, 1.2, 0] },
  {
    element: "O",
    name: "O2",
    comp: "LIG",
    seq: 1,
    xyz: [1.7, 2.3, 0],
    charge: -1,
  },
  {
    element: "ZN",
    name: "ZN",
    comp: "ZN",
    seq: 2,
    chain: "B",
    group: "HETATM",
    xyz: [5, 5, 5],
    charge: 2,
  },
];

Deno.test("formalCharge: imported values carry imported:mmcif", async () => {
  const data = await structureFromBcif(atomSiteBcif(LIGAND));
  const column = attributeColumn(data, "formalCharge")!;
  assertEquals(column.provenance, "imported:mmcif");
  assertEquals([...column.values], [1, 0, 0, 0, -1, 2]);
  // io writes only the derived column now.
  assertEquals(data.topology.atoms.formalCharge, undefined);
});

Deno.test("formalCharge: all-unknown and absent fields are default zeros", async () => {
  const unknown = LIGAND.map((row) => ({ ...row, charge: null }));
  for (
    const bytes of [
      atomSiteBcif(unknown),
      atomSiteBcif(LIGAND, { charge: false }),
    ]
  ) {
    const column = attributeColumn(
      await structureFromBcif(bytes),
      "formalCharge",
    )!;
    assertEquals(column.provenance, "default");
    assertEquals([...column.values], [0, 0, 0, 0, 0, 0]);
  }
});

Deno.test("formalCharge: every corpus entry is '?' and resolves as default", async () => {
  for (const entry of corpus) {
    const data = await structureFromBcif(
      await Deno.readFile(
        new URL(`./fixtures/${entry.id}.bcif`, import.meta.url),
      ),
    );
    const column = attributeColumn(data, "formalCharge")!;
    assertEquals(column.provenance, "default", entry.id);
    assertEquals(column.values.every((v) => v === 0), true, entry.id);
  }
});

const chargeIs = (value: number): SelectionExpr => ({
  head: { name: "structure-query.generator.atom-groups" },
  args: {
    "atom-test": {
      head: { name: "core.rel.eq" },
      args: [{
        head: {
          name:
            "structure-query.atom-property.macromolecular.pdbx_formal_charge",
        },
      }, value],
    },
  },
});

Deno.test("formalCharge: selections read the derived column, as Mol* does", async () => {
  const data = await structureFromBcif(atomSiteBcif(LIGAND));
  assertEquals([...resolve(compile(chargeIs(2)), data).indices], [5]);
  // No field in the file: charge = 0 selects every atom instead of throwing.
  const plain = await structureFromBcif(
    atomSiteBcif(LIGAND, { charge: false }),
  );
  assertEquals(resolve(compile(chargeIs(0)), plain).indices.length, 6);
});
