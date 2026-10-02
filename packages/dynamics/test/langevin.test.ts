import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  buildElasticNetwork,
  enmSprings,
  fitKabsch,
  kineticTemperature,
  langevinInit,
  langevinParams,
  langevinStep,
  langevinSystem,
  solveElasticModes,
} from "../src/index.ts";
import { ACCELERATION_UNIT, BOLTZMANN } from "../src/langevin.ts";
import { langevinNormals, philox4x32, philoxNormal } from "../src/philox.ts";
import { rotationDegrees, TOY_K, toyNetwork } from "./langevin-fixture.ts";

const hex = (words: Uint32Array) =>
  [...words].map((w) => w.toString(16).padStart(8, "0")).join(" ");

Deno.test("Philox-4x32-10 matches the Random123 known-answer vectors", () => {
  assertEquals(
    hex(philox4x32([0, 0, 0, 0], [0, 0])),
    "6627e8d5 e169c58d bc57ac4c 9b00dbd8",
  );
  const ones = 0xffffffff;
  assertEquals(
    hex(philox4x32([ones, ones, ones, ones], [ones, ones])),
    "408f276d 41c83b0e a20bc7c6 6d5451fd",
  );
  assertEquals(
    hex(
      philox4x32(
        [0x243f6a88, 0x85a308d3, 0x13198a2e, 0x03707344],
        [0xa4093822, 0x299f31d0],
      ),
    ),
    "d16cfe09 94fdcceb 5001e420 24126ea1",
  );
});

Deno.test("inverse-CDF normals are standard, finite and symmetric", () => {
  let sum = 0, sum2 = 0, sum4 = 0;
  const n = 200_000;
  for (let i = 0; i < n; i++) {
    for (const z of langevinNormals(5, 11, i)) {
      sum += z;
      sum2 += z * z;
      sum4 += z ** 4;
    }
  }
  const count = 3 * n;
  assertAlmostEquals(sum / count, 0, 5e-3);
  assertAlmostEquals(sum2 / count, 1, 6e-3);
  assertAlmostEquals(sum4 / count, 3, 4e-2);
  // The extreme u32 inputs map to symmetric, finite tails.
  assertEquals(philoxNormal(0), -philoxNormal(0xffffffff));
  assert(Math.abs(philoxNormal(0)) < 6);
  assert(Math.abs(philoxNormal(0x80000000)) < 1e-6);
});

Deno.test("enmSprings stores each contact in both directions, sorted", () => {
  const { network, system } = toyNetwork();
  const { offsets, neighbours, restLength } = system.springs;
  assertEquals(neighbours.length, network.pairs.length);
  for (let i = 0; i < system.springs.nodeCount; i++) {
    for (let j = offsets[i]; j < offsets[i + 1]; j++) {
      if (j > offsets[i]) assert(neighbours[j] > neighbours[j - 1]);
      const other = neighbours[j];
      const back = neighbours.subarray(offsets[other], offsets[other + 1])
        .indexOf(i);
      assert(back >= 0, "missing reverse spring");
      assertEquals(restLength[offsets[other] + back], restLength[j]);
    }
  }
});

Deno.test("f64 BAOAB samples kT H+ in configuration and the predicted kinetic temperature", () => {
  const { positions, network, system } = toyNetwork();
  const params = langevinParams(system, { seed: 7 });
  const modes = solveElasticModes(network, "anm", 144, { method: "dense" });
  assertEquals(modes.length, 144);
  const kT = BOLTZMANN * params.temperature;
  const expected = new Float64Array(50);
  let kinetic = 0, slowest = Infinity;
  for (const mode of modes) {
    const lambda = TOY_K * mode.eigenvalue;
    for (let i = 0; i < 150; i++) {
      expected[Math.floor(i / 3)] += kT * mode.vector[i] ** 2 / lambda;
    }
    const omega = Math.sqrt(ACCELERATION_UNIT * lambda / 110);
    slowest = Math.min(slowest, omega);
    kinetic += 1 - (omega * params.dt) ** 2 / 4;
  }
  kinetic *= params.temperature / modes.length;
  // At gamma = 1 the slowest mode is underdamped and decorrelates in about
  // 2 / gamma; run more than 500 of those after equilibration.
  assert(slowest > params.gamma / 2);
  const steps = 100_000;
  assert(steps * params.dt > 500 * 2 / params.gamma);
  const state = langevinInit(system, params);
  langevinStep(system, params, state, 2000);
  const sum = new Float64Array(150), sum2 = new Float64Array(150);
  let temperature = 0;
  for (let s = 0; s < steps; s++) {
    langevinStep(system, params, state);
    for (let j = 0; j < 150; j++) {
      const d = state.x[j] - positions[j];
      sum[j] += d;
      sum2[j] += d * d;
    }
    temperature += kineticTemperature(system, state);
  }
  let error = 0;
  for (let i = 0; i < 50; i++) {
    let variance = 0;
    for (let c = 0; c < 3; c++) {
      const mean = sum[3 * i + c] / steps;
      variance += sum2[3 * i + c] / steps - mean * mean;
    }
    error += Math.abs(variance / expected[i] - 1);
  }
  assert(error / 50 < 0.05, `mean relative variance error ${error / 50}`);
  const measured = temperature / steps;
  assert(
    Math.abs(measured / kinetic - 1) < 0.01,
    `kinetic ${measured} K, predicted ${kinetic} K`,
  );
});

Deno.test("the projected integrator neither drifts nor rotates", () => {
  const { positions, system } = toyNetwork();
  const params = langevinParams(system, { seed: 3 });
  const state = langevinInit(system, params);
  langevinStep(system, params, state, 20_000);
  const centroid = [0, 0, 0];
  for (let i = 0; i < 50; i++) {
    for (let c = 0; c < 3; c++) {
      centroid[c] += (state.x[3 * i + c] - positions[3 * i + c]) / 50;
    }
  }
  assert(Math.hypot(...centroid) < 1e-6, `centroid moved ${centroid}`);
  const fit = fitKabsch(Float32Array.from(state.x), positions);
  assert(rotationDegrees(fit.matrix) < 1, "network rotated");
});

Deno.test("the tug pulls one node without net force or torque", () => {
  const { positions, system } = toyNetwork();
  const target = [positions[0] + 2, positions[1], positions[2]] as const;
  const params = langevinParams(system, {
    temperature: 0,
    tug: { node: 0, target, k: 1 },
  });
  const state = langevinInit(system, params);
  const total = [0, 0, 0], torque = [0, 0, 0];
  for (let i = 0; i < 50; i++) {
    const r = system.relative.subarray(3 * i, 3 * i + 3);
    const f = state.f.subarray(3 * i, 3 * i + 3);
    for (let c = 0; c < 3; c++) total[c] += f[c];
    torque[0] += r[1] * f[2] - r[2] * f[1];
    torque[1] += r[2] * f[0] - r[0] * f[2];
    torque[2] += r[0] * f[1] - r[1] * f[0];
  }
  // Residuals come from f32 rest lengths and relative positions: about 1e-8
  // of the 2 kcal/mol/Å pull and its ~20 kcal/mol torque.
  assert(Math.hypot(...total) < 1e-6 && Math.hypot(...torque) < 1e-5);
  assert(state.f[0] > 1.5, "the pulled node feels most of the pull");
  langevinStep(system, params, state, 5000);
  assert(state.x[0] > positions[0] + 0.1, "the pulled node moved");
});

Deno.test("same seed and step reproduce bitwise; seeds differ", () => {
  const { system } = toyNetwork();
  const run = (seed: number, precision: "f32" | "f64") => {
    const params = langevinParams(system, { seed });
    const state = langevinInit(system, params, precision);
    langevinStep(system, params, state, 200);
    return state;
  };
  for (const precision of ["f32", "f64"] as const) {
    const a = run(9, precision), b = run(9, precision), c = run(10, precision);
    assertEquals(a.step, 200);
    assertEquals([...a.x], [...b.x]);
    assertEquals([...a.v], [...b.v]);
    assert(a.x.some((value, i) => value !== c.x[i]));
  }
});

Deno.test("dt guard, masses and degenerate references are checked", () => {
  const { system, network, positions } = toyNetwork();
  assert(system.omegaMax * 0.02 < 1);
  assertThrows(
    () => langevinParams(system, { dt: 2 / system.omegaMax }),
    RangeError,
    "omegaMax",
  );
  assertThrows(
    () =>
      langevinParams(system, {
        tug: { node: 0, target: [0, 0, 0], k: 1e6 },
      }),
    RangeError,
  );
  assertThrows(() => langevinParams(system, { seed: -1 }), TypeError);
  const springs = enmSprings(network, positions, TOY_K);
  assertThrows(
    () => langevinSystem(springs, positions, new Float32Array(50)),
    TypeError,
    "masses",
  );
  const line = Float32Array.of(0, 0, 0, 3, 0, 0, 6, 0, 0);
  const chain = buildElasticNetwork(line, [0, 1, 2], 7);
  assertThrows(
    () => langevinSystem(enmSprings(chain, line), line),
    TypeError,
    "collinear",
  );
  assertAlmostEquals(system.totalMass, 50 * 110, 1e-9);
});
