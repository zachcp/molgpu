// Oracle for @molgpu/table backboneDihedrals on the pinned corpus. Mol*'s own
// DSSP phi/psi (calculateUnitDihedralAngles) reuses aliased position buffers
// after the first residue, so it is not an oracle: the kernel is pinned to
// Mol*'s Vec3.dihedralAngle on every computed torsion, and the geometry to the
// textbook alpha-helix region for residues DSSP assigns H.
import { assert, assertAlmostEquals } from "@std/assert";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra.js";
import {
  activeAtoms,
  backboneDihedrals,
  dssp,
  PEPTIDE_BREAK_DISTANCE,
  SS_CODES,
} from "@molgpu/table";
import { structureFromBcif } from "../src/index.ts";
import { corpus } from "./corpus.ts";

const deg = (rad: number) => rad * 180 / Math.PI;
// Mol* returns [-pi, pi]; the table maps -180 to 180.
const wrap = (d: number) => d === -180 ? 180 : d;
const angleDiff = (a: number, b: number) =>
  Math.abs(((a - b + 540) % 360) - 180);

for (const entry of corpus) {
  Deno.test(`${entry.id}: backbone torsions equal Mol*'s Vec3.dihedralAngle`, async () => {
    const bytes = await Deno.readFile(
      new URL(`./fixtures/${entry.id}.bcif`, import.meta.url),
    );
    const data = await structureFromBcif(bytes);
    const { atoms, residues } = data.topology;
    const rows = activeAtoms(data, { model: "all" });
    const { phi, psi, omega } = backboneDihedrals(data, { rows });
    const at = new Map<number, Record<string, number>>();
    for (const i of rows) {
      const r = atoms.residue[i];
      if (residues.polymer[r] !== "protein") continue;
      const names = at.get(r) ?? {};
      if (!(atoms.name[i] in names)) names[atoms.name[i]] = i;
      at.set(r, names);
    }
    const P = data.positions;
    const v = (i: number) => Vec3.create(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    const molstar = (a: number, b: number, c: number, d: number) =>
      wrap(deg(Vec3.dihedralAngle(v(a), v(b), v(c), v(d))));
    let checked = 0;
    for (let r = 0; r + 1 < residues.count; r++) {
      const cur = at.get(r), next = at.get(r + 1);
      if (!Number.isFinite(psi[r])) continue;
      assert(cur && next, `psi only between protein residues (${r})`);
      assert(
        Vec3.distance(v(cur.C), v(next.N)) <= PEPTIDE_BREAK_DISTANCE,
        `psi only across a peptide bond (${r})`,
      );
      assertAlmostEquals(psi[r], molstar(cur.N, cur.CA, cur.C, next.N), 1e-3);
      assertAlmostEquals(
        omega[r],
        molstar(cur.CA, cur.C, next.N, next.CA),
        1e-3,
      );
      assertAlmostEquals(
        phi[r + 1],
        molstar(cur.C, next.N, next.CA, next.C),
        1e-3,
      );
      checked++;
    }
    const protein = [...at.keys()].length;
    if (protein === 0) {
      assert(phi.every(Number.isNaN), "no protein, no torsions");
      return;
    }
    assert(checked > 0, "protein structures yield torsions");

    // Residues DSSP assigns H sit in the alpha-helix basin.
    const codes = dssp(data, { rows });
    const helix: [number, number][] = [];
    for (let r = 0; r < residues.count; r++) {
      if (
        codes[r] === SS_CODES.indexOf("H") && Number.isFinite(phi[r] + psi[r])
      ) {
        helix.push([phi[r], psi[r]]);
      }
    }
    if (helix.length >= 8) {
      const mean = (k: 0 | 1) =>
        helix.reduce((s, h) => s + h[k], 0) / helix.length;
      assert(angleDiff(mean(0), -63) < 12, `helix phi mean ${mean(0)}`);
      assert(angleDiff(mean(1), -42) < 12, `helix psi mean ${mean(1)}`);
    }
    // Peptide bonds are planar: almost all omega are trans.
    const omegas = [...omega].filter(Number.isFinite);
    const trans = omegas.filter((w) => angleDiff(w, 180) < 30).length;
    assert(
      trans / omegas.length > 0.95,
      `trans omega ${trans}/${omegas.length}`,
    );
  });
}
