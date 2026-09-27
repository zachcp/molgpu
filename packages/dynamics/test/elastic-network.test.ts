import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  buildElasticNetwork,
  MAX_ELASTIC_DIM,
  solveElasticModes,
} from "../src/index.ts";

Deno.test("GNM path has analytical eigenvalues 1 and 3", () => {
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0);
  const network = buildElasticNetwork(positions, [0, 1, 2], 1.1);
  assertEquals([...network.pairs], [0, 1, 1, 2]);
  const modes = solveElasticModes(network, "gnm", 2);
  assertAlmostEquals(modes[0].eigenvalue, 1, 1e-8);
  assertAlmostEquals(modes[1].eigenvalue, 3, 1e-8);
  for (const mode of modes) {
    if (mode.residual > 1e-8) throw new Error("large GNM residual");
    assertEquals(mode.vector.length, 3);
    const pivot = [...mode.vector].reduce(
      (best, value, i, values) =>
        Math.abs(value) > Math.abs(values[best]) ? i : best,
      0,
    );
    if (mode.vector[pivot] < 0) throw new Error("mode sign is unstable");
  }
});

Deno.test("ANM triangle has three nontrivial modes and small residuals", () => {
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0);
  const network = buildElasticNetwork(positions, [0, 1, 2], 2);
  assertEquals(network.pairs.length / 2, 3);
  const modes = solveElasticModes(network, "anm", 3);
  assertEquals(modes.length, 3);
  [1, 2, 3].forEach((expected, i) =>
    assertAlmostEquals(modes[i].eigenvalue, expected, 1e-6)
  );
  for (const mode of modes) {
    assertEquals(mode.vector.length, 9);
    if (mode.residual > 1e-7) throw new Error("large ANM residual");
  }
  assertAlmostEquals(
    modes.reduce((sum, mode) => sum + mode.eigenvalue, 0),
    6,
    1e-5,
  );
});

Deno.test("elastic contact and dense dimension caps fail explicitly", () => {
  const positions = Float32Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0);
  assertThrows(
    () => buildElasticNetwork(positions, [0, 1, 2], 3, 1),
    RangeError,
    "contact cap",
  );
  assertThrows(
    () => buildElasticNetwork(positions, [0, 1, 2], 3, 100, 2),
    RangeError,
    "candidate cap",
  );
  assertThrows(
    () => buildElasticNetwork(positions, [1, 0], 2),
    TypeError,
    "sorted",
  );
  const far = Float32Array.from(
    { length: (MAX_ELASTIC_DIM + 1) * 3 },
    (_, i) => i % 3 === 0 ? i : 0,
  );
  const network = buildElasticNetwork(
    far,
    Uint32Array.from({ length: MAX_ELASTIC_DIM + 1 }, (_, i) => i),
    1,
  );
  assertThrows(
    () => solveElasticModes(network, "gnm", 1),
    RangeError,
    "dense limit",
  );
});
