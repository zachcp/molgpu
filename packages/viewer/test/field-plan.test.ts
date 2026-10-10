import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import {
  attribute,
  byElement,
  categorical,
  COLOR,
  colormap,
  curve,
  joinAnnotation,
  volumeSample,
} from "@molgpu/fields";
import {
  createStructure,
  createVolumeGrid,
  type StructureData,
} from "@molgpu/table";
import { planField } from "../src/field-binding/field-plan.ts";

// Two residues of two atoms each, in one chain.
const structure = (atoms = 4): StructureData =>
  createStructure({
    positions: new Float32Array(atoms * 3),
    topology: {
      atoms: {
        count: atoms,
        id: Array.from({ length: atoms }, (_, i) => String(i + 1)),
        name: Array.from({ length: atoms }, (_, i) => `C${i}`),
        altloc: Array.from({ length: atoms }, () => ""),
        residue: Uint32Array.from({ length: atoms }, (_, i) => i >> 1),
        element: new Uint8Array(atoms).fill(6),
        occupancy: new Float32Array(atoms).fill(1),
        bfactor: new Float32Array(atoms),
        radius: new Float32Array(atoms).fill(1.7),
      },
      residues: {
        count: atoms >> 1,
        chain: new Uint32Array(atoms >> 1),
        labelSeq: Int32Array.from({ length: atoms >> 1 }, (_, i) => i + 1),
        authSeq: Array.from({ length: atoms >> 1 }, (_, i) => String(i + 1)),
        insertionCode: Array.from({ length: atoms >> 1 }, () => ""),
        comp: Array.from({ length: atoms >> 1 }, () => "GLY"),
        polymer: Array.from({ length: atoms >> 1 }, () => "protein"),
      },
      chains: {
        count: 1,
        model: new Int32Array([1]),
        labelId: ["A"],
        authId: ["A"],
      },
      bonds: {
        count: 0,
        a: new Uint32Array(),
        b: new Uint32Array(),
        order: new Uint8Array(),
        source: [],
      },
      instances: {
        count: 1,
        chain: new Uint32Array([0]),
        operatorId: ["identity"],
        transform: Float64Array.from([
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
        ]),
      },
    },
  });

const GRID = createVolumeGrid({
  dims: [4, 4, 4],
  transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
});
const RAMP = [[0, [0, 0, 1, 1]], [1, [1, 0, 0, 1]]] as const;
const records = [
  { chainLabel: "A", labelSeq: 1, value: [0, 1, 0, 1] },
  { chainLabel: "A", labelSeq: 2, value: [1, 0, 0, 1] },
];

Deno.test("no field and flat colours plan nothing", () => {
  const plan = planField(null, structure(), undefined, "Spacefill");
  assertEquals(plan.attrNames, []);
  assertStrictEquals(plan.annotation, null);
});

Deno.test("attribute fields gather their columns, lifted ones through residue", () => {
  const data = structure();
  assertEquals(
    planField(byElement(), data, undefined, "Spacefill").attrNames,
    ["element"],
  );
  const lifted = categorical(
    attribute("labelSeq", { domain: "atom" }),
    { 1: [0, 0, 1, 1] },
    [0, 1, 0, 1],
  );
  assertEquals(
    planField(lifted, data, undefined, "Bonds").attrNames,
    ["residue", "labelSeq"],
  );
});

Deno.test("nearest volumeSample compiles against the nearest grid, never a fake one", () => {
  const nearest = colormap(volumeSample(), RAMP);
  assertThrows(
    () => planField(nearest, structure(), undefined, "Spacefill"),
    TypeError,
    "Spacefill colour field volumeSample() needs a <Volume> or <EField> ancestor",
  );
  const plan = planField(nearest, structure(), GRID, "Spacefill");
  assertEquals(plan.attrNames, []);
  assertStrictEquals(plan.annotation, null);
  // A time-driven field needs neither columns nor a volume.
  assertEquals(
    planField(
      colormap(curve([[0, 0], [1, 1]]), RAMP),
      structure(),
      undefined,
      "Surface",
    )
      .attrNames,
    [],
  );
});

Deno.test("annotation joins bake their lifted rows for upload", () => {
  const data = structure();
  const colour = joinAnnotation(data, records, {
    fields: ["chainLabel", "labelSeq"],
    type: COLOR,
  });
  const plan = planField(colour, data, undefined, "Surface");
  assertEquals(plan.attrNames, []);
  assertEquals(plan.annotation?.key, "annotation");
  assertEquals(plan.annotation?.format, "vec4<f32>");
  assertEquals(
    [...plan.annotation!.data],
    [0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
  );
  const scalar = colormap(
    joinAnnotation(data, [
      { chainLabel: "A", labelSeq: 1, value: 0 },
      { chainLabel: "A", labelSeq: 2, value: 1 },
    ], { fields: ["chainLabel", "labelSeq"] }),
    RAMP,
  );
  const scalarPlan = planField(scalar, data, undefined, "Bonds");
  assertEquals(scalarPlan.annotation?.format, "f32");
  assertEquals([...scalarPlan.annotation!.data], [0, 0, 1, 1]);
});

Deno.test("annotations in the wrong domain or for another structure fail", () => {
  const data = structure();
  const residueRows = joinAnnotation(data, records, {
    fields: ["chainLabel", "labelSeq"],
    type: COLOR,
    lift: false,
  });
  assertThrows(
    () => planField(residueRows, data, undefined, "Spacefill"),
    TypeError,
    "mixes atom and residue domains",
  );
  const other = joinAnnotation(structure(6), records, {
    fields: ["chainLabel", "labelSeq"],
    type: COLOR,
  });
  assertThrows(
    () => planField(other, data, undefined, "Spacefill"),
    TypeError,
    "has 6 rows; the structure has 4 atom rows",
  );
});
