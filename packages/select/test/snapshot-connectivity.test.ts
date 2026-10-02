import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { structureFromBcif } from "@molgpu/io";
import {
  bondTopology,
  createStructure,
  withAttributes,
  withPositions,
} from "@molgpu/table";
import { bondGraph, preserveBondGraph } from "../src/bond-graph.ts";
import { compile, resolve } from "../src/index.ts";
import { fixture } from "./fixture.ts";

const call = (name: string, args?: unknown): unknown =>
  args === undefined ? { head: { name } } : { head: { name }, args };
const sq = (name: string, args?: unknown): unknown =>
  call(`structure-query.${name}`, args);

Deno.test("coordinate snapshots keep the source chemical graph on the corpus", async () => {
  for (const id of ["1ejg", "1crn", "1bna", "2k39"]) {
    const path = fromFileUrl(
      new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url),
    );
    const root = await structureFromBcif(await Deno.readFile(path));
    const graph = bondGraph(root);
    const snapshot = preserveBondGraph(
      root,
      withPositions(root, root.positions),
    );
    assertStrictEquals(snapshot.identity, root.identity);
    assertStrictEquals(snapshot.topology, root.topology);
    assertStrictEquals(snapshot.revision.topology, root.revision.topology);
    assertStrictEquals(bondGraph(snapshot), graph, `${id}: graph identity`);
    if (id === "1ejg") {
      assertEquals(root.topology.bonds.count, 0);
      assertEquals(graph.count, 864); // incl. N-H1/H3 of both altlocs (Mol* 5.12)
      assertEquals(bondTopology(root).count, 868);
    }
    for (const row of [0, Math.floor(root.topology.atoms.count / 2)]) {
      const seed = sq("generator.atom-groups", {
        "atom-test": call("core.rel.eq", [
          sq("atom-property.macromolecular.id"),
          root.topology.atoms.id[row],
        ]),
      });
      for (
        const query of [
          sq("modifier.include-connected", { 0: seed }),
          sq("modifier.include-connected", {
            0: seed,
            "fixed-point": true,
            "bond-test": call("core.rel.gr", [sq("bond-property.order"), 1]),
          }),
          sq("filter.is-connected-to", {
            0: sq("generator.all"),
            target: seed,
          }),
        ]
      ) {
        const compiled = compile(query as Parameters<typeof compile>[0]);
        assertEquals(
          [...resolve(compiled, snapshot).indices],
          [...resolve(compiled, root).indices],
          `${id}: row ${row}`,
        );
      }
    }
  }
});

Deno.test("snapshot graph stays chemical as positions move and rejects foreign topology", () => {
  const input = fixture();
  input.topology.bonds = {
    count: 0,
    a: new Uint32Array(),
    b: new Uint32Array(),
    order: new Uint8Array(),
    source: [],
  };
  const root = createStructure(input);
  const moved = root.positions.slice();
  moved[3] = 100;
  const snapshot = preserveBondGraph(root, withPositions(root, moved));
  assertStrictEquals(bondGraph(snapshot), bondGraph(root));
  const attributed = withAttributes(snapshot, {
    "user:score": {
      domain: "atom",
      kind: "scalar",
      values: new Float32Array(root.topology.atoms.count),
      provenance: "user",
    },
  });
  assertStrictEquals(bondGraph(attributed), bondGraph(root));
  assertStrictEquals(
    attributed.revision.positions,
    snapshot.revision.positions,
  );
  assertThrows(
    () => preserveBondGraph(root, createStructure(input)),
    TypeError,
    "same dataset topology",
  );
});
