import { assertEquals, assertThrows } from "@std/assert";
import type { Topology } from "@molgpu/table";
import { applyNormalMode } from "../src/normal-mode.ts";
import {
  buildElasticNetwork,
  normalModeFromElastic,
  residueGuideMap,
  solveElasticModes,
} from "../src/index.ts";
import { normalModeWgsl, validateNormalMode } from "../src/wgsl.ts";

Deno.test("normal mode follows residue mapping and reverses under scrubbing", () => {
  const positions = Float32Array.of(1, 0, 0, 2, 0, 0, 3, 0, 0);
  const mode = {
    vectors: Float32Array.of(1, 2, 3),
    atomToNode: Uint32Array.of(0, 0, 0xffffffff),
    version: 1,
  };
  assertEquals([...applyNormalMode(positions, mode, 2, 1, 0.25)], [
    3,
    4,
    6,
    4,
    4,
    6,
    3,
    0,
    0,
  ]);
  assertEquals([...applyNormalMode(positions, mode, 2, 1, 0.75)], [
    -1,
    -4,
    -6,
    0,
    -4,
    -6,
    3,
    0,
    0,
  ]);
  assertEquals([...applyNormalMode(positions, mode, 2, 1, 0)], [...positions]);
  assertEquals([...positions], [1, 0, 0, 2, 0, 0, 3, 0, 0]);
  const swapped = { ...mode, vectors: Float32Array.of(0, 0, 5), version: 2 };
  assertEquals([...applyNormalMode(positions, swapped, 2, 1, 0.25)], [
    1,
    0,
    10,
    2,
    0,
    10,
    3,
    0,
    0,
  ]);
});

Deno.test("normal mode validates mapping and WGSL source", () => {
  const mode = {
    vectors: Float32Array.of(1, 0, 0),
    atomToNode: Uint32Array.of(1),
    version: 1,
  };
  assertThrows(() => validateNormalMode(mode, 1), TypeError, "mapping");
  assertThrows(
    () =>
      applyNormalMode(
        Float32Array.of(0, 0, 0),
        { ...mode, atomToNode: Uint32Array.of(0) },
        NaN,
        1,
        0,
      ),
    TypeError,
  );
  assertThrows(
    () =>
      applyNormalMode(
        Float32Array.of(NaN, 0, 0),
        { ...mode, atomToNode: Uint32Array.of(0) },
        1,
        1,
        0,
      ),
    TypeError,
    "positions must be finite",
  );
  if (
    !normalModeWgsl.includes("getScale()") ||
    !normalModeWgsl.includes("0xffffffffu")
  ) {
    throw new Error(
      "normal mode WGSL is missing its uniform or absent mapping",
    );
  }
});

// Residue 0: N, CA; residue 1: N, CA/A, CA/B, CB/A, CB/B; residue 2: HOH (no
// guide).
function residues(): Topology {
  const name = ["N", "CA", "N", "CA", "CA", "CB", "CB", "O"];
  const altloc = ["", "", "", "A", "B", "A", "B", ""];
  const n = name.length;
  return {
    atoms: {
      count: n,
      id: name.map((_, i) => String(i + 1)),
      name,
      altloc,
      residue: Uint32Array.of(0, 0, 1, 1, 1, 1, 1, 2),
      element: new Uint8Array(n).fill(6),
      occupancy: new Float32Array(n).fill(1),
      bfactor: new Float32Array(n),
    },
    residues: {
      count: 3,
      chain: new Uint32Array(3),
      labelSeq: Int32Array.of(1, 2, 3),
      authSeq: ["1", "2", "3"],
      insertionCode: ["", "", ""],
      comp: ["GLY", "ALA", "HOH"],
      polymer: ["protein", "protein", "water"],
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
      count: 0,
      chain: new Uint32Array(),
      operatorId: [],
      transform: new Float64Array(),
    },
  } as unknown as Topology;
}

Deno.test("residue atoms follow their guide, matching altlocs", () => {
  // Guides: residue 0 CA (node 0), residue 1 CA/A (node 1) and CA/B (node 2).
  const map = residueGuideMap(residues(), [1, 3, 4]);
  const X = 0xffffffff;
  // N of residue 1 has no altloc and follows the first guide (CA/A).
  assertEquals([...map], [0, 0, 1, 1, 2, 1, 2, X]);
  assertThrows(
    () => residueGuideMap(residues(), [3, 1]),
    TypeError,
    "sorted",
  );
});

Deno.test("an ANM mode becomes NormalMode input; GNM is rejected", () => {
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0);
  const network = buildElasticNetwork(positions, [0, 1, 2], 2);
  const [anm] = solveElasticModes(network, "anm", 1);
  const map = Uint32Array.of(0, 1, 2);
  const data = normalModeFromElastic(anm, map, 7);
  assertEquals(data.version, 7);
  assertEquals([...data.vectors], [...anm.vector]);
  const moved = applyNormalMode(positions, data, 1, 0, 0, Math.PI / 2);
  assertEquals(
    [...moved].map((v) => +v.toFixed(5)),
    [...positions].map((v, i) => +(v + anm.vector[i]).toFixed(5)),
  );
  const [gnm] = solveElasticModes(network, "gnm", 1);
  assertThrows(() => normalModeFromElastic(gnm, map, 1), TypeError, "GNM");
  assertThrows(
    () => normalModeFromElastic(anm, Uint32Array.of(0, 3, 0), 1),
    TypeError,
    "out of range",
  );
});
