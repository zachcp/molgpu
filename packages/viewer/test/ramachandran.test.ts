import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { activeAtoms, backboneDihedrals, withPositions } from "@molgpu/table";
import { bySecondaryStructure, evaluate } from "@molgpu/fields";
import { structureFromBcif } from "@molgpu/io";
import {
  insetRect,
  plotAxes,
  ramachandranPoints,
} from "../src/internal/ramachandran-points.ts";

const crambin = await structureFromBcif(
  await Deno.readFile(
    new URL("../../io/test/fixtures/1crn.bcif", import.meta.url),
  ),
);

Deno.test("points are the default view's residues with both torsions", () => {
  const points = ramachandranPoints(crambin);
  const { phi, psi } = backboneDihedrals(crambin, {
    rows: activeAtoms(crambin),
  });
  const defined = [...phi.keys()].filter((r) =>
    Number.isFinite(phi[r]) && Number.isFinite(psi[r])
  );
  assertEquals(points.map((p) => p.residue), defined);
  assertEquals(points.length, 44, "46 residues minus the two termini");
  for (const p of points) {
    assertAlmostEquals(p.phi, phi[p.residue], 1e-6);
    assertAlmostEquals(p.psi, psi[p.residue], 1e-6);
  }
});

Deno.test("a Field colour is read at each residue's CA", () => {
  const field = bySecondaryStructure();
  const rgba = evaluate(field, crambin, { domain: "atom" }) as Float32Array;
  const { atoms } = crambin.topology;
  for (const p of ramachandranPoints(crambin, field)) {
    const ca = activeAtoms(crambin).find((i) =>
      atoms.residue[i] === p.residue && atoms.name[i] === "CA"
    )!;
    assertEquals([...p.color], [...rgba.subarray(4 * ca, 4 * ca + 4)]);
  }
  const fixed = ramachandranPoints(crambin, [1, 0, 0, 1]);
  assert(fixed.every((p) => p.color.join() === "1,0,0,1"));
});

Deno.test("points follow replaced coordinates", () => {
  const moved = Float32Array.from(
    crambin.positions,
    (v, i) => i % 3 === 0 ? -v : v,
  );
  // Mirroring x inverts chirality, so every torsion changes sign.
  const mirrored = ramachandranPoints(withPositions(crambin, moved));
  const original = ramachandranPoints(crambin);
  mirrored.forEach((p, i) => {
    assertAlmostEquals(p.phi, -original[i].phi, 1e-3);
    assertAlmostEquals(p.psi, -original[i].psi, 1e-3);
  });
});

Deno.test("inset geometry: corners and axis directions", () => {
  assertEquals(insetRect("bottom-right", 200, 16, 800, 600), {
    left: 584,
    top: 384,
  });
  assertEquals(insetRect("top-left", 200, 16, 800, 600), { left: 16, top: 16 });
  const [x, y] = plotAxes(10, 20, 360);
  assertEquals([x(-180), x(0), x(180)], [10, 190, 370]);
  assertEquals([y(180), y(0), y(-180)], [20, 200, 380], "ψ +180 at the top");
});
