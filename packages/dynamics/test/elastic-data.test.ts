import { assert, assertEquals, assertThrows } from "@std/assert";
import { structureFromBcif } from "@molgpu/io";
import { caGuideRows, elasticNetworkData } from "../src/index.ts";

const corpus = async (id: string) =>
  structureFromBcif(
    await Deno.readFile(
      new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url),
    ),
  );

Deno.test("CA guides: one per protein residue of the first model", async () => {
  const crambin = await corpus("1crn");
  const rows = caGuideRows(crambin.topology);
  assertEquals(rows.length, 46);
  const { atoms, residues } = crambin.topology;
  for (const row of rows) {
    assertEquals(atoms.name[row], "CA");
    assertEquals(residues.polymer[atoms.residue[row]], "protein");
  }
  // NMR ensemble: only model 1 contributes nodes.
  const nmr = await corpus("2k39");
  const { chains } = nmr.topology;
  const nmrRows = caGuideRows(nmr.topology);
  const models = new Set(
    [...nmrRows].map((row) =>
      chains.model[
        nmr.topology.residues.chain[nmr.topology.atoms.residue[row]]
      ]
    ),
  );
  assertEquals(models.size, 1);
  assert(new Set(chains.model).size > 1, "fixture has several models");
});

Deno.test("elasticNetworkData builds springs, masses and the atom map", async () => {
  const crambin = await corpus("1crn");
  const data = elasticNetworkData(crambin.positions, crambin.topology, {
    version: 3,
  });
  const { system, atomToNode, guideRows } = data;
  assertEquals(data.version, 3);
  assertEquals(system.springs.nodeCount, 46);
  assertEquals(system.springs.neighbours.length, 2 * 688);
  assertEquals(system.masses[0], 110);
  assertEquals(atomToNode.length, crambin.topology.atoms.count);
  guideRows.forEach((row, node) => {
    assertEquals(atomToNode[row], node);
    for (let c = 0; c < 3; c++) {
      assertEquals(
        system.reference[3 * node + c],
        crambin.positions[3 * row + c],
      );
    }
  });
  // At the reference every spring is at rest.
  const { offsets, neighbours, restLength } = system.springs;
  for (let i = 0; i < 46; i++) {
    for (let j = offsets[i]; j < offsets[i + 1]; j++) {
      const a = 3 * i, b = 3 * neighbours[j];
      const d = Math.hypot(
        system.reference[b] - system.reference[a],
        system.reference[b + 1] - system.reference[a + 1],
        system.reference[b + 2] - system.reference[a + 2],
      );
      assert(Math.abs(d - restLength[j]) < 1e-5);
    }
  }
});

Deno.test("elasticNetworkData refuses silent thinning and guessed masses", async () => {
  const crambin = await corpus("1crn");
  assertThrows(
    () =>
      elasticNetworkData(crambin.positions, crambin.topology, {
        version: 0,
        maxContacts: 100,
      }),
    RangeError,
    "contact cap",
  );
  assertThrows(
    () =>
      elasticNetworkData(crambin.positions, crambin.topology, {
        version: 0,
        guide: [0, 1, 2, 3],
      }),
    TypeError,
    "masses",
  );
  assertThrows(
    () =>
      elasticNetworkData(crambin.positions.subarray(3), crambin.topology, {
        version: 0,
      }),
    TypeError,
  );
});
