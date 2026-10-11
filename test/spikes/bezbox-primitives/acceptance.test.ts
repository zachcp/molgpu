/** Research-only executable contract example; no renderer or allocation owner. */
import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import type { ArchetypeSchema } from "@use-gpu/core";
import {
  adjustSchema,
  schemaToArchetype,
  schemaToAttributes,
} from "@use-gpu/core/mjs/archetype.mjs";
import { createTrajectory, createVolume } from "@molgpu/table";
import { createRequire } from "node:module";
// Research-only pin; keep the production import map and lock unchanged.
// deno-lint-ignore no-import-prefix
import type { TraitProps } from "npm:@use-gpu/traits@0.21.0-rc.2";

// The pinned traits ESM entry imports missing Live named exports under Deno.
// Its require export supports this CPU-only probe; browser code uses bundling.
const { combine, parseTrait, trait } = createRequire(import.meta.url)(
  "@use-gpu/traits",
) as typeof import("npm:@use-gpu/traits@0.21.0-rc.2");

// A storage layout describes values. It deliberately says nothing about units,
// dimensions, ownership, async readiness, atom mapping or source replacement.
const SAMPLE_SCHEMA = {
  values: { format: "array<f32>", separate: true },
} satisfies ArchetypeSchema;

const XYZ_SCHEMA = {
  positions: { format: "array<vec3<f32>>" },
} satisfies ArchetypeSchema;

// A trait experiment uses strict scientific parsing, not parseNumber's coercion.
const positive = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("expected a positive finite number");
  }
  return value;
};
const StyleTraits = combine(
  trait({ width: positive }, { width: 3 }),
  trait({ scale: positive }, { scale: 1 }),
);
type StyleProps = TraitProps<typeof StyleTraits>;

Deno.test("traits can infer optional defaults while preserving strict validation", () => {
  const props: StyleProps = {};
  assertEquals(parseTrait(props, StyleTraits), { width: 3, scale: 1 });
  assertEquals(parseTrait({ width: 2 }, StyleTraits), { width: 2, scale: 1 });
  for (const width of [0, -1, NaN, Infinity]) {
    assertThrows(() => parseTrait({ width }, StyleTraits), TypeError);
  }
});

Deno.test("schema extraction borrows immutable samples without introducing a copy", () => {
  const values = Float32Array.of(1, 2, 3, 4);
  const attributes = schemaToAttributes(SAMPLE_SCHEMA, { values });
  assertStrictEquals(attributes.values, values);
  assertEquals(Array.from(values), [1, 2, 3, 4]);
});

Deno.test("schema archetype is layout identity, not content revision", () => {
  const a = schemaToAttributes(SAMPLE_SCHEMA, { values: Float32Array.of(1) });
  const b = schemaToAttributes(SAMPLE_SCHEMA, { values: Float32Array.of(9) });
  assertEquals(
    schemaToArchetype(SAMPLE_SCHEMA, a),
    schemaToArchetype(SAMPLE_SCHEMA, b),
  );
  const adjusted = adjustSchema(XYZ_SCHEMA, { positions: "vec4<f32>" });
  assertEquals(adjusted.positions.format, "array<vec4<f32>>");
  assertEquals(XYZ_SCHEMA.positions.format, "array<vec3<f32>>");
});

Deno.test("volume validation remains separate from schema extraction", () => {
  const transform = Float32Array.of(
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  );
  const values = Float32Array.of(1, 2);
  const volume = createVolume({
    values,
    dims: [2, 1, 1],
    transform,
    unit: "kT/e",
  });
  assertStrictEquals(
    schemaToAttributes(SAMPLE_SCHEMA, { values: volume.values }).values,
    values,
  );
  assertEquals(volume.unit, "kT/e");
  // Attribute extraction does not validate the grid's sample count.
  assertStrictEquals(
    schemaToAttributes(SAMPLE_SCHEMA, { values }).values,
    values,
  );
  assertThrows(
    () => createVolume({ values, dims: [3, 1, 1], transform }),
    TypeError,
  );
});

Deno.test("trajectory schema leaves fixed-row mapping and time units intact", async () => {
  const positions = Float32Array.of(1, 2, 3);
  const trajectory = createTrajectory({
    atomCount: 1,
    frames: [{ positions }],
    atomMap: [2],
    time: [10],
    timeUnit: "ps",
  });
  const frame = await trajectory.source.read(0);
  const attributes = schemaToAttributes(XYZ_SCHEMA, {
    positions: frame.positions,
  });
  assertStrictEquals(attributes.positions, frame.positions);
  assertEquals(Array.from(trajectory.atomMap!), [2]);
  assertEquals(trajectory.timeUnit, "ps");
  assertEquals(Array.from(frame.positions), [1, 2, 3]);
  // This is NOT a vec3 storage upload: packed XYZ still needs its current adapter.
});
