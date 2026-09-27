import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  COULOMB_CONSTANT,
  coulombField,
  coulombGrid,
  coulombPotential,
  debyeKappa,
  GAS_CONSTANT_KCAL,
  gridPoints,
  packCharges,
} from "../src/electrostatics.ts";
import { COULOMB_PARAMS_BYTES, coulombParams } from "../src/wgsl.ts";
import { electrostatics } from "../src/index.ts";

const close = (actual: number, expected: number, rel = 1e-9) =>
  assertAlmostEquals(
    actual,
    expected,
    Math.abs(expected) * rel + 1e-300,
    `${actual} vs ${expected}`,
  );

Deno.test("physical constants match CODATA-derived textbook values", () => {
  close(COULOMB_CONSTANT, 332.0637133, 1e-8);
  close(GAS_CONSTANT_KCAL, 0.00198720426, 1e-8);
  close(electrostatics({ temperature: 298.15 }).kT, 0.5924849, 1e-6);
  // CODATA value, and the textbook 0.304/sqrt(I) nm in water at 25 °C.
  const lambda = 1 / debyeKappa(0.15, 78.54, 298.15);
  close(lambda, 7.8566, 2e-5);
  close(lambda, 3.04 / Math.sqrt(0.15), 5e-3);
  assertEquals(debyeKappa(0, 78.54, 298.15), 0);
});

Deno.test("defaults: distance model, D = 4, kT/e", () => {
  const p = electrostatics();
  assertEquals(p.model, "distance");
  assertEquals(p.epsilon, 4);
  assertEquals(p.unit, "kT/e");
  assertEquals(p.minDistance, 1);
  assertEquals(p.kappa, 0);
  close(p.scale, COULOMB_CONSTANT / 4 / p.kT);
  assertEquals(electrostatics({ model: "vacuum" }).epsilon, 1);
  assertEquals(electrostatics({ model: "debye" }).epsilon, 78.54);
  assertThrows(() => electrostatics({ epsilon: 0 }), RangeError);
  assertThrows(() => electrostatics({ ionicStrength: -1 }), RangeError);
  assertThrows(
    // deno-lint-ignore no-explicit-any
    () => electrostatics({ model: "pb" as any }),
    TypeError,
  );
});

Deno.test("single charge: every model's potential and field in closed form", () => {
  const atoms = Float32Array.of(1, 2, 3, -0.5);
  const point = [1 + 3, 2 + 4, 3]; // r = 5
  const r = 5, q = -0.5;
  const unit = { unit: "kcal/mol/e" } as const;
  const cases = [
    {
      model: "vacuum",
      phi: COULOMB_CONSTANT * q / r,
      e: COULOMB_CONSTANT * q / r ** 2,
    },
    {
      model: "distance",
      phi: COULOMB_CONSTANT * q / (4 * r * r),
      e: 2 * COULOMB_CONSTANT * q / (4 * r ** 3),
    },
  ] as const;
  for (const c of cases) {
    const phi = coulombPotential(point, atoms, { model: c.model, ...unit });
    close(phi[0], c.phi, 1e-6);
    const field = coulombField(point, atoms, { model: c.model, ...unit });
    // E points along r̂ = (3, 4, 0)/5 with signed magnitude c.e.
    close(field[0], c.e * 0.6, 1e-6);
    close(field[1], c.e * 0.8, 1e-6);
    assertEquals(field[2], 0);
  }
  const debye = electrostatics({ model: "debye", ...unit });
  const k = debye.kappa;
  close(
    coulombPotential(point, atoms, debye)[0],
    COULOMB_CONSTANT * q * Math.exp(-k * r) / (78.54 * r),
    1e-6,
  );
  close(
    coulombField(point, atoms, debye)[1],
    COULOMB_CONSTANT * q * (1 + k * r) * Math.exp(-k * r) / (78.54 * r * r) *
      0.8,
    1e-6,
  );
});

Deno.test("kT/e is kcal/mol/e divided by kT", () => {
  const atoms = Float32Array.of(0, 0, 0, 1);
  const kcal = coulombPotential([0, 0, 7], atoms, { unit: "kcal/mol/e" })[0];
  const kt = coulombPotential([0, 0, 7], atoms, { temperature: 310 })[0];
  close(kt, kcal / (GAS_CONSTANT_KCAL * 310));
});

Deno.test("field is minus the gradient of the potential for every model", () => {
  const atoms = Float32Array.of(
    ...[0, 0, 0, 1],
    ...[1.5, 0.3, -0.2, -0.8],
    ...[-0.7, 2, 1, 0.35],
  );
  const point = [3.1, -1.7, 2.4];
  const h = 1e-4;
  for (const model of ["vacuum", "distance", "debye"] as const) {
    const e = coulombField(point, atoms, { model });
    for (let axis = 0; axis < 3; axis++) {
      const plus = [...point], minus = [...point];
      plus[axis] += h;
      minus[axis] -= h;
      const d = (coulombPotential(plus, atoms, { model })[0] -
        coulombPotential(minus, atoms, { model })[0]) / (2 * h);
      close(e[axis], -d, 1e-6);
    }
  }
});

Deno.test("an ideal dipole's far potential and field", () => {
  const d = 0.1, q = 1;
  const atoms = Float32Array.of(0, 0, d / 2, q, 0, 0, -d / 2, -q);
  const p = q * d;
  const r = 20, theta = 0.7;
  const point = [r * Math.sin(theta), 0, r * Math.cos(theta)];
  const options = { model: "vacuum", unit: "kcal/mol/e" } as const;
  const phi = coulombPotential(point, atoms, options)[0];
  close(phi, COULOMB_CONSTANT * p * Math.cos(theta) / (r * r), 1e-4);
  // Far field: E_r = 2p cosθ / r³, E_θ = p sinθ / r³.
  const e = coulombField(point, atoms, options);
  const er = e[0] * Math.sin(theta) + e[2] * Math.cos(theta);
  const et = e[0] * Math.cos(theta) - e[2] * Math.sin(theta);
  close(er, COULOMB_CONSTANT * 2 * p * Math.cos(theta) / r ** 3, 1e-4);
  close(et, COULOMB_CONSTANT * p * Math.sin(theta) / r ** 3, 1e-4);
});

Deno.test("distances below minDistance are clamped and carry no field", () => {
  const atoms = Float32Array.of(0, 0, 0, 1);
  const options = {
    model: "vacuum",
    unit: "kcal/mol/e",
    minDistance: 1,
  } as const;
  close(coulombPotential([0, 0, 0], atoms, options)[0], COULOMB_CONSTANT);
  close(coulombPotential([0.4, 0, 0], atoms, options)[0], COULOMB_CONSTANT);
  assertEquals([...coulombField([0.4, 0, 0], atoms, options)], [0, 0, 0]);
  assertEquals([...coulombField([0, 0, 0], atoms, options)], [0, 0, 0]);
  close(
    coulombPotential([2, 0, 0], atoms, { ...options, minDistance: 0.5 })[0],
    COULOMB_CONSTANT / 2,
  );
});

Deno.test("packCharges keeps nonzero rows in row order", () => {
  const positions = Float32Array.of(0, 1, 2, 3, 4, 5, 6, 7, 8);
  const charges = Float32Array.of(0.5, 0, -1);
  assertEquals([...packCharges(positions, charges)], [
    0,
    1,
    2,
    0.5,
    6,
    7,
    8,
    -1,
  ]);
  assertEquals([...packCharges(positions, charges, [2, 1])], [6, 7, 8, -1]);
  assertThrows(() => packCharges(positions, charges, [3]), RangeError);
  assertThrows(() => packCharges(positions.subarray(3), charges), TypeError);
});

Deno.test("grid points follow the index-to-world affine, x fastest", () => {
  const grid = {
    dims: [2, 3, 2] as const,
    transform: [0.5, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, -1, 4, 9, 1],
  };
  const points = gridPoints(grid);
  assertEquals(points.length, 2 * 3 * 2 * 3);
  assertEquals([...points.subarray(0, 6)], [-1, 4, 9, -0.5, 4, 9]);
  // Sample (1, 2, 1) is index 1 + 2*2 + 1*6 = 11.
  assertEquals([...points.subarray(33, 36)], [-0.5, 8, 10]);
  const atoms = Float32Array.of(0, 0, 0, 1);
  const phi = coulombGrid(grid, atoms);
  assertEquals(phi.length, 12);
  close(phi[11], coulombPotential([-0.5, 8, 10], atoms)[0]);
});

Deno.test("coulombParams lays out the WGSL uniform", () => {
  const physics = electrostatics({ model: "debye" });
  const buffer = coulombParams(physics, {
    count: 12,
    atomStart: 64,
    atomEnd: 100,
    accumulate: true,
    rowWidth: 128,
    offset: 4096,
    dims: [2, 3, 2],
    transform: [0.5, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, -1, 4, 9, 1],
  });
  assertEquals(buffer.byteLength, COULOMB_PARAMS_BYTES);
  const u = new Uint32Array(buffer), f = new Float32Array(buffer);
  assertEquals([...u.subarray(0, 8)], [12, 64, 100, 1, 2, 128, 12, 4096]);
  assertEquals([...f.subarray(8, 11)], [0.5, 0, 0]);
  assertEquals([...f.subarray(12, 15)], [0, 2, 0]);
  assertEquals([...f.subarray(20, 23)], [-1, 4, 9]);
  assertEquals(f[11], Math.fround(physics.scale));
  assertEquals(f[15], Math.fround(physics.kappa));
  assertEquals(f[19], 1);
  assertEquals([...u.subarray(24, 27)], [2, 3, 2]);
  assert(f[15] > 0.12 && f[15] < 0.13);
});
