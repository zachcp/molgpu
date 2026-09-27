// Imported secondary-structure codes (efv.4): struct_conf helix classes,
// turns, strands and bends, checked against Mol*'s model secondary structure
// on the corpus and against synthetic struct_conf rows.
import { assert, assertEquals } from "@std/assert";
import { CIF } from "molstar/lib/mol-io/reader/cif.js";
import { trajectoryFromMmCIF } from "molstar/lib/mol-model-formats/structure/mmcif.js";
import { ModelSecondaryStructure } from "molstar/lib/mol-model-formats/structure/property/secondary-structure.js";
import { Task } from "molstar/lib/mol-task/index.js";
import { attributeColumn, SS_CODES, type StructureData } from "@molgpu/table";
import { structureFromBcif } from "../src/index.ts";
import { type AtomRow, atomSiteBcif } from "./bcif-writer.ts";
import { corpus } from "./corpus.ts";

// Mol* 5.11 SecondaryStructureType.Flag values (a const enum, which isolated
// modules cannot read): mol-model/structure/model/types.js.
const F = {
  None: 0,
  Helix: 2,
  Beta: 4,
  Bend: 8,
  Turn: 16,
  Helix3Ten: 2048,
  HelixAlpha: 4096,
  HelixPi: 32768,
  BetaStrand: 4194304,
  BetaSheet: 8388608,
} as const;
// The Mol* flags each code stands for, and the bits the comparison looks at.
const CODE_FLAGS: Record<string, number> = {
  "-": F.None,
  H: F.Helix | F.HelixAlpha,
  B: F.Beta | F.BetaStrand,
  E: F.Beta | F.BetaSheet,
  G: F.Helix | F.Helix3Ten,
  I: F.Helix | F.HelixPi,
  T: F.Turn,
  S: F.Bend,
};
const COMPARED = F.Helix | F.Beta | F.Turn | F.Bend | F.HelixAlpha |
  F.Helix3Ten | F.HelixPi | F.BetaStrand | F.BetaSheet;

const codesOf = (data: StructureData): string[] =>
  [...attributeColumn(data, "ssCode")!.values].map((c) => SS_CODES[c]);

for (const entry of corpus) {
  Deno.test(`${entry.id}: imported ssCode flags equal Mol*'s model secondary structure`, async () => {
    const bytes = await Deno.readFile(
      new URL(`./fixtures/${entry.id}.bcif`, import.meta.url),
    );
    const data = await structureFromBcif(bytes);
    const parsed = await CIF.parseBinary(bytes).run();
    if (parsed.isError) throw new Error(parsed.message);
    const trajectory = await trajectoryFromMmCIF(parsed.result.blocks[0]).run();
    const model = await Task.resolveInContext(trajectory.getFrameAtIndex(0));
    const ss = ModelSecondaryStructure.Provider.get(model)!;
    const { atomSourceIndex, residueAtomSegments } = model.atomicHierarchy;
    const codes = attributeColumn(data, "ssCode")!.values;
    let compared = 0, fine = 0;
    // Match residues through source atom rows: Mol* reorders atom_site by
    // entity, so positions in its hierarchy are not our residue rows.
    for (let rI = 0; rI < residueAtomSegments.count; rI++) {
      const atom = residueAtomSegments.offsets[rI];
      const residue = data.topology.atoms.residue[atomSourceIndex.value(atom)];
      const ours = CODE_FLAGS[SS_CODES[codes[residue]]];
      const theirs = ss.type[ss.getIndex(rI as never)] & COMPARED;
      assertEquals(ours, theirs, `${entry.id} residue ${residue}`);
      compared++;
      if (ours & (F.Helix3Ten | F.HelixPi)) fine++;
    }
    assert(compared > 0);
    // 1a4y, 1tqn and 4c7r annotate class-5 (3-10) helices.
    if (["1a4y", "1tqn", "4c7r"].includes(entry.id)) assert(fine > 0);
  });
}

// Ten-residue alanine chain A plus a two-residue DNA chain B.
const ROWS: AtomRow[] = [
  ...Array.from({ length: 10 }, (_, i) => ({
    element: "C",
    name: "CA",
    comp: "ALA",
    seq: i + 1,
    xyz: [i * 3.8, 0, 0] as const,
  })),
  ...[1, 2].map((seq) => ({
    element: "P",
    name: "P",
    comp: "DA",
    seq,
    chain: "B",
    xyz: [0, 10 + seq * 6, 0] as const,
  })),
];
const conf = (
  type: string,
  beg: number,
  end: number,
  helixClass: string | number = "?",
  chain = "A",
) => ({
  conf_type_id: type,
  beg_label_asym_id: chain,
  beg_label_seq_id: beg,
  end_label_seq_id: end,
  pdbx_PDB_helix_class: helixClass,
});

Deno.test("struct_conf types map to DSSP codes, class before type, sheets last", async () => {
  const data = await structureFromBcif(atomSiteBcif(ROWS, {
    categories: {
      struct_conf: [
        conf("HELX_P", 1, 1, 3), // class 3: pi
        conf("HELX_RH_3T_P", 2, 2), // no class: type decides
        conf("HELX_LH_PI_P", 3, 3),
        conf("TURN_TY1_P", 4, 4),
        conf("STRN", 5, 5),
        conf("BEND", 6, 6),
        conf("HELX_P", 7, 7, 6), // left-handed alpha: H
        conf("TURN_P", 8, 9),
        conf("HELX_RH_B_N", 1, 2, "?", "B"), // nucleic helix: not coded
      ],
      struct_sheet_range: [
        {
          sheet_id: "A",
          beg_label_asym_id: "A",
          beg_label_seq_id: 9,
          end_label_seq_id: 10,
        },
      ],
    },
  }));
  const column = attributeColumn(data, "ssCode")!;
  assertEquals(column.provenance, "imported:mmcif");
  // Residue 9 is both a turn and a sheet: the sheet wins, as in Mol*.
  assertEquals(codesOf(data).join(""), "IGITBSHTEE--");
});
