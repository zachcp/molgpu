// Original synthetic fixture, covered by the repository MIT license.
// Values exercise display semantics; these are not ProteinMPNN predictions.
import { createStructure, residueKey } from "@molgpu/table";
import type { StructureData } from "@molgpu/table";

export const alphabet = [..."ACDEFGHIKLMNPQRSTVWYX"];
const sequence = [..."ACDEFGHIKLMNP"];
const count = sequence.length;
const names = [
  "ALA",
  "CYS",
  "ASP",
  "GLU",
  "PHE",
  "GLY",
  "HIS",
  "ILE",
  "LYS",
  "LEU",
  "MET",
  "ASN",
  "PRO",
];
export const data = createStructure({
  positions: Float32Array.from(sequence.flatMap((_, row) => [
    row < 10 ? (row - 4) * 3.6 : (row - 11) * 3.6,
    row < 10 ? Math.sin(row * 0.7) * 2 : -8,
    Math.cos(row * 0.7) * 2,
  ])),
  topology: {
    atoms: {
      count,
      id: sequence.map((_, i) => String(i + 1)),
      name: sequence.map(() => "CA"),
      altloc: sequence.map(() => ""),
      residue: Uint32Array.from(sequence.map((_, i) => i)),
      element: new Uint8Array(count).fill(6),
      occupancy: new Float32Array(count).fill(1),
      bfactor: new Float32Array(count),
    },
    residues: {
      count,
      chain: Uint32Array.from(sequence.map((_, i) => i < 10 ? 0 : 1)),
      labelSeq: Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 1, 2, 3]),
      authSeq: [
        "1",
        "2",
        "3",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "11",
        "1",
        "2",
        "3",
      ],
      insertionCode: sequence.map((_, i) => i === 3 ? "A" : ""),
      comp: names,
      polymer: sequence.map(() => "protein" as const),
    },
    chains: {
      count: 2,
      model: Int32Array.of(1, 1),
      labelId: ["A", "B"],
      authId: ["A", "B"],
    },
    bonds: {
      count: 0,
      a: new Uint32Array(),
      b: new Uint32Array(),
      order: new Uint8Array(),
      source: [],
    },
    instances: {
      count: 2,
      chain: Uint32Array.of(0, 1),
      operatorId: ["1", "1"],
      transform: Float64Array.from([
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
      ]),
    },
  },
});

export const fixture = {
  semantics: "probability" as const,
  alphabet,
  keys: sequence.map((_, i) => residueKey(data, i)),
  missing: Uint8Array.from(sequence.map((_, i) => i === 4 ? 1 : 0)),
  native: sequence,
  values: Float32Array.from(sequence.flatMap((aa, row) => {
    if (row === 4) return alphabet.map(() => 0);
    const p = 0.15 + row * 0.04;
    return alphabet.map((letter, category) =>
      letter === aa
        ? p
        : category === (alphabet.indexOf(aa) + 1) % alphabet.length
        ? 0.25
        : (0.75 - p) / 19
    );
  })),
  provenance: {
    source: "authored display fixture",
    revision: 1,
    license: "MIT",
    calibration: "none",
  },
};

// Sketch validation only, deliberately not a public package API.
export function validate(input: typeof fixture, structure: StructureData) {
  const n = structure.topology.residues.count;
  const k = input.alphabet.length;
  if (
    input.keys.length !== n || input.missing.length !== n ||
    input.values.length !== n * k
  ) throw new Error("shape mismatch");
  if (new Set(input.alphabet).size !== k) {
    throw new Error("duplicate categories");
  }
  for (let row = 0; row < n; row++) {
    if (input.keys[row] !== residueKey(structure, row)) {
      throw new Error("layout identity mismatch");
    }
    if (input.missing[row]) continue;
    let total = 0;
    for (const p of input.values.subarray(row * k, (row + 1) * k)) {
      if (!Number.isFinite(p) || p < 0 || p > 1) {
        throw new Error("invalid probability");
      }
      total += p;
    }
    if (Math.abs(total - 1) > 1e-5) {
      throw new Error("probability row must sum to one");
    }
  }
}

// Coordinate windows are independent of imported-value missingness.
// Only fully present consecutive labelSeq runs in one chain/model are eligible.
export function windows(structure: StructureData, width = 7) {
  const { residues } = structure.topology;
  const result: number[][] = [];
  for (let start = 0; start + width <= residues.count; start++) {
    const rows = Array.from({ length: width }, (_, i) => start + i);
    if (
      rows.every((row, i) =>
        residues.chain[row] === residues.chain[start] &&
        residues.labelSeq[row] === residues.labelSeq[start] + i &&
        residues.labelSeq[start] >= 0
      )
    ) result.push(rows);
  }
  return result;
}
validate(fixture, data);
