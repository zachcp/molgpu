import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  activeAtoms,
  attributeColumn,
  BOND_FLAGS,
  createStructure,
  type StructureData,
  withAttributes,
} from "@molgpu/table";
import { applyPqr, structureFromBcif } from "@molgpu/io";
import {
  gasteigerCharges,
  residueNetCharge,
  templateCharges,
} from "../src/index.ts";

const corpus = async (id: string) =>
  structureFromBcif(
    await Deno.readFile(
      new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url),
    ),
  );
const residueSums = (data: StructureData, values: Float32Array) => {
  const sum = new Float64Array(data.topology.residues.count);
  for (const i of activeAtoms(data)) {
    sum[data.topology.atoms.residue[i]] += values[i];
  }
  return sum;
};

Deno.test("AMBER templates match independent PDB2PQR 1crn charges per heavy atom", async () => {
  const data = await corpus("1crn");
  const result = templateCharges(data);
  const pqr = await Deno.readTextFile(
    new URL("../../io/test/fixtures/1crn-amber.pqr", import.meta.url),
  );
  const oracle =
    attributeColumn(applyPqr(data, pqr).data, "partialCharge")!.values;
  assertEquals(result.report.unmatched, []);
  assertEquals(result.report.incomplete, []);
  for (let i = 0; i < oracle.length; i++) {
    assertAlmostEquals(result.values[i], oracle[i], 1e-4);
  }
  // Independent AMBER values: terminal THR N carries three H after folding;
  // internal ALA carbonyl O is -0.5679 e (Cornell et al., 1995).
  assertAlmostEquals(result.values[0], 0.7614, 1e-4);
  const internalAlaO = data.topology.atoms.name.findIndex((name, i) =>
    name === "O" &&
    data.topology.residues.comp[data.topology.atoms.residue[i]] === "ALA"
  );
  assertAlmostEquals(result.values[internalAlaO], -0.5679, 1e-4);
  assertAlmostEquals(result.report.netCharge, 0, 1e-3);
  for (const charge of residueSums(data, result.values)) {
    assertAlmostEquals(charge, Math.round(charge), 1e-3);
  }
});

Deno.test("standard corpus atoms, DNA aliases, ions and active net charges", async () => {
  for (const id of ["1crn", "1a4y", "1tqn", "4c7r", "1bna"]) {
    const data = await corpus(id), result = templateCharges(data);
    const standard = result.report.unmatched.filter((item) =>
      data.topology.residues.polymer.some((kind, r) =>
        kind !== "other" && data.topology.residues.comp[r] === item.comp
      )
    );
    assertEquals(standard, [], `${id}: standard atoms missing template names`);
    if (id === "4c7r") {
      assertEquals(
        result.report.ions.some((ion) =>
          ion.charge === -1 && ion.source === "ccd:ion"
        ),
        true,
      );
    }
    if (id === "1bna") {
      assertAlmostEquals(result.report.netCharge, -22, 1e-3);
      assertEquals(
        gasteigerCharges(data, { exclude: result.assigned }).report.refused,
        [],
      );
    }
    if (id === "1tqn") {
      assertEquals(result.report.gaps.length > 0, true);
      assertEquals(
        gasteigerCharges(data, { exclude: result.assigned }).report.refused
          .some((item) =>
            item.reason === "missing-parameters" &&
            item.residues.some((key) => key.includes("HEM"))
          ),
        true,
      );
    }
    if (id === "1a4y") assertEquals(result.report.incomplete.length > 0, true);
  }
  for (const id of ["1ejg", "2k39"]) {
    const data = await corpus(id), result = templateCharges(data);
    if (id === "1ejg") {
      const { atoms } = data.topology;
      const og1 = (residue: number) =>
        atoms.name.findIndex((name, i) =>
          name === "OG1" && atoms.residue[i] === residue
        );
      // Residue 1 has HG1, while residue 38 has other hydrogens but no HG1.
      // Only the latter folds that hydrogen's +0.4102 e onto OG1.
      assertAlmostEquals(result.values[og1(1)], -0.6761, 1e-4);
      assertAlmostEquals(result.values[og1(38)], -0.2659, 1e-4);
    }
    const charged = withAttributes(data, {
      partialCharge: {
        domain: "atom",
        kind: "scalar",
        values: result.values,
        provenance: "template:amber-pdb2pqr",
      },
    });
    const residue = residueNetCharge(charged);
    const expected = residueSums(data, result.values);
    for (let r = 0; r < residue.length; r++) {
      assertAlmostEquals(residue[r], expected[r], 1e-5);
    }
    assertAlmostEquals(
      result.report.netCharge,
      expected.reduce((a, b) => a + b, 0),
      1e-4,
    );
  }
});

function ligand(
  elements: number[],
  edges: [number, number, number][],
  comp = "LIG",
  polymer: "other" | "protein" = "other",
): StructureData {
  const n = elements.length;
  return createStructure({
    positions: Float32Array.from(
      { length: n * 3 },
      (_, i) => i % 3 === 0 ? i / 3 : 0,
    ),
    topology: {
      atoms: {
        count: n,
        id: elements.map((_, i) => String(i + 1)),
        name: elements.map((_, i) => `A${i}`),
        altloc: elements.map(() => ""),
        residue: new Uint32Array(n),
        element: Uint8Array.from(elements),
        occupancy: new Float32Array(n).fill(1),
        bfactor: new Float32Array(n),
      },
      residues: {
        count: 1,
        chain: Uint32Array.of(0),
        labelSeq: Int32Array.of(1),
        authSeq: ["1"],
        insertionCode: [""],
        comp: [comp],
        polymer: [polymer],
      },
      chains: {
        count: 1,
        model: Int32Array.of(1),
        labelId: ["A"],
        authId: ["A"],
      },
      bonds: {
        count: edges.length,
        a: Uint32Array.from(edges, (e) => e[0]),
        b: Uint32Array.from(edges, (e) => e[1]),
        order: Uint8Array.from(edges, (e) => e[2]),
        source: edges.map(() => "explicit" as const),
      },
      instances: {
        count: 0,
        chain: new Uint32Array(),
        operatorId: [],
        transform: new Float64Array(),
      },
    },
  });
}

Deno.test("Gasteiger folded heavy charges match RDKit 2025.09.2 fixtures", () => {
  const fixtures = [
    {
      elements: [6, 6, 8],
      edges: [[0, 1, 1], [1, 2, 1]],
      expected: [0.03428138, 0.15236002, -0.18664140],
    }, // CCO
    {
      elements: [6, 6, 8, 8],
      edges: [[0, 1, 1], [1, 2, 2], [1, 3, 1]],
      expected: [0.13831267, 0.29968455, -0.25282043, -0.1851768],
    }, // CC(=O)O
    {
      elements: [6, 7, 6],
      edges: [[0, 1, 1], [1, 2, 1]],
      expected: [0.10061475, -0.20122949, 0.10061475],
    }, // CNC
    {
      elements: [6, 6, 6, 6, 6, 6],
      edges: [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 4, 4], [4, 5, 4], [5, 0, 4]],
      expected: [0, 0, 0, 0, 0, 0],
    }, // benzene
  ] as const;
  for (const fixture of fixtures) {
    const result = gasteigerCharges(ligand(
      [...fixture.elements],
      fixture.edges.map((edge) => [...edge] as [number, number, number]),
    ));
    assertEquals(result.report.refused, []);
    for (let i = 0; i < fixture.expected.length; i++) {
      assertAlmostEquals(result.values[i], fixture.expected[i], 1e-3);
    }
  }
});

Deno.test("Gasteiger refuses unknown orders, missing parameters and modified polymers", () => {
  assertEquals(
    gasteigerCharges(ligand([6, 8], [[0, 1, 0]])).report.refused[0].reason,
    "unknown-bond-order",
  );
  assertEquals(
    gasteigerCharges(ligand([26, 6], [[0, 1, 1]])).report.refused[0].reason,
    "missing-parameters",
  );
  assertEquals(
    gasteigerCharges(ligand([6, 8], [[0, 1, 3]])).report.refused[0].reason,
    "unsupported-valence",
  );
  assertEquals(
    gasteigerCharges(ligand([6, 8], [[0, 1, 1]], "MSE", "protein"))
      .report.refused[0].reason,
    "modified-polymer",
  );
  const covered = gasteigerCharges(ligand([6, 8], [[0, 1, 1]]), {
    exclude: Uint8Array.of(1, 0),
  });
  assertEquals(covered.report.refused[0].reason, "template-covered");
  // A component the templates fully charged (water, ions) is not a refusal.
  const water = gasteigerCharges(ligand([6, 8], [[0, 1, 1]]), {
    exclude: Uint8Array.of(1, 1),
  });
  assertEquals(water.report.refused, []);
});

Deno.test("Gasteiger seeds conjugated formal charge like RDKit acetate", () => {
  const data = ligand([6, 6, 8, 8], [[0, 1, 1], [1, 2, 2], [1, 3, 1]]);
  const charged = withAttributes(data, {
    formalCharge: {
      domain: "atom",
      kind: "code",
      values: Int8Array.of(0, 0, 0, -1),
      provenance: "user",
    },
  });
  const result = gasteigerCharges(charged);
  for (
    const [i, expected] of [0.06267546, 0.0382786, -0.55047703, -0.55047703]
      .entries()
  ) {
    assertAlmostEquals(result.values[i], expected, 1e-3);
  }
});

Deno.test("Gasteiger treats covalently joined het residues as one component", () => {
  const base = ligand([6, 8], [[0, 1, 1]]);
  const split = createStructure({
    positions: base.positions,
    topology: {
      ...base.topology,
      atoms: { ...base.topology.atoms, residue: Uint32Array.of(0, 1) },
      residues: {
        count: 2,
        chain: Uint32Array.of(0, 0),
        labelSeq: Int32Array.of(1, 2),
        authSeq: ["1", "2"],
        insertionCode: ["", ""],
        comp: ["NAG", "NAG"],
        polymer: ["other", "other"],
      },
    },
  });
  const glycan = gasteigerCharges(split);
  assertEquals([...glycan.assigned], [1, 1]);
  assertEquals(glycan.report.refused, []);
  const linked = createStructure({
    positions: split.positions,
    topology: {
      ...split.topology,
      residues: {
        ...split.topology.residues,
        polymer: ["protein", "other"],
        comp: ["MSE", "NAG"],
      },
    },
  });
  assertEquals(
    gasteigerCharges(linked).report.refused[0].reason,
    "polymer-linked",
  );
});

// As io reads chem_comp_bond: Kekulé orders in links, aromatic as a flag.
function componentLigand(
  elements: readonly number[],
  edges: readonly (readonly [number, number, number, number])[],
  formal?: readonly number[],
): StructureData {
  const base = ligand([...elements], []);
  const data = createStructure({
    positions: base.positions,
    topology: {
      ...base.topology,
      links: {
        count: edges.length,
        a: Uint32Array.from(edges, (e) => e[0]),
        b: Uint32Array.from(edges, (e) => e[1]),
        order: Uint8Array.from(edges, (e) => e[2]),
        flags: Uint8Array.from(
          edges,
          (e) => BOND_FLAGS.covalent | (e[3] ? BOND_FLAGS.aromatic : 0),
        ),
        source: edges.map(() => "component" as const),
      },
    },
  });
  return formal
    ? withAttributes(data, {
      formalCharge: {
        domain: "atom",
        kind: "code",
        values: Int8Array.from(formal),
        provenance: "user",
      },
    })
    : data;
}

// RDKit 2026.03.6 from SMILES, heavy atom plus its implicit-H charges.
const COMPONENT_FIXTURES = {
  pyrrole: {
    elements: [6, 6, 6, 7, 6],
    edges: [[0, 1, 1, 1], [1, 2, 2, 1], [2, 3, 1, 1], [3, 4, 1, 1], [
      4,
      0,
      2,
      1,
    ]],
    expected: [0.019137, 0.019137, 0.082026, -0.202326, 0.082026],
  },
  thiophene: {
    elements: [6, 6, 6, 16, 6],
    edges: [[0, 1, 1, 1], [1, 2, 2, 1], [2, 3, 1, 1], [3, 4, 1, 1], [
      4,
      0,
      2,
      1,
    ]],
    expected: [0.011626, 0.011626, 0.064602, -0.152454, 0.064602],
  },
  furan: {
    elements: [6, 6, 6, 8, 6],
    edges: [[0, 1, 1, 1], [1, 2, 2, 1], [2, 3, 1, 1], [3, 4, 1, 1], [
      4,
      0,
      2,
      1,
    ]],
    expected: [0.041799, 0.041799, 0.19452, -0.472638, 0.19452],
  },
  indole: {
    elements: [6, 6, 6, 6, 7, 6, 6, 6, 6],
    edges: [
      [0, 1, 2, 1],
      [1, 2, 1, 1],
      [2, 3, 2, 1],
      [3, 4, 1, 1],
      [4, 5, 1, 1],
      [5, 6, 2, 1],
      [6, 7, 1, 1],
      [7, 8, 2, 1],
      [8, 0, 1, 1],
      [7, 3, 1, 1],
    ],
    expected: [
      0.000773,
      0.002187,
      0.026477,
      0.045339,
      -0.195252,
      0.083258,
      0.027734,
      -0.000655,
      0.010138,
    ],
  },
  adenine: {
    elements: [7, 6, 7, 6, 7, 6, 7, 6, 7, 6],
    edges: [
      [0, 1, 1, 0],
      [1, 2, 1, 1],
      [2, 3, 2, 1],
      [3, 4, 1, 1],
      [4, 5, 2, 1],
      [5, 6, 1, 1],
      [6, 7, 1, 1],
      [7, 8, 2, 1],
      [8, 9, 1, 1],
      [9, 1, 2, 1],
      [9, 5, 1, 1],
    ],
    expected: [
      -0.066082,
      0.154613,
      -0.217354,
      0.226356,
      -0.21674,
      0.162275,
      -0.16001,
      0.198703,
      -0.23124,
      0.149478,
    ],
  },
  methanesulfonamide: {
    elements: [6, 16, 7, 8, 8],
    edges: [[0, 1, 1, 0], [1, 2, 1, 0], [1, 3, 2, 0], [1, 4, 2, 0]],
    expected: [0.175946, 0.205681, 0.044283, -0.212955, -0.212955],
  },
  methylPhosphate: {
    elements: [6, 8, 15, 8, 8, 8],
    edges: [[0, 1, 1, 0], [1, 2, 1, 0], [2, 3, 2, 0], [2, 4, 1, 0], [
      2,
      5,
      1,
      0,
    ]],
    expected: [0.208389, -0.290497, 0.468805, -0.228345, -0.079176, -0.079176],
  },
  enolate: {
    elements: [6, 6, 8],
    edges: [[0, 1, 1, 0], [1, 2, 2, 0]],
    formal: [-1, 0, 0],
    expected: [-0.711459, 0.049707, -0.338248],
  },
} as const;

Deno.test("Gasteiger matches RDKit on chem_comp_bond Kekulé aromatics, S and P", () => {
  for (const [name, fixture] of Object.entries(COMPONENT_FIXTURES)) {
    const result = gasteigerCharges(componentLigand(
      fixture.elements,
      fixture.edges,
      "formal" in fixture ? fixture.formal : undefined,
    ));
    assertEquals(result.report.refused, [], name);
    for (let i = 0; i < fixture.expected.length; i++) {
      assertAlmostEquals(result.values[i], fixture.expected[i], 1e-3, name);
    }
  }
});

Deno.test("Gasteiger kekulizes order-4 bonds and refuses an unknown tautomer", () => {
  const aromatic = (key: "pyrrole" | "indole") => {
    const fixture = COMPONENT_FIXTURES[key];
    return gasteigerCharges(ligand(
      [...fixture.elements],
      fixture.edges.map((e) => [e[0], e[1], e[3] ? 4 : e[2]]),
    ));
  };
  for (const key of ["pyrrole", "indole"] as const) {
    const result = aromatic(key);
    assertEquals(result.report.refused, [], key);
    COMPONENT_FIXTURES[key].expected.forEach((x, i) =>
      assertAlmostEquals(result.values[i], x, 1e-3, key)
    );
  }
  // Imidazole: either nitrogen could carry the hydrogen.
  const imidazole = gasteigerCharges(ligand([6, 6, 7, 6, 7], [
    [0, 1, 4],
    [1, 2, 4],
    [2, 3, 4],
    [3, 4, 4],
    [4, 0, 4],
  ]));
  assertEquals(imidazole.report.refused[0].reason, "unknown-bond-order");
  assertEquals(imidazole.assigned.every((x) => x === 0), true);
});

Deno.test("Gasteiger charges each conformer of a partial-altloc ligand", () => {
  // CCO with the O in two alternate locations; both bond to the shared C.
  const base = ligand([6, 6, 8, 8], [[0, 1, 1], [1, 2, 1], [1, 3, 1]]);
  const data = createStructure({
    positions: base.positions,
    topology: {
      ...base.topology,
      atoms: { ...base.topology.atoms, altloc: ["", "", "A", "B"] },
    },
  });
  const result = gasteigerCharges(data);
  assertEquals(result.report.refused, []);
  const ethanol = [0.03428138, 0.15236002, -0.18664140, -0.18664140];
  ethanol.forEach((x, i) => assertAlmostEquals(result.values[i], x, 1e-3));
});

Deno.test("Templates use CCD ion charges, including alternate locations", () => {
  const ion = (comp: string, altlocs: string[]) => {
    const n = altlocs.length;
    return templateCharges(createStructure({
      positions: new Float32Array(3 * n),
      topology: {
        atoms: {
          count: n,
          id: altlocs.map((_, i) => String(i + 1)),
          name: altlocs.map(() => comp),
          altloc: altlocs,
          residue: new Uint32Array(n),
          element: new Uint8Array(n).fill(26),
          occupancy: new Float32Array(n).fill(1 / n),
          bfactor: new Float32Array(n),
        },
        residues: {
          count: 1,
          chain: Uint32Array.of(0),
          labelSeq: Int32Array.of(1),
          authSeq: ["1"],
          insertionCode: [""],
          comp: [comp],
          polymer: ["other"],
        },
        chains: {
          count: 1,
          model: Int32Array.of(1),
          labelId: ["A"],
          authId: ["A"],
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
    }));
  };
  assertEquals([...ion("FE", [""]).values], [3]);
  assertEquals([...ion("FE2", [""]).values], [2]);
  const split = ion("FE", ["A", "B"]);
  assertEquals([...split.values], [3, 3]);
  assertEquals(split.report.netCharge, 3);
  assertEquals(split.report.unmatched, []);
});
