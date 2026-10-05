import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  backboneDihedrals,
  createStructure,
  dihedralAngle,
  PEPTIDE_BREAK_DISTANCE,
} from "@molgpu/table";
import type { StructureInput } from "@molgpu/table";

Deno.test("dihedralAngle follows the IUPAC sign convention", () => {
  // Axis b→c along +z; a on +x. Clockwise (viewed along b→c) is positive.
  const at = (d: number[]) =>
    Float32Array.from([1, 0, 0, 0, 0, 0, 0, 0, 1, ...d]);
  assertAlmostEquals(dihedralAngle(at([0, 1, 1]), 0, 1, 2, 3), 90, 1e-5);
  assertAlmostEquals(dihedralAngle(at([0, -1, 1]), 0, 1, 2, 3), -90, 1e-5);
  assertAlmostEquals(dihedralAngle(at([1, 0, 1]), 0, 1, 2, 3), 0, 1e-5);
  assertEquals(dihedralAngle(at([-1, 0, 1]), 0, 1, 2, 3), 180);
});

/** `count` residues of N/CA/C with peptide C–N bonds of ~1.1 Å, plus a water. */
function peptide(count: number, shift: (k: number) => number = () => 0) {
  const positions: number[] = [], name: string[] = [], residue: number[] = [];
  for (let k = 0; k < count; k++) {
    const x = 3 * k + shift(k);
    positions.push(x, 0, 0, x + 1, 1, 0.3 * k, x + 2, 0, 0.5);
    name.push("N", "CA", "C");
    residue.push(k, k, k);
  }
  positions.push(0, 0, 0);
  name.push("O");
  residue.push(count);
  const atoms = name.length, residues = count + 1;
  const input: StructureInput = {
    positions: Float32Array.from(positions),
    topology: {
      atoms: {
        count: atoms,
        id: name.map((_, i) => String(i + 1)),
        name,
        altloc: name.map(() => ""),
        residue: Uint32Array.from(residue),
        element: Uint8Array.from(
          name,
          (n) => n === "N" ? 7 : n === "O" ? 8 : 6,
        ),
        occupancy: new Float32Array(atoms).fill(1),
        bfactor: new Float32Array(atoms),
      },
      residues: {
        count: residues,
        chain: new Uint32Array(residues),
        labelSeq: Int32Array.from({ length: residues }, (_, k) => k + 1),
        authSeq: Array.from({ length: residues }, (_, k) => String(k + 1)),
        insertionCode: Array.from({ length: residues }, () => ""),
        comp: Array.from(
          { length: residues },
          (_, k) => k < count ? "ALA" : "HOH",
        ),
        polymer: Array.from(
          { length: residues },
          (_, k) => k < count ? "protein" : "other",
        ),
      },
      chains: {
        count: 1,
        model: Int32Array.from([1]),
        labelId: ["A"],
        authId: ["A"],
      },
      bonds: {
        count: 0,
        a: new Uint32Array(0),
        b: new Uint32Array(0),
        order: new Uint8Array(0),
        source: [],
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
  return createStructure(input);
}

Deno.test("phi/psi/omega read the IUPAC backbone atoms; termini and ligands are NaN", () => {
  const data = peptide(4);
  const { phi, psi, omega } = backboneDihedrals(data);
  assertEquals(phi.length, data.topology.residues.count);
  const P = data.positions;
  // Residue k occupies rows 3k (N), 3k+1 (CA), 3k+2 (C).
  for (let k = 0; k < 4; k++) {
    if (k > 0) {
      assertAlmostEquals(
        phi[k],
        dihedralAngle(P, 3 * k - 1, 3 * k, 3 * k + 1, 3 * k + 2),
        1e-4,
      );
    }
    if (k < 3) {
      assertAlmostEquals(
        psi[k],
        dihedralAngle(P, 3 * k, 3 * k + 1, 3 * k + 2, 3 * k + 3),
        1e-4,
      );
      assertAlmostEquals(
        omega[k],
        dihedralAngle(P, 3 * k + 1, 3 * k + 2, 3 * k + 3, 3 * k + 4),
        1e-4,
      );
    }
  }
  assert(Number.isNaN(phi[0]));
  assert(Number.isNaN(psi[3]) && Number.isNaN(omega[3]));
  assert(Number.isNaN(phi[4]) && Number.isNaN(psi[4]), "non-protein residue");
});

Deno.test("a long C–N gap is a chain break; live positions replace the snapshot", () => {
  const broken = peptide(4, (k) => k >= 2 ? 10 : 0);
  const { phi, psi } = backboneDihedrals(broken);
  assert(Number.isNaN(psi[1]) && Number.isNaN(phi[2]));
  assert(Number.isFinite(phi[1]) && Number.isFinite(psi[2]));
  assert(PEPTIDE_BREAK_DISTANCE === 2.5);

  const data = peptide(4);
  const live = Float32Array.from(broken.positions);
  const fromLive = backboneDihedrals(data, { positions: live });
  assert(Number.isNaN(fromLive.psi[1]), "reads the supplied positions");
  assertThrows(
    () => backboneDihedrals(data, { positions: new Float32Array(3) }),
    RangeError,
  );
});
