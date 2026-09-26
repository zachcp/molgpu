// Mol* as the oracle for @molgpu/select's MolQL evaluator (molgpu-sept-922.7).
//
// Each selection string is parsed twice: by @molgpu/io's parseSelection for our
// evaluator, and by Mol*'s own front end for Mol*'s evaluator. The same BinaryCIF
// bytes are loaded by structureFromBcif and by Mol* (model 0). Mol*'s result is
// mapped to file rows through atom.sourceIndex, which equal our atom rows for
// the single-model corpus entries used here. Atom sets must match exactly.

import { assertEquals } from "@std/assert";
import { CIF } from "molstar/lib/mol-io/reader/cif.js";
import { trajectoryFromMmCIF } from "molstar/lib/mol-model-formats/structure/mmcif.js";
import {
  Structure,
  StructureElement,
  StructureProperties,
} from "molstar/lib/mol-model/structure.js";
import { StructureSelection } from "molstar/lib/mol-model/structure/query.js";
import { Task } from "molstar/lib/mol-task/index.js";
import { SyncRuntimeContext } from "molstar/lib/mol-task/execution/synchronous.js";
import { SecondaryStructureProvider } from "molstar/lib/mol-model-props/computed/secondary-structure.js";
import { AssetManager } from "molstar/lib/mol-util/assets.js";
import { Script } from "molstar/lib/mol-script/script.js";
import { examples as pymolExamples } from "molstar/lib/mol-script/transpilers/pymol/examples.js";
import { examples as vmdExamples } from "molstar/lib/mol-script/transpilers/vmd/examples.js";
import { examples as jmolExamples } from "molstar/lib/mol-script/transpilers/jmol/examples.js";
import type { StructureData } from "@molgpu/table";
import {
  parseSelection,
  type SelectionLanguage,
  SelectionParseError,
  structureFromBcif,
} from "../../packages/io/src/index.ts";
import {
  compile,
  resolve,
  supportedSymbols,
} from "../../packages/select/src/index.ts";

type Case = readonly [SelectionLanguage, string];

const CURATED: readonly Case[] = [
  ["pymol", "resn CYS and name SG"],
  ["pymol", "name CA and resi 10-20"],
  ["pymol", "elem S or (polymer and not hydro)"],
  ["pymol", "not resn CYS"],
  ["pymol", "byres (name SG around 2.5)"],
  ["pymol", "name SG around 4"],
  ["pymol", "name SG expand 3"],
  ["pymol", "name SG within 4 of resn THR"],
  ["pymol", "name CA near_to 6 of resn PRO"],
  ["pymol", "name CA beyond 10 of resn PRO"],
  ["pymol", "resn PRO extend 2"],
  ["pymol", "bound_to name SG"],
  ["pymol", "b > 10"],
  ["pymol", "byres resn HEM around 4"],
  ["pymol", "byres resn HEM expand 4"],
  ["pymol", "solvent"],
  ["pymol", "chain A and resi 100-120 and name CA"],
  ["vmd", "resname HEM or name FE"],
  ["vmd", "within 5 of resname HEM"],
  ["vmd", "protein and within 5 of resname HEM"],
  ["vmd", "nucleic"],
  ["vmd", "resid 100 to 120 and name CA"],
  ["jmol", "[HEM]"],
  ["pymol", "hetatm"],
  ["pymol", "hetatm and not solvent"],
  ["jmol", "hetero"],
  ["mol-script", "(sel.atom.atoms atom.is-het)"],
  [
    "mol-script",
    "(sel.atom.atom-groups :entity-test (= atom.label_entity_id (str 1)))",
  ],
  [
    "mol-script",
    "(sel.atom.atom-groups :chain-test (= atom.entity-type water))",
  ],
  [
    "mol-script",
    "(sel.atom.atom-groups :entity-test (= atom.entity-type non-polymer))",
  ],
  ["mol-script", "(sel.atom.atom-groups :group-by atom.key.entity)"],
  ["mol-script", "(sel.atom.atoms (!= atom.pdbx_formal_charge 0))"],
  ["pymol", "elem Cl"],
  ["pymol", "byres (elem Cl around 5)"],
  ["vmd", "element CL or mass > 30"],
  [
    "mol-script",
    "(sel.atom.atom-groups :residue-test (= atom.label_comp_id HEM))",
  ],
  ["mol-script", "(sel.atom.res (in-range atom.resno 130 180))"],
  ["mol-script", "(sel.atom.chains (= atom.auth_asym_id A))"],
  [
    "mol-script",
    "(sel.atom.include-surroundings (sel.atom.atoms (= atom.el _Fe)) :radius 5 :as-whole-residues true)",
  ],
  [
    "mol-script",
    "(sel.atom.pick sel.atom.res :test (<= 10 (atom.set.atom-count)))",
  ],
  [
    "mol-script",
    "(sel.atom.is-connected-to sel.atom.res :target (sel.atom.res (= atom.label_comp_id HEM)) :disjunct true)",
  ],
];

const CASES: readonly Case[] = [
  ...CURATED,
  ...pymolExamples.map((e) => ["pymol", e.value] as const),
  ...vmdExamples.map((e) => ["vmd", e.value] as const),
  ...jmolExamples.map((e) => ["jmol", e.value] as const),
];

/**
 * Known, accepted differences, each with its cause. The test fails if one of
 * these starts matching (remove it) or a new difference appears.
 */
const KNOWN_DIFFERENCES: Readonly<Record<string, string>> = {
  // 1EJG has microheterogeneous residues (PRO/SER at one position). @molgpu/io
  // splits them into one residue row per component; Mol* keeps one residue, so
  // residue-level tests and grouping see different residues.
  "pymol: name CA near_to 6 of resn PRO [1ejg]": "microheterogeneity",
  "vmd: backbone [1ejg]": "microheterogeneity",
  "vmd: not protein [1ejg]": "microheterogeneity",
  "vmd: protein (backbone or name H) [1ejg]": "microheterogeneity",
  // Mol* follows the heme Fe-S(Cys) metal coordination from struct_conn; the
  // table's inferred bonds do not include it (molgpu-sept-922.14).
  "pymol: resn HEM extend 7 [1tqn]": "struct_conn bonds",
  // Deliberate: `not X` is everything when X is empty. Mol*'s
  // query-in-selection returns nothing, even with :in-complement.
  "pymol: elem S or (polymer and not hydro) [1bna]": "complement of nothing",
  "pymol: elem S or (polymer and not hydro) [1crn]": "complement of nothing",
  "pymol: elem S or (polymer and not hydro) [1tqn]": "complement of nothing",
  "pymol: elem S or (polymer and not hydro) [4c7r]": "complement of nothing",
  "pymol: not resn CYS [1bna]": "complement of nothing",
  "vmd: not protein [1bna]": "complement of nothing",
  // Deliberate: carbon weighs 12.011. Mol*'s table lists boron's 10.81.
  "vmd: mass 12 to 17.5 [1bna]": "carbon mass",
  "vmd: mass 12 to 17.5 [1crn]": "carbon mass",
  "vmd: mass 12 to 17.5 [1ejg]": "carbon mass",
  "vmd: mass 12 to 17.5 [1tqn]": "carbon mass",
  "vmd: mass 12 to 17.5 [4c7r]": "carbon mass",
};

// Single-model entries only: our rows then equal Mol*'s source indices.
const STRUCTURES = ["1crn", "1tqn", "1bna", "1ejg", "4c7r"] as const;

async function load(
  id: string,
): Promise<{ ours: StructureData; mol: Structure }> {
  const bytes = await Deno.readFile(
    new URL(`../../packages/io/test/fixtures/${id}.bcif`, import.meta.url),
  );
  const ours = await structureFromBcif(bytes);
  const parsed = await CIF.parseBinary(bytes).run();
  if (parsed.isError) throw new Error(String(parsed));
  const trajectory = await trajectoryFromMmCIF(parsed.result.blocks[0]).run();
  const model = await Task.resolveInContext(trajectory.getFrameAtIndex(0));
  const mol = Structure.ofModel(model);
  // Secondary structure from the file's own annotation, as @molgpu/io reads it.
  await SecondaryStructureProvider.attach(
    { runtime: SyncRuntimeContext, assetManager: new AssetManager() },
    mol,
    { type: { name: "model", params: {} } },
  );
  return { ours, mol };
}

function molstarRows(
  language: SelectionLanguage,
  text: string,
  mol: Structure,
): number[] {
  const selection = Script.getStructureSelection(
    Script.toExpression(Script(text, language)),
    mol,
  );
  const rows = new Set<number>();
  StructureElement.Loci.forEachLocation(
    StructureSelection.toLociWithSourceUnits(selection),
    (l) => void rows.add(StructureProperties.atom.sourceIndex(l)),
  );
  return [...rows].sort((a, b) => a - b);
}

Deno.test("selections match Mol*'s evaluator atom for atom", async () => {
  const structures = new Map<string, Awaited<ReturnType<typeof load>>>();
  for (const id of STRUCTURES) structures.set(id, await load(id));

  const unsupported: string[] = [], molstarFails: string[] = [];
  const mismatches: string[] = [];
  let compared = 0;
  const silence = console.error; // Mol*'s transpile() logs before throwing
  for (const [language, text] of CASES) {
    const label = `${language}: ${text}`;
    let expr;
    try {
      expr = await parseSelection(language, text, {
        symbols: supportedSymbols,
      });
    } catch (error) {
      if (!(error instanceof SelectionParseError)) throw error;
      (error.message.includes("is not supported") ? unsupported : molstarFails)
        .push(label);
      continue;
    }
    const query = compile(expr);
    for (const [id, { ours, mol }] of structures) {
      let expected: number[];
      console.error = () => {};
      try {
        expected = molstarRows(language, text, mol);
      } catch {
        molstarFails.push(`${label} [${id}]`);
        continue;
      } finally {
        console.error = silence;
      }
      const actual = [...resolve(query, ours).indices];
      compared++;
      const same = actual.length === expected.length &&
        actual.every((x, k) => x === expected[k]);
      if (!same) mismatches.push(`${label} [${id}]`);
    }
  }
  console.log(
    `compared ${compared} (selection, structure) pairs; ` +
      `${unsupported.length} strings outside the supported symbols; ` +
      `${molstarFails.length} Mol* parser/evaluator failures`,
  );
  for (const u of unsupported) console.log(`  unsupported  ${u}`);
  for (const f of molstarFails) console.log(`  mol* fails   ${f}`);
  assertEquals(mismatches.sort(), Object.keys(KNOWN_DIFFERENCES).sort());
});
