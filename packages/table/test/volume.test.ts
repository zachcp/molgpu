import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  createVolume,
  MAX_VOLUME_SAMPLES,
  sampleVolume,
  validateVolume,
  volumeComponent,
  volumeIndexToWorld,
  volumeLevel,
  volumeWorldToIndex,
} from "@molgpu/table";

// A sheared, rotated, translated affine: columns are the grid's i, j, k steps.
const SHEARED = Float32Array.from([
  0.9,
  0.2,
  0,
  0,
  0.3,
  1.1,
  0.1,
  0,
  0,
  -0.2,
  0.7,
  0,
  -4,
  2,
  5,
  1,
]);
const linear = (x: number, y: number, z: number) => 2 * x - y + 0.5 * z + 3;

function shearedVolume(dims: [number, number, number] = [5, 4, 3]) {
  const [nx, ny, nz] = dims;
  const values = new Float32Array(nx * ny * nz);
  const m = SHEARED;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = m[0] * i + m[4] * j + m[8] * k + m[12];
        const y = m[1] * i + m[5] * j + m[9] * k + m[13];
        const z = m[2] * i + m[6] * j + m[10] * k + m[14];
        values[i + nx * (j + ny * k)] = linear(x, y, z);
      }
    }
  }
  return createVolume({ values, dims, transform: SHEARED, unit: "au" });
}

Deno.test("createVolume freezes, adopts values and computes stats", () => {
  const values = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const volume = createVolume({
    values,
    dims: [2, 2, 2],
    transform: SHEARED,
  });
  assert(Object.isFrozen(volume));
  assertStrictEquals(volume.values, values, "values are adopted, not copied");
  assertEquals(volume.components, 1);
  assertEquals(volume.stats.min, 1);
  assertEquals(volume.stats.max, 8);
  assertEquals(volume.stats.mean, 4.5);
  assertAlmostEquals(volume.stats.sigma, Math.sqrt(5.25), 1e-12);
});

Deno.test("validateVolume names the malformed field", () => {
  const base = {
    values: new Float32Array(8),
    dims: [2, 2, 2] as const,
    transform: SHEARED,
  };
  const bad: [unknown, RegExp][] = [
    [{ ...base, values: [0] }, /volume\.values: expected Float32Array/],
    [{ ...base, dims: [2, 0, 2] }, /volume\.dims/],
    [{ ...base, dims: [2, 2] }, /volume\.dims/],
    [
      { ...base, values: new Float32Array(7) },
      /volume\.values: expected length 8/,
    ],
    [{ ...base, components: 2 }, /volume\.components/],
    [
      { ...base, values: Float32Array.from([0, 0, NaN, 0, 0, 0, 0, 0]) },
      /volume\.values\[2\]: expected finite/,
    ],
    [{ ...base, transform: new Float32Array(15) }, /volume\.transform/],
    [
      {
        ...base,
        transform: Float32Array.from([
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
          1,
          0,
          0,
          0,
          1,
        ]),
      },
      /affine/,
    ],
    [{
      ...base,
      transform: new Float32Array([
        0,
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
    }, /invertible/],
    [{
      ...base,
      transform: [1e40, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    }, /representable as Float32Array/],
    [{
      ...base,
      // The columns are distinct as doubles but identical after f32 storage.
      transform: [1, 1, 0, 0, 1 + 1e-8, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    }, /invertible/],
    [{ ...base, unit: 3 }, /volume\.unit/],
  ];
  for (const [input, message] of bad) {
    assertThrows(
      () => validateVolume(input as never),
      TypeError,
      undefined,
    );
    try {
      validateVolume(input as never);
    } catch (error) {
      assert(message.test((error as Error).message), (error as Error).message);
    }
  }
  assertStrictEquals(validateVolume(base), base);
});

Deno.test("oversize volumes fail with a RangeError unless maxSamples allows them", () => {
  assertEquals(MAX_VOLUME_SAMPLES, 256 ** 3);
  // A length check comes after the size check, so no 64 MiB allocation is needed.
  const huge = {
    values: new Float32Array(1),
    dims: [257, 256, 256] as const,
    transform: SHEARED,
  };
  assertThrows(() => createVolume(huge), RangeError, "maxSamples");
  const small = {
    values: new Float32Array(27),
    dims: [3, 3, 3] as const,
    transform: SHEARED,
  };
  assertThrows(() => createVolume(small, { maxSamples: 26 }), RangeError);
  assertEquals(createVolume(small, { maxSamples: 27 }).dims, [3, 3, 3]);
});

Deno.test("index and world round-trip through a non-orthogonal affine", () => {
  const volume = shearedVolume();
  for (const p of [[0, 0, 0], [1, 2, 1], [4, 3, 2], [0.5, 1.25, 1.75]]) {
    const world = volumeIndexToWorld(volume, p[0], p[1], p[2]);
    const back = volumeWorldToIndex(volume, world[0], world[1], world[2]);
    for (let a = 0; a < 3; a++) assertAlmostEquals(back[a], p[a], 1e-5);
  }
  assertEquals(volumeIndexToWorld(volume, 0, 0, 0), [-4, 2, 5]);
});

Deno.test("sampleVolume is exact for a linear field inside, clamps at faces, zero outside", () => {
  const volume = shearedVolume();
  const at = (i: number, j: number, k: number) => {
    const w = volumeIndexToWorld(volume, i, j, k);
    return { w, v: sampleVolume(volume, w[0], w[1], w[2]) };
  };
  // Interior: trilinear interpolation of a linear function is exact.
  for (const p of [[1.5, 1.5, 0.5], [0.25, 2.75, 1.1], [3.9, 0.1, 1.9]]) {
    const { w, v } = at(p[0], p[1], p[2]);
    assertAlmostEquals(v, linear(w[0], w[1], w[2]), 1e-4);
  }
  // Boundary: grid corners and faces are inside.
  for (const p of [[0, 0, 0], [4, 3, 2], [4, 1.5, 0], [2, 3, 1.5]]) {
    const { w, v } = at(p[0], p[1], p[2]);
    assertAlmostEquals(v, linear(w[0], w[1], w[2]), 1e-4);
  }
  // Outside on any axis is exactly zero.
  for (const p of [[-0.5, 1, 1], [4.5, 1, 1], [1, -1, 1], [1, 1, 2.01]]) {
    assertStrictEquals(at(p[0], p[1], p[2]).v, 0);
  }
});

Deno.test("sampleVolume handles a single-sample axis", () => {
  const volume = createVolume({
    values: Float32Array.from([1, 3]),
    dims: [2, 1, 1],
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  });
  assertEquals(sampleVolume(volume, 0.5, 0, 0), 2);
  assertEquals(sampleVolume(volume, 0.5, 0.5, 0), 0);
});

Deno.test("volumeComponent extracts channels or magnitude; scalar input passes through", () => {
  const vector = createVolume({
    values: Float32Array.from([3, 4, 0, 1, 2, 2]),
    dims: [2, 1, 1],
    transform: SHEARED,
    components: 3,
  });
  assertThrows(
    () => sampleVolume(vector, 0, 0, 0),
    TypeError,
    "volumeComponent",
  );
  assertEquals(Array.from(volumeComponent(vector, "magnitude").values), [5, 3]);
  assertEquals(Array.from(volumeComponent(vector, 1).values), [4, 2]);
  const scalar = shearedVolume();
  assertStrictEquals(volumeComponent(scalar, 0), scalar);
});

Deno.test("volumeLevel: absolute or mean + k·sigma, and a flat map gives its mean", () => {
  const volume = createVolume({
    values: Float32Array.from([0, 2, 4, 6]),
    dims: [4, 1, 1],
    transform: SHEARED,
  });
  assertEquals(volumeLevel(volume, 1.5), 1.5);
  assertAlmostEquals(
    volumeLevel(volume, { sigma: 1 }),
    3 + Math.sqrt(5),
    1e-12,
  );
  const flat = createVolume({
    values: new Float32Array(4).fill(7),
    dims: [4, 1, 1],
    transform: SHEARED,
  });
  assertEquals(volumeLevel(flat, { sigma: 3 }), 7);
  assertThrows(() => volumeLevel(volume, NaN), TypeError);
  assertThrows(() => volumeLevel(volume, { sigma: Infinity }), TypeError);
});
