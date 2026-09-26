import {
  assertEquals,
  assertMatch,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  activeAtoms,
  bondTopology,
  coordinateBounds,
  createStructure,
  residueKey,
  selectBonds,
  validateStructure,
  withPositions,
} from "../src/index.ts";
import type { StructureInput } from "../src/index.ts";
import type { Mutable } from "../../../test/support/mutable.ts";
import { fixture } from "./fixture.ts";

Deno.test("owns packed columns without discarding chemical or instance identity", () => {
  const input = fixture(), data = createStructure(input);
  input.positions[0] = 900;
  input.topology.atoms.name[0] = "wrong";
  input.topology.instances.transform[28] = 900;
  assertStrictEquals(data.positions[0], 0);
  assertStrictEquals(data.topology.atoms.name[0], "N");
  assertStrictEquals(data.topology.instances.transform[28], 10);
  assertStrictEquals(data.positions.length, data.topology.atoms.count * 3);
  assertStrictEquals(
    new Set([0, 1, 2, 3].map((i) => residueKey(data, i))).size,
    4,
  );
  assertStrictEquals(data.topology.atoms.count, 6); // instances do not duplicate atoms
  assertEquals(coordinateBounds(data), {
    min: [0, 0, 0],
    max: [5, 6, 7],
    center: [2.5, 3, 3.5],
  });
});

Deno.test("coordinate replacements preserve topology; branching versions are unique", () => {
  const data = createStructure(fixture());
  const positions = Float32Array.from(data.positions, (x) => x + 10);
  const a = withPositions(data, positions), b = withPositions(data, positions);
  assertStrictEquals(a.identity, data.identity);
  assertStrictEquals(a.topology, data.topology);
  assertStrictEquals(a.revision.topology, data.revision.topology);
  assertNotStrictEquals(a.revision.positions, b.revision.positions);
  positions.fill(0);
  assertStrictEquals(a.positions[0], 10);
  assertStrictEquals(data.positions[0], 0);
  assertNotStrictEquals(createStructure(fixture()).identity, data.identity);
});

Deno.test("explicit model and residue-level altloc policies", () => {
  const data = createStructure(fixture());
  assertEquals([...activeAtoms(data)], [0, 2, 3, 4]);
  assertEquals([...activeAtoms(data, { model: 2 })], [5]);
  assertEquals([...activeAtoms(data, { model: "all", altloc: "all" })], [
    0,
    1,
    2,
    3,
    4,
    5,
  ]);
  assertThrows(
    () => activeAtoms(data, { model: 99 }),
    Error,
    "model not present",
  );
  assertMatch(
    // @ts-expect-error: not a policy
    (assertThrows(() => activeAtoms(data, { altloc: "random" }), Error))
      .message,
    /policy.altloc/,
  );
  const input = fixture();
  input.topology.atoms.occupancy[1] = .6;
  assertEquals([...activeAtoms(createStructure(input))], [0, 1, 3, 4]); // lexical tie
});

Deno.test("empty domains and empty selections have defined results", () => {
  const input = fixture();
  input.positions = new Float32Array();
  for (
    const domain of Object.values(input.topology) as Record<string, unknown>[]
  ) {
    domain.count = 0;
    for (const k of Object.keys(domain)) {
      if (k !== "count") domain[k] = (domain[k] as unknown[]).slice(0, 0);
    }
  }
  const data = createStructure(input);
  assertStrictEquals(coordinateBounds(data), null);
  assertEquals([...activeAtoms(data)], []);
  assertStrictEquals(
    coordinateBounds(createStructure(fixture()), new Uint32Array()),
    null,
  );
});

const invalid: [string, (x: Mutable<StructureInput>) => void, RegExp][] = [
  ["stride", (x) => {
    x.positions = new Float32Array(6);
  }, /positions/],
  ["nonfinite coordinates", (x) => {
    x.positions[2] = NaN;
  }, /finite/],
  ["atom foreign key", (x) => {
    x.topology.atoms.residue[0] = 90;
  }, /foreign key/],
  ["residue foreign key", (x) => {
    x.topology.residues.chain[0] = 90;
  }, /foreign key/],
  ["bond foreign key", (x) => {
    x.topology.bonds.a[0] = 90;
  }, /foreign key/],
  ["instance foreign key", (x) => {
    x.topology.instances.chain[0] = 90;
  }, /foreign key/],
  ["occupancy", (x) => {
    x.topology.atoms.occupancy[0] = 1.1;
  }, /occupancy/],
  ["duplicate site", (x) => {
    x.topology.atoms.altloc[1] = "B";
  }, /duplicate/],
  ["cross-model bond", (x) => {
    x.topology.bonds.b[0] = 5;
  }, /cross-model/],
  ["incompatible conformers", (x) => {
    x.topology.bonds.a[0] = 1;
  }, /altloc/],
  ["nonaffine transform", (x) => {
    x.topology.instances.transform[3] = 2;
  }, /affine/],
];
for (const [name, mutate, error] of invalid) {
  Deno.test(`rejects ${name}`, () => {
    const input = fixture();
    mutate(input);
    assertMatch(
      assertThrows(() => validateStructure(input), Error).message,
      error,
    );
  });
}

Deno.test("validates coordinate update length and selected bounds indices", () => {
  const data = createStructure(fixture());
  assertThrows(
    () => withPositions(data, new Float32Array(1)),
    Error,
    "positions",
  );
  assertThrows(
    () => withPositions(data, new Float32Array(18).fill(Infinity)),
    Error,
    "finite",
  );
  assertThrows(
    () => coordinateBounds(data, Uint32Array.of(99)),
    Error,
    "atom out of range",
  );
  assertThrows(() => residueKey(data, -1), Error, "row out of range");
});

Deno.test("shares explicit topology and makes bond-selection endpoint policy explicit", () => {
  const data = createStructure(fixture());
  assertStrictEquals(bondTopology(data), data.topology.bonds);
  assertEquals([...selectBonds(data, Uint32Array.of(0), { mode: "both" })], []);
  assertEquals([...selectBonds(data, Uint32Array.of(0), { mode: "either" })], [
    0,
  ]);
  assertEquals([...selectBonds(data, Uint32Array.of(0, 2), { mode: "both" })], [
    0,
  ]);
});

Deno.test("infers cached element-aware topology without cross-model or incompatible-altloc bonds", () => {
  const input = fixture();
  input.topology.bonds = {
    count: 0,
    a: new Uint32Array(),
    b: new Uint32Array(),
    order: new Uint8Array(),
    source: [],
  };
  input.positions = Float32Array.from([
    0,
    0,
    0,
    1.4,
    0,
    0,
    10,
    0,
    0,
    20,
    0,
    0,
    40,
    0,
    0,
    40,
    0,
    0,
  ]);
  const data = createStructure(input), first = bondTopology(data);
  assertStrictEquals(
    first,
    bondTopology(data),
    "one topology build per structure revision/policy",
  );
  assertEquals([...first.a], [0]);
  assertEquals([...first.b], [1]);
  assertEquals(first.source, ["inferred"]);
});
