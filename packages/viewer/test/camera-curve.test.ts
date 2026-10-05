import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { createStructure, withPositions } from "@molgpu/table";
import { all, resolve, where } from "@molgpu/select";
import { createStructureResource } from "../src/internal/structure-resource.ts";
import { focusSelection, sampleCamera } from "../src/camera-curve.ts";
import type { CameraCurve } from "../src/types.ts";

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const shifted = [...identity];
shifted[12] = 10;
const data = createStructure({
  positions: Float32Array.from([0, 0, 0, 2, 0, 0]),
  topology: {
    atoms: {
      count: 2,
      id: ["1", "2"],
      name: ["C", "O"],
      altloc: ["", ""],
      residue: Uint32Array.from([0, 0]),
      element: Uint8Array.from([6, 8]),
      occupancy: Float32Array.of(1, 1),
      bfactor: new Float32Array(2),
      radius: Float32Array.of(1, 1),
    },
    residues: {
      count: 1,
      chain: Uint32Array.of(0),
      labelSeq: Int32Array.of(1),
      authSeq: ["1"],
      insertionCode: [""],
      comp: ["GLY"],
      polymer: ["protein"],
    },
    chains: {
      count: 1,
      model: Int32Array.of(1),
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
      count: 2,
      chain: Uint32Array.of(0, 0),
      operatorId: ["id", "shift"],
      transform: Float64Array.from([...identity, ...shifted]),
    },
  },
});

Deno.test("focus includes displayed radii and every drawn assembly copy", () => {
  const resource = createStructureResource(data);
  const view = focusSelection(resource, all("atom"));
  assert(view);
  // Both copies are drawn: the identity and the +10 Å operator.
  assertEquals(view.bounds, {
    min: [-1, -1, -1],
    max: [13, 1, 1],
    center: [6, 0, 0],
  });
  assertEquals(view.target, [6, 0, 0]);
  assert(view.radius > 14);
  assertEquals(
    focusSelection(resource, all("atom"), { atomRadiusScale: 0 })?.bounds?.min,
    [0, 0, 0],
  );
  resource.dispose();
  assertThrows(() => focusSelection(resource, all("atom")), Error, "disposed");
});

Deno.test("empty focus has a defined full-structure fallback or no-op", () => {
  const resource = createStructureResource(data);
  const none = where("atom", "none", () => false);
  assertEquals(focusSelection(resource, none)?.target, [6, 0, 0]);
  assertStrictEquals(focusSelection(resource, none, { empty: "null" }), null);
  assertThrows(
    () => focusSelection(resource, none, { empty: "error" }),
    Error,
    "empty",
  );
  assertEquals(
    focusSelection(resource, resolve(all("atom"), data))?.target,
    focusSelection(resource, all("atom"))?.target,
  );
});

Deno.test("camera focus resolves current positions on every sample and rewinds", () => {
  let evaluations = 0;
  const query = where("atom", "oxygen", (table, i) => {
    evaluations++;
    return table.topology.atoms.element[i] === 8;
  });
  const curve: CameraCurve = [
    { time: 0, target: [0, 0, 0], radius: 20, bearing: 0, pitch: 0 },
    { time: 2, focus: query, bearing: 1, pitch: 0.25 },
  ];
  const first = createStructureResource(data);
  const start = sampleCamera(curve, 0, first);
  const end = sampleCamera(curve, 2, first);
  assertEquals(start.target, [0, 0, 0]);
  assertEquals(end.target, [7, 0, 0]);
  assertEquals(sampleCamera(curve, 1, first).target, [3.5, 0, 0]);
  assertEquals(sampleCamera(curve, 0, first), start);
  assertStrictEquals(
    evaluations,
    2,
    "same resource caches the resolved focus while scrubbing",
  );

  const moved = createStructureResource(
    withPositions(data, Float32Array.from([0, 0, 0, 4, 0, 0])),
  );
  assertEquals(sampleCamera(curve, 2, moved).target, [9, 0, 0]);
  assertEquals(sampleCamera(curve, 0, moved), start);
  assertStrictEquals(
    evaluations,
    4,
    "coordinate revision re-resolves the query",
  );

  const swapped = createStructureResource(createStructure({
    topology: data.topology,
    positions: Float32Array.from([0, 0, 0, 8, 0, 0]),
  }));
  assertEquals(sampleCamera(curve, 2, swapped).target, [13, 0, 0]);
  assertStrictEquals(
    evaluations,
    6,
    "dataset replacement re-resolves the query",
  );
});

Deno.test("sampled camera curves are validated on the public path", () => {
  const resource = createStructureResource(data);
  const fixed = { target: [0, 0, 0], radius: 5, bearing: 0, pitch: 0 };
  const cases: [CameraCurve, ErrorConstructor, string][] = [
    [[{ time: 0, ...fixed }], TypeError, "two frames"],
    [[{ time: 1, ...fixed }, { time: 1, ...fixed }], RangeError, "increase"],
    [
      [{ time: 0, ...fixed }, { time: 1, ...fixed, radius: 0 }],
      RangeError,
      "radius must be positive",
    ],
    [
      [{ time: 0, ...fixed }, { time: 1, ...fixed, target: [0, NaN, 0] }],
      TypeError,
      "frame 1 target[1] must be finite",
    ],
    [
      [{ time: 0, ...fixed }, { time: 1, ...fixed, pitch: Infinity }],
      TypeError,
      "frame 1 pitch must be finite",
    ],
  ];
  for (const [curve, type, message] of cases) {
    assertThrows(() => sampleCamera(curve, 0.5, resource), type, message);
  }
});
