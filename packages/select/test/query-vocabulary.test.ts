import { assert, assertEquals, assertThrows } from "@std/assert";
import { createStructure, withAttributes, withPositions } from "@molgpu/table";
import {
  all,
  allConformers,
  allModels,
  and,
  attribute,
  chain,
  comp,
  compile,
  isStale,
  ligand,
  model,
  not,
  nucleic,
  or,
  protein,
  residues,
  resolve,
  secondaryStructure,
  toAtoms,
  water,
  where,
  within,
  withView,
} from "@molgpu/select";
import { fixture } from "./fixture.ts";

const rows = (selection: ReturnType<typeof resolve>) => [...selection.indices];
const defaultView = { model: "first", altloc: "primary" } as const;

function scopedFixture() {
  const input = fixture();
  input.topology.chains.count = 2;
  input.topology.chains.model = Int32Array.of(1, 2);
  input.topology.chains.authId = ["A", "B"];
  input.topology.chains.labelId = ["X", "Y"];
  input.topology.residues.chain = Uint32Array.of(0, 0, 1);
  input.topology.residues.comp = ["CYS", "HEM", "HEM"];
  input.topology.residues.polymer = ["protein", "other", "other"];
  input.topology.bonds.a[0] = 1;
  input.topology.bonds.b[0] = 2;
  input.topology.atoms.altloc = ["A", "B", "", "", "", ""];
  input.topology.atoms.occupancy = Float32Array.of(0.6, 0.4, 1, 1, 1, 1);
  // The model-2 ligand overlaps the model-1 protein. A final output mask alone
  // would wrongly let this inactive seed select atom 0 in the default view.
  input.positions = Float32Array.of(
    0,
    0,
    0,
    2,
    0,
    0,
    100,
    0,
    0,
    101,
    0,
    0,
    0,
    0,
    0,
    0.5,
    0,
    0,
  );
  return createStructure(input);
}

Deno.test("query boolean operations normalize atom/residue/bond domains and retain identity", () => {
  const data = createStructure(fixture());
  assertEquals(
    rows(resolve(
      and(
        comp(["CYS"]),
        not(attribute("element", (z) => z === 8)),
      ),
      data,
    )),
    [0, 1, 4],
  );
  assertEquals(rows(resolve(or(comp(["GLY"]), all("bond")), data)), [
    0,
    1,
    2,
    3,
    4,
    5,
  ]);
  assertEquals(rows(resolve(and(all("bond"), comp(["GLY"])), data)), [2, 3]);
  assertEquals(rows(resolve(not(comp(["missing"])), data)), [0, 1, 2, 3, 4, 5]);
  const query = or(comp(["GLY"]), attribute("element", (z) => z === 16));
  const other = createStructure(fixture());
  assert(resolve(query, data).dataset !== resolve(query, other).dataset);
  assert(resolve(query, data).id !== resolve(query, other).id);
});

Deno.test("transitive deps and precise attribute names survive composition and views", () => {
  const query = withView(
    within(5, and(protein(), attribute("ssCode", (code) => code === 1))),
    { model: 2 },
  );
  assertEquals([...query.deps].sort(), ["attributes", "positions", "topology"]);
  assertEquals(query.attributes, ["ssCode"]);
  assertEquals(query.view, { model: 2 });
  assertEquals(protein().attributes, []);
  assertEquals(or(query, attribute("bfactor", (v) => v > 2)).attributes, [
    "ssCode",
    "bfactor",
  ]);
  assertEquals(within(5, where("atom", "opaque", () => true)).attributes, null);
  assertEquals(
    and(query, where("atom", "opaque", () => true)).attributes,
    null,
  );
  assertEquals(
    where("atom", "structural", () => true, ["topology"]).attributes,
    [],
  );
  assert(Object.isFrozen(query.attributes));
  assert(Object.isFrozen(query.view));
  assert(Object.isFrozen(query.deps));
});

Deno.test("named attributes lift residue columns to atoms and reject missing inputs", () => {
  const data = withAttributes(createStructure(fixture()), {
    "user:score": {
      domain: "residue",
      values: Float32Array.of(1, 0, 2),
      provenance: "user",
      kind: "scalar",
    },
  });
  assertEquals(rows(resolve(attribute("user:score", (v) => v > 0), data)), [
    0,
    1,
    4,
    5,
  ]);
  assertThrows(
    () => resolve(attribute("user:missing", () => true), data),
    TypeError,
    "missing column",
  );
  assertThrows(() => attribute("", () => true), TypeError, "column name");
});

Deno.test("standalone queries stay full-table; scoped residue/bond resolution returns eligible atoms", () => {
  const data = scopedFixture();
  const query = comp(["CYS"]);
  assertEquals(resolve(query, data).domain, "residue");
  assertEquals(rows(toAtoms(resolve(query, data), data)), [0, 1]);
  const before = [...data.positions];
  assertEquals(rows(resolve(query, data, { view: defaultView })), [0]);
  assertEquals(resolve(query, data, { view: defaultView }).domain, "atom");
  assertEquals(rows(resolve(all("bond"), data, { view: defaultView })), [2, 3]);
  assertEquals(rows(resolve(all(), data)), [0, 1, 2, 3, 4, 5]);
  assertEquals([...data.positions], before);
  assertEquals(data.topology.atoms.count, 6);
});

Deno.test("scoped within excludes inactive model seeds, not only final candidates", () => {
  const data = scopedFixture();
  const query = within(1, comp(["HEM"]));
  assertEquals(rows(resolve(query, data)), [0, 2, 3, 4, 5]);
  assertEquals(rows(resolve(query, data, { view: defaultView })), [2, 3]);
  assertEquals(
    rows(
      resolve(withView(query, { model: "all" }), data, { view: defaultView }),
    ),
    [0, 2, 3, 4, 5],
  );
});

Deno.test("scoped complements and expressions use the same eligible universe", () => {
  const data = scopedFixture();
  assertEquals(rows(resolve(not(comp(["HEM"])), data, { view: defaultView })), [
    0,
  ]);
  const expr = compile({
    head: { name: "structure-query.generator.query-in-selection" },
    args: {
      0: {
        head: { name: "structure-query.generator.atom-groups" },
        args: {
          "atom-test": {
            head: { name: "core.rel.eq" },
            args: [{
              head: {
                name: "structure-query.atom-property.core.element-symbol",
              },
            }, "S"],
          },
        },
      },
      query: { head: { name: "structure-query.generator.all" } },
      "in-complement": true,
    },
  });
  assertEquals(rows(resolve(expr, data, { view: defaultView })), [0, 3]);
});

Deno.test("scoped within excludes inactive conformer seeds and skips their predicates", () => {
  const input = fixture();
  input.topology.bonds.a[0] = 1;
  input.topology.bonds.b[0] = 2;
  input.topology.atoms.altloc = ["A", "B", "", "", "", ""];
  input.topology.atoms.occupancy = Float32Array.of(0.6, 0.4, 1, 1, 1, 1);
  const data = createStructure(input);
  let calls = 0;
  const seed = where("atom", "inactive only", (_, atom) => {
    calls++;
    return atom === 1;
  }, ["topology"]);
  assertEquals(rows(resolve(within(2, seed), data, { view: defaultView })), []);
  assertEquals(calls, 5);
  assertEquals(
    rows(
      resolve(withView(within(2, seed), { altloc: "all" }), data, {
        view: defaultView,
      }),
    ),
    [0, 1, 2, 3],
  );
});

Deno.test("explicit scope axes override defaults; conflicts need an outer override", () => {
  const data = scopedFixture();
  assertEquals(rows(resolve(model(2), data, { view: defaultView })), [4, 5]);
  assertEquals(
    rows(resolve(and(protein(), allConformers()), data, { view: defaultView })),
    [0, 1],
  );
  assertEquals(
    rows(resolve(and(allModels(), ligand()), data, { view: defaultView })),
    [2, 3, 4, 5],
  );
  const conflict = within(0, or(model(1), model(2)));
  assertThrows(() => resolve(conflict, data), TypeError, "conflicting model");
  assertEquals(rows(resolve(withView(conflict, { model: "all" }), data)), [
    0,
    1,
    2,
    3,
    4,
    5,
  ]);
  assertEquals(
    rows(
      resolve(
        withView(withView(all(), { model: 2, altloc: "all" }), { model: 1 }),
        data,
        { view: defaultView },
      ),
    ),
    [0, 1, 2, 3],
  );
  assertThrows(() => resolve(model(9), data), TypeError, "model not present");
  assertThrows(
    () => withView(all(), { altloc: "bad" as "all" }),
    TypeError,
    "primary or all",
  );
});

Deno.test("named structural builders use explicit chain/sequence namespaces", () => {
  const input = fixture();
  input.topology.chains.authId = ["AUTH"];
  input.topology.chains.labelId = ["LABEL"];
  input.topology.residues.polymer = ["protein", "dna", "other"];
  input.topology.residues.comp = ["CYS", "DA", "HOH"];
  input.topology.residues.authSeq = ["10", "11", "11"];
  input.topology.residues.insertionCode = ["", "", "A"];
  const data = createStructure(input);
  assertEquals(rows(resolve(protein(), data)), [0, 1]);
  assertEquals(rows(resolve(nucleic(), data)), [2, 3]);
  assertEquals(rows(resolve(water(), data)), [4, 5]);
  assertEquals(rows(resolve(ligand(), data)), []);
  assertEquals(rows(resolve(chain("AUTH"), data)), [0, 1, 2, 3, 4, 5]);
  assertEquals(rows(resolve(chain("LABEL", { namespace: "label" }), data)), [
    0,
    1,
    2,
    3,
    4,
    5,
  ]);
  assertEquals(rows(resolve(chain("LABEL"), data)), []);
  assertEquals(rows(resolve(residues([11, 11]), data)), [2, 3, 4, 5]);
  assertEquals(rows(resolve(residues([1, 2], { namespace: "label" }), data)), [
    0,
    1,
    2,
    3,
  ]);
  assertThrows(() => residues([3, 1]), TypeError, "ordered pair");
});

Deno.test("secondary structure uses full H/G/I and E/B classifications on polymers", () => {
  let data = withAttributes(createStructure(fixture()), {
    ssCode: {
      domain: "residue",
      values: Uint8Array.of(1, 4, 5),
      provenance: "user",
      kind: "code",
    },
  });
  assertEquals(rows(resolve(secondaryStructure("helix"), data)), [
    0,
    1,
    2,
    3,
    4,
    5,
  ]);
  data = withAttributes(data, {
    ssCode: {
      domain: "residue",
      values: Uint8Array.of(2, 3, 0),
      provenance: "user",
      kind: "code",
    },
  });
  assertEquals(rows(resolve(secondaryStructure("sheet"), data)), [0, 1, 2, 3]);
  assertEquals(rows(resolve(secondaryStructure("coil"), data)), [4, 5]);
});

Deno.test("combined dependency revisions follow attribute and coordinate changes", () => {
  const data = createStructure(fixture());
  const query = within(2, attribute("bfactor", (v) => v === 0));
  const selection = resolve(query, data);
  assertEquals(selection.deps, {
    topology: data.revision.topology,
    positions: data.revision.positions,
    attributes: data.revision.attributes,
  });
  assert(isStale(selection, withPositions(data, data.positions)));
});
