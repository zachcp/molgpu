import { assertEquals, assertThrows } from "@std/assert";
import { createStructure } from "@molgpu/table";
import { data, fixture, validate, windows } from "./fixture.ts";

Deno.test("planning fixture preserves residue keys, probabilities and seven-mer membership", () => {
  validate(fixture, data);
  assertEquals(windows(data), [
    Array.from({ length: 7 }, (_, i) => i),
    Array.from({ length: 7 }, (_, i) => i + 1),
    Array.from({ length: 7 }, (_, i) => i + 2),
  ]);
  assertEquals(fixture.missing[4], 1);
  assertThrows(
    () => validate({ ...fixture, values: Float32Array.of(1) }, data),
    Error,
    "shape",
  );
  const values = fixture.values.slice();
  values[0] = -0.1;
  assertThrows(
    () => validate({ ...fixture, values }, data),
    Error,
    "invalid probability",
  );
  values[0] = 0.8;
  assertThrows(
    () => validate({ ...fixture, values }, data),
    Error,
    "sum to one",
  );
  const replacement = createStructure({
    positions: data.positions,
    topology: {
      ...data.topology,
      residues: {
        ...data.topology.residues,
        insertionCode: new Array(13).fill(""),
      },
    },
  });
  assertThrows(() => validate(fixture, replacement), Error, "layout identity");
});
