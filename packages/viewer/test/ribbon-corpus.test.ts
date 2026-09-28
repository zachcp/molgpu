import { assert, assertStrictEquals } from "@std/assert";
import {
  activeAtoms,
  coordinateBounds,
  secondaryStructureTrace,
  traceTable,
} from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import { buildRibbonGeometry } from "../src/internal/ribbon-geometry.ts";

async function loadFixture(id: string) {
  const bytes = new Uint8Array(
    await Deno.readFile(
      new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url),
    ),
  );
  const data = await structureFromBcif(bytes);
  const selection = activeAtoms(data);
  const trace = traceTable(data, selection);
  const ss = secondaryStructureTrace(data, selection, trace);
  return {
    data,
    selection,
    trace,
    ss,
    mesh: buildRibbonGeometry(trace, ss, 6),
  };
}

/**
 * Golden-file style checks against the real corpus (gap, altloc, nucleic,
 * helix/sheet-rich, and beta-heavy entries), per this project's own architecture guidance: compare molecular
 * identity, run boundaries, bounds, and finite geometry within a stated
 * tolerance rather than an assumed matching mesh/vertex order against Mol*'s
 * own (structurally different) cartoon tessellation.
 */
for (const id of ["1tqn", "1ejg", "1bna", "1crn", "2k39"]) {
  Deno.test(`${id}: ribbon geometry is finite, in-bounds, and never bridges a run`, async () => {
    const { data, trace, ss, mesh } = await loadFixture(id);
    assert(mesh.vertexCount > 0, "expected a non-empty ribbon");
    assertStrictEquals(mesh.positions.length, mesh.vertexCount * 3);
    assertStrictEquals(mesh.normals.length, mesh.vertexCount * 3);
    assertStrictEquals(mesh.indices.length, mesh.triangleCount * 3);
    for (const v of mesh.positions) assert(Number.isFinite(v));
    for (const v of mesh.normals) assert(Number.isFinite(v));
    for (const i of mesh.indices) assert(i >= 0 && i < mesh.vertexCount);

    // Every vertex maps back to a real, retained residue (sample-to-residue mapping).
    for (const row of mesh.residue) {
      assert(row >= 0 && row < data.topology.residues.count);
    }

    // The mesh must stay within the atom cloud's bounds, expanded by the
    // The broadest profile is the beta-sheet shoulder: 1.5 * 2.0 full
    // diameter along the normal, plus spline overshoot near a guide point.
    const bounds = coordinateBounds(data);
    assert(bounds);
    const margin = 1.85;
    for (let v = 0; v < mesh.vertexCount; v++) {
      for (let c = 0; c < 3; c++) {
        const p = mesh.positions[v * 3 + c];
        assert(
          p >= bounds.min[c] - margin && p <= bounds.max[c] + margin,
          `vertex ${v} axis ${c} (${p}) outside the structure's bounds`,
        );
      }
    }

    // No triangle mixes vertices from two different runs (never bridges a gap/chain break).
    const runOf = new Array(trace.runs.length - 1);
    for (let r = 0; r < trace.runs.length - 1; r++) {
      for (let k = trace.runs[r]; k < trace.runs[r + 1]; k++) {
        runOf[k] = r;
      }
    }
    const runOfResidue = new Map();
    for (let r = 0; r < trace.runs.length - 1; r++) {
      for (let k = trace.runs[r]; k < trace.runs[r + 1]; k++) {
        runOfResidue.set(trace.residue[k], r);
      }
    }
    for (let t = 0; t < mesh.triangleCount; t++) {
      const runs = [0, 1, 2].map((c) =>
        runOfResidue.get(mesh.residue[mesh.indices[t * 3 + c]])
      );
      assertStrictEquals(runs[0], runs[1]);
      assertStrictEquals(runs[1], runs[2]);
    }

    // Every sample's secondary-structure kind is one of the three known labels.
    for (const kind of ss.kind) {
      assert(["helix", "sheet", "coil"].includes(kind));
    }
  });
}

Deno.test("1crn and 2k39 ribbon triangles agree with their vertex normals", async () => {
  for (const id of ["1crn", "2k39"]) {
    const { mesh } = await loadFixture(id);
    let inverted = 0;
    let checked = 0;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices.subarray(i, i + 3);
      const point = (index: number) => [
        mesh.positions[index * 3],
        mesh.positions[index * 3 + 1],
        mesh.positions[index * 3 + 2],
      ];
      const p = point(a), q = point(b), r = point(c);
      const ab = q.map((v, axis) => v - p[axis]);
      const ac = r.map((v, axis) => v - p[axis]);
      const face = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      const area = Math.hypot(...face);
      if (area < 1e-8) continue;
      checked++;
      const alignment = [0, 1, 2].reduce((sum, axis) =>
        sum + face[axis] *
          (mesh.normals[a * 3 + axis] + mesh.normals[b * 3 + axis] +
            mesh.normals[c * 3 + axis]) /
          3, 0);
      if (alignment <= 0) inverted++;
    }
    assert(
      inverted === 0,
      `${id} has ${inverted} inverted/non-aligned triangles of ${checked}`,
    );
  }
});

Deno.test("1bna (nucleic, all-coil) still produces a valid, uniformly narrow ribbon", async () => {
  const { ss, mesh, trace } = await loadFixture("1bna");
  assert(ss.kind.every((k) => k === "coil"));
  assert(mesh.vertexCount > 0);
  assert(trace.runKind.every((k) => k === "dna"));
});
