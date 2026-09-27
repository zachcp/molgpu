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
    () => solveElasticModes(network, "gnm", 1, { method: "dense" }),
    RangeError,
    "dense limit",
  );
  // Above the dense limit, Lanczos finds that no contact means no motion.
  assertThrows(
    () => solveElasticModes(network, "gnm", 1),
    RangeError,
    "only 0 nontrivial modes",
  );
});

// ProDy 2.6.1 ANM (15 Å) and GNM (7.3 Å) modes on corpus CA coordinates,
// gamma 1; regenerate with test/fixtures/prody_modes.py.
const PRODY = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/prody-modes.json", import.meta.url),
  ),
) as {
  structures: Record<
    string,
    & { ca: number[] }
    & Record<
      "anm" | "gnm",
      { cutoff: number; eigenvalues: number[]; vectors: number[][] }
    >
  >;
};

const overlap = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return Math.abs(sum);
};

for (const [id, entry] of Object.entries(PRODY.structures)) {
  for (const kind of ["anm", "gnm"] as const) {
    Deno.test(`${kind.toUpperCase()} modes of ${id} match ProDy`, () => {
      const ca = Float32Array.from(entry.ca);
      const rows = Uint32Array.from({ length: ca.length / 3 }, (_, i) => i);
      const reference = entry[kind];
      const network = buildElasticNetwork(ca, rows, reference.cutoff);
      // 1crn is solved densely by default and 1tqn by Lanczos; 1crn is also
      // forced through Lanczos so both paths meet the same oracle.
      const methods = rows.length * (kind === "anm" ? 3 : 1) <= MAX_ELASTIC_DIM
        ? ["auto", "lanczos"] as const
        : ["auto"] as const;
      for (const method of methods) {
        const modes = solveElasticModes(network, kind, 5, { method });
        modes.forEach((mode, i) => {
          const want = reference.eigenvalues[i];
          const label = `${id} ${kind} ${method} mode ${i}`;
          if (Math.abs(mode.eigenvalue / want - 1) > 1e-6) {
            throw new Error(`${label}: ${mode.eigenvalue} vs ${want}`);
          }
          const dot = overlap(mode.vector, reference.vectors[i]);
          if (Math.abs(dot - 1) > 1e-5) {
            throw new Error(`${label}: overlap ${dot}`);
          }
          if (mode.residual > 1e-6) throw new Error(`${label}: residual`);
        });
      }
    });
  }
}

Deno.test("Lanczos restarts through repeated eigenvalues of disjoint components", () => {
  // Two identical, well-separated triangles: every ANM eigenvalue is doubled.
  const positions = Float32Array.of(
    ...[0, 0, 0, 1, 0, 0, 0, 1, 0],
    ...[50, 0, 0, 51, 0, 0, 50, 1, 0],
  );
  const network = buildElasticNetwork(positions, [0, 1, 2, 3, 4, 5], 2);
  const dense = solveElasticModes(network, "anm", 6, { method: "dense" });
  const sparse = solveElasticModes(network, "anm", 6, { method: "lanczos" });
  assertEquals(dense.map((m) => +m.eigenvalue.toFixed(6)), [1, 1, 2, 2, 3, 3]);
  sparse.forEach((mode, i) => {
    assertAlmostEquals(mode.eigenvalue, dense[i].eigenvalue, 1e-9);
    if (mode.residual > 1e-9) throw new Error("large Lanczos residual");
  });
  // The two copies of each eigenvalue span two orthogonal directions.
  for (let i = 0; i < 6; i += 2) {
    assertAlmostEquals(
      overlap(sparse[i].vector, sparse[i + 1].vector),
      0,
      1e-6,
    );
  }
  assertThrows(
    () => solveElasticModes(network, "anm", 7, { method: "lanczos" }),
    RangeError,
    "only 6 nontrivial modes",
  );
});

Deno.test("elastic solver options are validated and Lanczos caps its basis", () => {
  const ca = Float32Array.from(PRODY.structures["1tqn"].ca);
  const rows = Uint32Array.from({ length: ca.length / 3 }, (_, i) => i);
  const network = buildElasticNetwork(ca, rows, 7.3);
  assertThrows(
    () =>
      solveElasticModes(network, "gnm", 1, {
        method: "qr" as unknown as "dense",
      }),
    TypeError,
    "method",
  );
  assertThrows(
    () => solveElasticModes(network, "gnm", 1, { maxIterations: 0 }),
    TypeError,
    "maxIterations",
  );
  assertThrows(
    () => solveElasticModes(network, "gnm", 5, { maxIterations: 8 }),
    RangeError,
    "did not converge",
  );
});
