import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  ATTRIBUTE_DOMAINS,
  attributeColumn,
  attributeNames,
  createStructure,
  withAttributes,
  withPositions,
} from "../src/index.ts";
import { fixture } from "./fixture.ts";

Deno.test("derived attributes preserve topology and own caller values", () => {
  const root = createStructure(fixture());
  const values = Float32Array.from(
    { length: root.topology.atoms.count },
    (_, i) => i / 2,
  );
  const a = withAttributes(root, {
    "user:score": {
      domain: "atom",
      kind: "scalar",
      values,
      provenance: "user",
    },
  });
  values[0] = 99;
  assertEquals(attributeColumn(a, "user:score")?.values[0], 0);
  assertStrictEquals(a.identity, root.identity);
  assertStrictEquals(a.topology, root.topology);
  assertStrictEquals(a.positions, root.positions);
  assertStrictEquals(a.revision.topology, root.revision.topology);
  assertStrictEquals(a.revision.positions, root.revision.positions);
  assertNotStrictEquals(a.revision.attributes, root.revision.attributes);
  assertEquals(attributeColumn(a, "user:score")?.provenance, "user");
  assertEquals(attributeNames(a).includes("user:score"), true);

  const b = withAttributes(a, {
    partialCharge: {
      domain: "atom",
      kind: "scalar",
      provenance: "computed:test",
      values: new Float32Array(root.topology.atoms.count),
    },
  });
  assertStrictEquals(
    attributeColumn(a, "user:score"),
    attributeColumn(b, "user:score"),
  );
  const moved = withPositions(b, b.positions.slice());
  assertStrictEquals(moved.attributes, b.attributes);
  assertNotStrictEquals(moved.revision.positions, b.revision.positions);
  const removed = withAttributes(b, { "user:score": null });
  assertEquals(attributeColumn(removed, "user:score"), undefined);
  assertEquals(attributeColumn(b, "user:score")?.values[1], .5);
});

Deno.test("built-in attribute views are stable and formal charge can be overridden", () => {
  const root = createStructure(fixture());
  assertStrictEquals(
    attributeColumn(root, "atomChain"),
    attributeColumn(root, "atomChain"),
  );
  assertEquals(attributeColumn(root, "atomChain")?.domain, "atom");
  assertEquals(attributeColumn(root, "toString"), undefined);
  const charged = withAttributes(root, {
    formalCharge: {
      domain: "atom",
      kind: "code",
      provenance: "imported:pqr",
      values: new Int8Array(root.topology.atoms.count).fill(-1),
    },
  });
  assertEquals(attributeColumn(charged, "formalCharge")?.values[0], -1);
});

Deno.test("resolved attribute columns use the shared domain registry", () => {
  const root = createStructure(fixture());
  const data = withAttributes(root, {
    formalCharge: {
      domain: "atom",
      kind: "code",
      provenance: "user",
      values: new Int8Array(root.topology.atoms.count),
    },
    partialCharge: {
      domain: "atom",
      kind: "scalar",
      provenance: "user",
      values: new Float32Array(root.topology.atoms.count),
    },
    ssCode: {
      domain: "residue",
      kind: "code",
      provenance: "user",
      values: new Uint8Array(root.topology.residues.count),
    },
  });
  for (const [name, domain] of Object.entries(ATTRIBUTE_DOMAINS)) {
    const column = attributeColumn(data, name);
    if (column) assertEquals(column.domain, domain, name);
  }
});

Deno.test("attribute validation rejects invalid names, types, lengths and provenance", () => {
  const root = createStructure(fixture());
  const good = {
    domain: "atom",
    kind: "scalar",
    provenance: "user",
    values: new Float32Array(root.topology.atoms.count),
  } as const;
  assertThrows(
    () => withAttributes(root, { element: good }),
    TypeError,
    "namespaced",
  );
  assertThrows(
    () => withAttributes(root, { "user score": good }),
    TypeError,
    "namespaced",
  );
  assertThrows(
    () =>
      withAttributes(root, {
        partialCharge: {
          ...good,
          values: new Int8Array(root.topology.atoms.count),
        },
      }),
    TypeError,
    "Float32Array",
  );
  assertThrows(
    () =>
      withAttributes(root, {
        "user:score": { ...good, values: new Float32Array(1) },
      }),
    TypeError,
    "typed array",
  );
  assertThrows(
    () =>
      withAttributes(root, {
        "user:score": { ...good, provenance: "imported:" as "user" },
      }),
    TypeError,
    "provenance",
  );
  assertThrows(
    () =>
      withAttributes(root, {
        "user:score": {
          ...good,
          values: new Float32Array(root.topology.atoms.count).fill(NaN),
        },
      }),
    TypeError,
    "finite",
  );
});
