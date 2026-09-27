import {
  assertAlmostEquals,
  assertEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";
import {
  attributeColumn,
  createStructure,
  type StructureInput,
} from "@molgpu/table";
import { parsePDB } from "molstar/lib/mol-io/reader/pdb/parser.js";
import { pdbToMmCif } from "molstar/lib/mol-model-formats/structure/pdb/to-cif.js";
import {
  applyPqr,
  IoError,
  structureFromBcif,
  structureFromPqr,
} from "../src/index.ts";

const fixture = (name: string) =>
  new URL(`./fixtures/${name}`, import.meta.url);
const CRN_PQR = await Deno.readTextFile(fixture("1crn-amber.pqr"));
const sum = (values: ArrayLike<number>): number => {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
};

Deno.test("structureFromPqr reads PDB2PQR's AMBER output for 1crn", async () => {
  const { data, report } = await structureFromPqr(CRN_PQR);
  assertEquals(data.topology.atoms.count, 642);
  assertEquals(data.topology.residues.count, 46);
  // PDB2PQR 2.1.2 writes no chain IDs; the structure keeps them blank.
  assertEquals([...data.topology.chains.authId], [""]);
  const charge = attributeColumn(data, "partialCharge")!;
  assertEquals(charge.provenance, "imported:pqr");
  assertAlmostEquals(sum(charge.values), 0, 1e-3); // REMARK 6: total 0.0000 e
  // AMBER gives hydroxyl hydrogens radius 0: kept raw, displayed with H's radius.
  const raw = attributeColumn(data, "pqr:radius")!;
  assertEquals(report.radiusFallbacks, 10);
  const hg1 = data.topology.atoms.name.indexOf("HG1");
  assertEquals(raw.values[hg1], 0);
  assertEquals(data.topology.atoms.element[hg1], 1);
  assertAlmostEquals(data.topology.atoms.radius![hg1], 1.1, 1e-6);
  assertEquals(
    data.topology.residues.polymer.every((p) => p === "protein"),
    true,
  );
});

Deno.test("structureFromPqr agrees with Mol*'s PQR reader on column-aligned records", async () => {
  const pdb = await parsePDB(CRN_PQR, "1crn", "pqr").run();
  if (pdb.isError) throw new Error(pdb.message);
  const cif = await pdbToMmCif(pdb.result);
  const site = cif.categories.atom_site;
  const molstar = Array.from(
    { length: site.rowCount },
    (_, i) => site.getField("partial_charge")!.float(i),
  );
  const { data } = await structureFromPqr(new TextEncoder().encode(CRN_PQR));
  assertEquals(
    [...attributeColumn(data, "partialCharge")!.values],
    [...Float32Array.from(molstar)],
  );
  assertEquals(
    data.topology.atoms.name,
    Array.from(
      { length: site.rowCount },
      (_, i) => site.getField("label_atom_id")!.str(i),
    ),
  );
});

// Whitespace-separated, as PDB2PQR writes once columns overflow: 6-digit
// serials glued to the record name, 4-digit coordinates, chain IDs, an
// insertion code, force-field names and a chain reused after TER.
const WIDE = `REMARK wide
ATOM      1  N   NALA A   1   -1234.567 2345.678 -3456.789 0.1414 1.8240
ATOM      2  CA  NALA A   1   -1233.100 2345.600 -3456.700 0.0962 1.9080
ATOM      3  SG  CYX A  52A  -1230.000 2340.000 -3450.000 -0.1081 2.0000
ATOM100000  HG1 SER A  53   -1229.000-2339.000 -3449.000 0.4275 0.0000
TER
HETATM100001 ZN   ZN A 900     10.000   10.000   10.000 2.0000 1.1000
END
`;

Deno.test("structureFromPqr tokenises wide, chain-labelled PDB2PQR records", async () => {
  const { data, report } = await structureFromPqr(WIDE);
  const { atoms, residues, chains } = data.topology;
  assertEquals(atoms.count, 5);
  assertAlmostEquals(data.positions[0], -1234.567, 1e-3);
  assertAlmostEquals(data.positions[10], -2339, 1e-3); // glued y
  assertEquals([...residues.comp], ["NALA", "CYX", "SER", "ZN"]);
  assertEquals([...residues.insertionCode], ["", "A", "", ""]);
  assertEquals([...residues.polymer], [
    "protein",
    "protein",
    "protein",
    "other",
  ]);
  assertEquals([...residues.het!], [0, 0, 0, 1]);
  // Chain A reused after TER is a new chain, labelled as Mol* does.
  assertEquals([...chains.labelId], ["A", "A_1"]);
  assertEquals(
    [...attributeColumn(data, "partialCharge")!.values].map((v) =>
      +v.toFixed(4)
    ),
    [0.1414, 0.0962, -0.1081, 0.4275, 2],
  );
  assertEquals(report.radiusFallbacks, 1);
});

Deno.test("structureFromPqr rejects malformed input by code", async () => {
  await assertRejects(
    () => structureFromPqr("REMARK nothing\n"),
    IoError,
    "no ATOM",
  );
  await assertRejects(
    () => structureFromPqr("ATOM 1 N ALA 1 0.0 0.0 0.0 0.1\n"),
    IoError,
    "line 1",
  );
  await assertRejects(
    () => structureFromPqr(42 as unknown as string),
    IoError,
    "expected a string",
  );
});

Deno.test("applyPqr folds hydrogens onto a heavy-atom structure and keeps residue charge", async () => {
  const crn = await structureFromBcif(
    await Deno.readFile(fixture("1crn.bcif")),
  );
  const { data, report } = applyPqr(crn, CRN_PQR);
  const values = attributeColumn(data, "partialCharge")!.values;
  assertEquals(report.matched, crn.topology.atoms.count);
  assertEquals(report.unmatchedAtoms, []);
  assertEquals(report.unmatchedRecords, []);
  assertEquals(report.residueDelta, []);
  assertAlmostEquals(sum(values), 0, 1e-3);
  // THR 1 OG1 carries its hydroxyl hydrogen: -0.6764 + 0.4070.
  const og1 = crn.topology.atoms.name.indexOf("OG1");
  assertAlmostEquals(values[og1], -0.6764 + 0.4070, 1e-4);
  // Topology and coordinates are untouched; only attributes advance.
  assertEquals(data.identity, crn.identity);
  assertEquals(data.revision.topology, crn.revision.topology);
});

// Two models of one residue with an altloc pair, plus a second chain.
function hand(chainB = false): StructureInput {
  const names = ["N", "CA", "CA", "N", "CA", "CA"],
    alt = ["", "A", "B", "", "A", "B"];
  const n = chainB ? 7 : 6;
  return {
    positions: new Float32Array(n * 3),
    topology: {
      atoms: {
        count: n,
        id: Array.from({ length: n }, (_, i) => String(i + 1)),
        name: chainB ? [...names, "N"] : names,
        altloc: chainB ? [...alt, ""] : alt,
        residue: Uint32Array.from(
          chainB ? [0, 0, 0, 1, 1, 1, 2] : [0, 0, 0, 1, 1, 1],
        ),
        element: new Uint8Array(n).fill(6),
        occupancy: new Float32Array(n).fill(0.5),
        bfactor: new Float32Array(n),
      },
      residues: {
        count: chainB ? 3 : 2,
        chain: Uint32Array.from(chainB ? [0, 1, 2] : [0, 1]),
        labelSeq: Int32Array.from(chainB ? [1, 1, 1] : [1, 1]),
        authSeq: chainB ? ["1", "1", "1"] : ["1", "1"],
        insertionCode: chainB ? ["", "", ""] : ["", ""],
        comp: chainB ? ["ALA", "ALA", "GLY"] : ["ALA", "ALA"],
        polymer: chainB
          ? ["protein", "protein", "protein"]
          : ["protein", "protein"],
      },
      chains: {
        count: chainB ? 3 : 2,
        model: Int32Array.from(chainB ? [1, 2, 1] : [1, 2]),
        labelId: chainB ? ["A", "A", "B"] : ["A", "A"],
        authId: chainB ? ["A", "A", "B"] : ["A", "A"],
      },
      bonds: {
        count: 0,
        a: new Uint32Array(),
        b: new Uint32Array(),
        order: new Uint8Array(),
        source: [],
      },
      instances: {
        count: 0,
        chain: new Uint32Array(),
        operatorId: [],
        transform: new Float64Array(),
      },
    },
  };
}

Deno.test("applyPqr applies a record to every model and altloc copy", () => {
  const pqr =
    "ATOM 1 N ALA A 1 0.000 0.000 0.000 -0.4157 1.8240\nATOM 2 CA ALA A 1 1.458 0.000 0.000 0.0337 1.9080\n";
  const { data, report } = applyPqr(createStructure(hand()), pqr);
  const values = [...attributeColumn(data, "partialCharge")!.values].map((v) =>
    +v.toFixed(4)
  );
  assertEquals(values, [-0.4157, 0.0337, 0.0337, -0.4157, 0.0337, 0.0337]);
  assertEquals(report.matched, 6);
  assertEquals(report.residueDelta, []);
});

Deno.test("applyPqr refuses chain-less records that match several chains", () => {
  const pqr = "ATOM 1 N ALA 1 0.000 0.000 0.000 -0.4157 1.8240\n";
  assertThrows(
    () => applyPqr(createStructure(hand(true)), pqr),
    IoError,
    "no chain IDs",
  );
});

Deno.test("applyPqr reports unmatched atoms, records and residue deltas", () => {
  // CA is missing from the PQR; OXT is missing from the structure.
  const pqr =
    "ATOM 1 N ALA A 1 0.000 0.000 0.000 -0.4157 1.8240\nATOM 2 OXT ALA A 1 2.000 0.000 0.000 -0.8 1.6\n";
  const { report } = applyPqr(createStructure(hand()), pqr);
  assertEquals(report.matched, 2);
  assertEquals(report.unmatchedAtoms.length, 4);
  assertEquals(report.unmatchedAtoms[0], "A:1::CA");
  assertEquals(report.unmatchedRecords, ["A:1::OXT"]);
  // Every model and altloc copy of the residue is short by OXT.
  assertEquals(
    report.residueDelta.map((d) => `${d.residue}/${d.model}/${d.altloc}`),
    ["A:1:/1/A", "A:1:/1/B", "A:1:/2/A", "A:1:/2/B"],
  );
  for (const d of report.residueDelta) {
    assertAlmostEquals(d.pqr, -1.2157, 1e-4);
    assertAlmostEquals(d.assigned, -0.4157, 1e-4);
  }
});

// Residue copies as [model, chain, seq, atoms as "NAME" or "NAME/altloc"].
function copies(
  list: readonly [number, string, string, readonly string[]][],
): StructureInput {
  const names: string[] = [], alt: string[] = [], residue: number[] = [];
  list.forEach(([, , , atoms], r) => {
    for (const atom of atoms) {
      const [name, code = ""] = atom.split("/");
      names.push(name);
      alt.push(code);
      residue.push(r);
    }
  });
  // One chain row per (model, chain) pair.
  const chainKeys: string[] = [];
  const chainOf = list.map(([model, chain]) => {
    const key = `${model}/${chain}`;
    if (!chainKeys.includes(key)) chainKeys.push(key);
    return chainKeys.indexOf(key);
  });
  const n = names.length, m = list.length;
  return {
    positions: new Float32Array(n * 3),
    topology: {
      atoms: {
        count: n,
        id: Array.from({ length: n }, (_, i) => String(i + 1)),
        name: names,
        altloc: alt,
        residue: Uint32Array.from(residue),
        element: Uint8Array.from(names, (x) => x.startsWith("H") ? 1 : 6),
        occupancy: new Float32Array(n).fill(1),
        bfactor: new Float32Array(n),
      },
      residues: {
        count: m,
        chain: Uint32Array.from(chainOf),
        labelSeq: Int32Array.from(list, ([, , seq]) => +seq),
        authSeq: list.map(([, , seq]) => seq),
        insertionCode: list.map(() => ""),
        comp: list.map(() => "ALA"),
        polymer: list.map(() => "protein"),
      },
      chains: {
        count: chainKeys.length,
        model: Int32Array.from(chainKeys, (k) => +k.split("/")[0]),
        labelId: chainKeys.map((k) => k.split("/")[1]),
        authId: chainKeys.map((k) => k.split("/")[1]),
      },
      bonds: {
        count: 0,
        a: new Uint32Array(),
        b: new Uint32Array(),
        order: new Uint8Array(),
        source: [],
      },
      instances: {
        count: 0,
        chain: new Uint32Array(),
        operatorId: [],
        transform: new Float64Array(),
      },
    },
  };
}

const CH_PQR =
  "ATOM 1 CA ALA A 1 0.000 0.000 0.000 0.2 1.9\nATOM 2 HA ALA A 1 1.000 0.000 0.000 0.1 1.1\n";
const charges = (data: ReturnType<typeof applyPqr>["data"]): number[] =>
  [...attributeColumn(data, "partialCharge")!.values].map((v) => +v.toFixed(4));

Deno.test("applyPqr folds a hydrogen only into the models that lack it", () => {
  const { data, report } = applyPqr(
    createStructure(copies([[1, "A", "1", ["CA", "HA"]], [2, "A", "1", [
      "CA",
    ]]])),
    CH_PQR,
  );
  assertEquals(charges(data), [0.2, 0.1, 0.3]);
  assertEquals(report.unmatchedRecords, []);
  assertEquals(report.residueDelta, []);
});

Deno.test("applyPqr folds a hydrogen only into the altloc conformers that lack it", () => {
  const { data, report } = applyPqr(
    createStructure(copies([[1, "A", "1", ["CA/A", "HA/A", "CA/B"]]])),
    CH_PQR,
  );
  assertEquals(charges(data), [0.2, 0.1, 0.3]);
  assertEquals(report.residueDelta, []);
});

Deno.test("applyPqr reports the conformer a shared heavy atom cannot balance", () => {
  // CA has no altloc, so folding B's missing HA onto it overcharges A.
  const { data, report } = applyPqr(
    createStructure(copies([[1, "A", "1", ["CA", "HA/A", "N/B"]]])),
    CH_PQR,
  );
  assertEquals(charges(data), [0.3, 0.1, 0]);
  assertEquals(
    report.residueDelta.map((d) => [d.model, d.altloc, +d.assigned.toFixed(4)]),
    [[1, "A", 0.4]],
  );
});

Deno.test("applyPqr checks chain-less ambiguity only for residues in the PQR", () => {
  const input = createStructure(copies([
    [1, "A", "1", ["CA"]],
    [1, "A", "2", ["CA"]],
    [1, "B", "1", ["CA"]],
  ]));
  const { data, report } = applyPqr(
    input,
    "ATOM 1 CA ALA 2 0.000 0.000 0.000 0.25 1.9\n",
  );
  assertEquals(charges(data), [0, 0.25, 0]);
  assertEquals(report.matched, 1);
  assertThrows(
    () => applyPqr(input, "ATOM 1 CA ALA 1 0.000 0.000 0.000 0.25 1.9\n"),
    IoError,
    "no chain IDs",
  );
});
