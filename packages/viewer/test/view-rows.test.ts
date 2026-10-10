// crj.4: every molecular consumer resolves the same default view (first model,
// primary conformer) and treats `select` as the one exact override.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { resolve, where } from "@molgpu/select";
import type { StructureData } from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import { allOrRows, viewRows } from "../src/selection/view-rows.ts";
import { buildBondRows } from "../src/representations/bonds/bond-columns.ts";
import { focusSelection } from "../src/interaction/camera-curve.ts";
import { createStructureResource } from "../src/structure/structure-resource.ts";

const load = async (id: string): Promise<StructureData> =>
  await structureFromBcif(
    new Uint8Array(
      await Deno.readFile(
        new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url),
      ),
    ),
  );

const modelOf = (data: StructureData, row: number): number => {
  const { atoms, residues, chains } = data.topology;
  return chains.model[residues.chain[atoms.residue[row]]];
};

// Every endpoint of every kept bond lies in `rows`.
const bondsWithin = (data: StructureData, rows: Uint32Array | null) => {
  const keep = new Set(rows ?? []);
  const built = buildBondRows(
    data,
    allOrRows(data, rows ?? new Uint32Array()),
    "both",
  );
  for (const row of built.endpoints) assert(keep.has(row), `bond row ${row}`);
  return built.endpoints.length / 2;
};

for (
  const [id, total, active] of [
    ["2k39", 142796, 1231],
    ["1ejg", 843, 641],
  ] as const
) {
  Deno.test(`${id}: default view is the first model's primary conformers`, async () => {
    const data = await load(id);
    assertStrictEquals(data.topology.atoms.count, total);
    const rows = viewRows(data, null);
    assertStrictEquals(rows.length, active);
    assertEquals(viewRows(data, undefined), rows);
    const first = modelOf(data, 0);
    const sites = new Set<string>();
    for (const row of rows) {
      assertStrictEquals(modelOf(data, row), first);
      // One conformer per atom site.
      const site = `${data.topology.atoms.residue[row]}:${
        data.topology.atoms.name[row]
      }`;
      assert(!sites.has(site), `duplicate conformer at ${site}`);
      sites.add(site);
    }
    // The default view needs an index: it is not every row.
    assertStrictEquals(allOrRows(data, rows), rows);
    // Default bonds join only default-view atoms.
    assert(bondsWithin(data, rows) > 0);
  });

  Deno.test(`${id}: an empty focus falls back to the default view, not every row`, async () => {
    const data = await load(id);
    const resource = createStructureResource(data);
    const view = new Set(viewRows(data, null));
    const empty = focusSelection(resource, where("atom", "none", () => false));
    const explicit = focusSelection(
      resource,
      where("atom", "default view", (_, row) => view.has(row)),
    );
    assertEquals(empty, explicit);
  });
}

Deno.test("2k39: a model-2 selection replaces the default view exactly", async () => {
  const data = await load("2k39");
  const second = resolve(
    where("atom", "model 2", (d, row) => modelOf(d, row) === 2),
    data,
  );
  const rows = viewRows(data, second);
  assertStrictEquals(rows, second.indices);
  assertStrictEquals(rows.length, 1231);
  for (const row of rows) assertStrictEquals(modelOf(data, row), 2);
  assert(bondsWithin(data, rows) > 0);
});

Deno.test("1ejg: an all-conformer selection reaches alternate locations", async () => {
  const data = await load("1ejg");
  const model = modelOf(data, 0);
  const every = resolve(
    where("atom", "all conformers", (d, row) => modelOf(d, row) === model),
    data,
  );
  const rows = viewRows(data, every);
  assert(rows.length > 641, `${rows.length} rows`);
  assert(rows.some((row) => data.topology.atoms.altloc[row] !== ""));
});

Deno.test("an empty selection stays empty and keeps no bonds", async () => {
  const data = await load("1ejg");
  const none = resolve(where("atom", "none", () => false), data);
  const rows = viewRows(data, none);
  assertStrictEquals(rows.length, 0);
  assertStrictEquals(allOrRows(data, rows), rows);
  assertStrictEquals(buildBondRows(data, rows, "both").n, 0);
});

Deno.test("every row in order needs no index", async () => {
  const data = await load("1ejg");
  const every = resolve(where("atom", "all", () => true), data);
  assertStrictEquals(allOrRows(data, viewRows(data, every)), null);
});
