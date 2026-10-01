import {
  createStructure,
  type StructureData,
  type Topology,
  withAttributes,
} from "@molgpu/table";

/** Two models, alternate guide atoms and ligands; source rows stay fixed. */
export function selectionData(extra = false): StructureData {
  const input = {
    positions: Float32Array.of(
      0,
      0,
      0,
      0.1,
      0,
      0,
      2,
      0.2,
      0,
      3,
      0,
      1,
      100,
      0,
      0,
      100.1,
      0,
      0,
      0.3,
      0.2,
      0,
      0.4,
      0,
      1,
    ),
    topology: {
      atoms: {
        count: 8,
        id: ["1", "2", "3", "4", "5", "6", "7", "8"],
        name: ["CA", "CA", "C1", "O1", "CA", "CA", "C1", "O1"],
        altloc: ["A", "B", "", "", "A", "B", "", ""],
        residue: Uint32Array.of(0, 0, 1, 1, 2, 2, 3, 3),
        element: Uint8Array.of(6, 6, 6, 8, 6, 6, 6, 8),
        occupancy: Float32Array.of(0.8, 0.2, 1, 1, 0.8, 0.2, 1, 1),
        bfactor: new Float32Array(8),
        radius: new Float32Array(8).fill(1),
      },
      residues: {
        count: 4,
        chain: Uint32Array.of(0, 0, 1, 1),
        labelSeq: Int32Array.of(1, 2, 1, 2),
        authSeq: ["1", "2", "1", "2"],
        insertionCode: ["", "", "", ""],
        comp: ["GLY", "HEM", "GLY", "HEM"],
        polymer: ["protein", "other", "protein", "other"],
      },
      chains: {
        count: 2,
        model: Int32Array.of(1, 2),
        labelId: ["A", "A"],
        authId: ["A", "A"],
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
  } satisfies { positions: Float32Array; topology: Topology };
  if (extra) {
    input.positions = Float32Array.from([...input.positions, 20, 0, 0]);
    const atoms = input.topology.atoms;
    atoms.count++;
    atoms.id.push("9");
    atoms.name.push("NX");
    atoms.altloc.push("");
    atoms.residue = Uint32Array.from([...atoms.residue, 1]);
    atoms.element = Uint8Array.from([...atoms.element, 7]);
    atoms.occupancy = Float32Array.from([...atoms.occupancy, 1]);
    atoms.bfactor = Float32Array.from([...atoms.bfactor, 0]);
    atoms.radius = Float32Array.from([...atoms.radius, 1]);
  }
  const data = createStructure(input);
  return withAttributes(data, {
    "gpu:a": {
      domain: "atom",
      kind: "scalar",
      values: new Float32Array(data.topology.atoms.count).fill(100),
      provenance: "user",
    },
  });
}
