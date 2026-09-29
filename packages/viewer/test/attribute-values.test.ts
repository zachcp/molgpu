import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import { createStructure, withAttributes } from "@molgpu/table";
import { fixture } from "../../table/test/fixture.ts";
import { snapshotAttributeValues } from "../src/internal/attribute-values.ts";

Deno.test("GPU f32 attributes publish as table semantic columns", () => {
  const root = createStructure(fixture());
  const cases = [
    ["ssCode", "residue", "code", [0, 1, 3, 8], Uint8Array],
    ["formalCharge", "atom", "code", [-128, -2, 0, 1, 4, 127], Int8Array],
    ["partialCharge", "atom", "scalar", [-1, 0, 0.5, 1, 2, 3], Float32Array],
    ["user:code", "atom", "code", [-100, 0, 1, 2, 3, 100], Int32Array],
    ["user:score", "atom", "scalar", [1, 2, 3, 4, 5, 6], Float32Array],
  ] as const;
  for (const [name, domain, kind, input, Type] of cases) {
    const values = snapshotAttributeValues(
      name,
      kind,
      Float32Array.from(input),
    );
    assertInstanceOf(values, Type);
    const data = withAttributes(root, {
      [name]: { domain, kind, values, provenance: "gpu:test" },
    });
    assertEquals(Array.from(data.attributes![name].values), [...input]);
  }
});

Deno.test("GPU code publication rejects invalid integers and ranges", () => {
  for (
    const [name, value] of [
      ["ssCode", -1],
      ["ssCode", 9],
      ["formalCharge", -129],
      ["formalCharge", 128],
      ["user:code", 0.5],
      ["user:code", 16777218],
      ["ssCode", NaN],
    ] as const
  ) {
    assertThrows(
      () => snapshotAttributeValues(name, "code", Float32Array.of(value)),
      RangeError,
      `${name}[0]`,
    );
  }
  assertThrows(
    () =>
      snapshotAttributeValues(
        "partialCharge",
        "scalar",
        Float32Array.of(Infinity),
      ),
    TypeError,
    "partialCharge[0]",
  );
});
