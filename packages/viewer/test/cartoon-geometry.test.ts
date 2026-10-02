import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { activeAtoms, traceTable } from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import {
  buildNucleotideRingGeometry,
  buildPolymerGapGeometry,
  polymerGaps,
} from "../src/internal/cartoon-geometry.ts";

async function load(id: string) {
  const data = await structureFromBcif(
    await Deno.readFile(
      new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url),
    ),
  );
  const selection = activeAtoms(data);
  return { data, selection, trace: traceTable(data, selection) };
}

function assertValidMesh(
  mesh: ReturnType<typeof buildPolymerGapGeometry>,
) {
  const vertexCount = mesh.residue.length;
  assertStrictEquals(mesh.positions.length, vertexCount * 3);
  assertStrictEquals(mesh.normals.length, vertexCount * 3);
  for (const v of mesh.positions) assert(Number.isFinite(v));
  for (const v of mesh.normals) assert(Number.isFinite(v));
  for (const i of mesh.indices) assert(i < vertexCount);
}

Deno.test("1bna: every nucleotide gets a base ring slab and a stick to its trace atom", async () => {
  const { data, selection, trace } = await load("1bna");
  const mesh = buildNucleotideRingGeometry(data, selection, trace);
  assertValidMesh(mesh);
  const { residues, atoms } = data.topology;
  const drawn = new Set(mesh.residue);
  for (let k = 0; k < trace.count; k++) {
    assert(
      drawn.has(trace.residue[k]),
      `residue ${trace.residue[k]} has no ring`,
    );
  }
  // Ring vertices lie within the base: no farther than the slab
  // thickness from the residue's own base atoms or its stick.
  const atomsOf = new Map<number, number[]>();
  for (const i of selection) {
    const r = atoms.residue[i];
    atomsOf.set(r, [...(atomsOf.get(r) ?? []), i]);
  }
  for (let v = 0; v < mesh.residue.length; v += 7) {
    const r = mesh.residue[v];
    const nearest = Math.min(
      ...atomsOf.get(r)!.map((i) =>
        Math.hypot(
          mesh.positions[v * 3] - data.positions[i * 3],
          mesh.positions[v * 3 + 1] - data.positions[i * 3 + 1],
          mesh.positions[v * 3 + 2] - data.positions[i * 3 + 2],
        )
      ),
    );
    assert(
      nearest < 3,
      `ring vertex ${v} strays ${nearest} Å from residue ${r}`,
    );
  }
  assert(residues.comp.some((c) => c === "DA"));
});

Deno.test("proteins draw no nucleotide rings and 1crn has no polymer gaps", async () => {
  const { data, selection, trace } = await load("1crn");
  assertStrictEquals(
    buildNucleotideRingGeometry(data, selection, trace).residue.length,
    0,
  );
  assertEquals(polymerGaps(data, trace), []);
});

Deno.test("1tqn: the unmodelled 261-264 loop is one gap drawn as two dashed halves", async () => {
  const { data, trace } = await load("1tqn");
  const gaps = polymerGaps(data, trace);
  assertStrictEquals(gaps.length, 1);
  const [a, b] = gaps[0];
  const seq = data.topology.residues.labelSeq;
  assertEquals([seq[trace.residue[a]], seq[trace.residue[b]]], [260, 265]);
  const mesh = buildPolymerGapGeometry(data, trace);
  assertValidMesh(mesh);
  assertEquals(
    new Set(mesh.residue),
    new Set([trace.residue[a], trace.residue[b]]),
  );
  // Dashes stay on the segment between the two stems.
  const p = (k: number) => [0, 1, 2].map((c) => trace.guide[k * 3 + c]);
  const pa = p(a), pb = p(b);
  const length = Math.hypot(...pa.map((v, c) => pb[c] - v));
  for (let v = 0; v < mesh.residue.length; v++) {
    const q = [0, 1, 2].map((c) => mesh.positions[v * 3 + c]);
    const t = q.reduce((sum, x, c) => sum + (x - pa[c]) * (pb[c] - pa[c]), 0) /
      length / length;
    assert(t > 0 && t < 1, `gap vertex ${v} lies outside the gap`);
  }
});

Deno.test("a run break made by the selection is not a polymer gap", async () => {
  const { data, selection } = await load("1crn");
  const { atoms, residues } = data.topology;
  const dropped = Uint32Array.from(
    selection.filter((i) => residues.labelSeq[atoms.residue[i]] !== 20),
  );
  const trace = traceTable(data, dropped);
  assertStrictEquals(trace.runs.length - 1, 2);
  assertEquals(polymerGaps(data, trace), []);
});
