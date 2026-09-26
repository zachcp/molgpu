import type { StructureInput } from "@molgpu/table";
import type { Mutable } from "../../../test/support/mutable.ts";

// A small but adversarial structure for selection contract tests.
//
//   atom:    0    1    2    3    4    5
//   element  N    C    S    C    S    O   (atomic numbers 7,6,16,6,16,8)
//   residue  0    0    1    1    2    2
//   x        0    1    2    3   10   11   (y=z=0)
//   comp     CYS  CYS  GLY  GLY  CYS  CYS  (residues 0,2 are CYS)
//   bonds    0-1, 2-3, 4-5
//
// So: element(16) = {2,4}; comp(['CYS']) residues = {0,2}, its atoms = {0,1,4,5};
// within(1.5, element(16)) = {1,2,3,4,5} (atom 0 is 2 A from the nearest sulfur).
export function fixture(
  { firstElement = 7 }: { firstElement?: number } = {},
): Mutable<StructureInput> {
  return {
    positions: Float32Array.from([
      0,
      0,
      0,
      1,
      0,
      0,
      2,
      0,
      0,
      3,
      0,
      0,
      10,
      0,
      0,
      11,
      0,
      0,
    ]),
    topology: {
      atoms: {
        count: 6,
        id: ["1", "2", "3", "4", "5", "6"],
        name: ["N", "CB", "SG", "CB", "SG", "O"],
        altloc: ["", "", "", "", "", ""],
        residue: Uint32Array.from([0, 0, 1, 1, 2, 2]),
        element: Uint8Array.from([firstElement, 6, 16, 6, 16, 8]),
        occupancy: Float32Array.from([1, 1, 1, 1, 1, 1]),
        bfactor: new Float32Array(6),
      },
      residues: {
        count: 3,
        chain: Uint32Array.from([0, 0, 0]),
        labelSeq: Int32Array.from([1, 2, 3]),
        authSeq: ["1", "2", "3"],
        insertionCode: ["", "", ""],
        comp: ["CYS", "GLY", "CYS"],
        polymer: ["protein", "protein", "protein"],
      },
      chains: {
        count: 1,
        model: Int32Array.from([1]),
        labelId: ["A"],
        authId: ["A"],
      },
      bonds: {
        count: 3,
        a: Uint32Array.from([0, 2, 4]),
        b: Uint32Array.from([1, 3, 5]),
        order: Uint8Array.from([1, 1, 1]),
        source: ["explicit", "explicit", "explicit"],
        flags: Uint8Array.from([1, 1, 1]), // covalent
      },
      instances: {
        count: 1,
        chain: Uint32Array.from([0]),
        operatorId: ["identity"],
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
        ]),
      },
    },
  };
}
