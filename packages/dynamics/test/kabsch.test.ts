import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { applyAffine, fitKabsch } from "../src/index.ts";

const SOURCE = Float32Array.of(
  0,
  0,
  0,
  2,
  0,
  0,
  0,
  3,
  0,
  0,
  0,
  4,
  1,
  1,
  1,
);

Deno.test("Kabsch finds a proper rotation and translation", () => {
  const reference = Float32Array.of(
    5,
    -4,
    2,
    5,
    -2,
    2,
    2,
    -4,
    2,
    5,
    -4,
    6,
    4,
    -3,
    3,
  );
  const fit = fitKabsch(SOURCE, reference);
  assertAlmostEquals(fit.rmsd, 0, 1e-12);
  const transformed = applyAffine(SOURCE, fit.matrix);
  for (let i = 0; i < reference.length; i++) {
    assertAlmostEquals(transformed[i], reference[i], 1e-5);
  }
  const m = fit.matrix;
  const determinant = m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2]);
  assertAlmostEquals(determinant, 1, 1e-12);
  assertEquals(fit.count, 5);
});

Deno.test("Kabsch selection fits rows but moves all output rows", () => {
  const reference = Float32Array.of(
    5,
    -4,
    2,
    5,
    -2,
    2,
    2,
    -4,
    2,
    5,
    -4,
    6,
    999,
    999,
    999,
  );
  const fit = fitKabsch(SOURCE, reference, Uint32Array.of(0, 1, 2, 3));
  assertAlmostEquals(fit.rmsd, 0, 1e-12);
  const transformed = applyAffine(SOURCE, fit.matrix);
  assertAlmostEquals(transformed[12], 4, 1e-5);
  assertAlmostEquals(transformed[13], -3, 1e-5);
  assertAlmostEquals(transformed[14], 3, 1e-5);
});

Deno.test("Kabsch rejects reflections and nearly collinear fits", () => {
  const mirror = SOURCE.slice();
  for (let i = 0; i < mirror.length; i += 3) mirror[i] = -mirror[i];
  const fit = fitKabsch(SOURCE, mirror);
  if (!(fit.rmsd > 0.1)) throw new Error("reflection was incorrectly accepted");
  const line = Float32Array.of(0, 0, 0, 1, 0, 0, 2, 1e-6, 0);
  assertThrows(() => fitKabsch(line, line), RangeError, "collinear");
  assertThrows(() => fitKabsch(SOURCE, SOURCE, [0, 1]), RangeError);
  assertThrows(() => fitKabsch(SOURCE, SOURCE, [0, 1, 1]), TypeError);
});

Deno.test("Kabsch retains small shape around a large common offset", () => {
  const source = SOURCE.map((value, i) =>
    value + [10000, -20000, 30000][i % 3]
  );
  const reference = Float32Array.from(
    source,
    (value, i) => value + [7, -8, 9][i % 3],
  );
  const fit = fitKabsch(source, reference);
  assertAlmostEquals(fit.rmsd, 0, 1e-8);
  assertAlmostEquals(fit.matrix[12], 7, 1e-5);
  assertAlmostEquals(fit.matrix[13], -8, 1e-5);
  assertAlmostEquals(fit.matrix[14], 9, 1e-5);
});

Deno.test("Kabsch solves small-scale coordinates without an absolute cutoff", () => {
  const source = Float32Array.from(SOURCE, (value) => value * 1e-8);
  const reference = Float32Array.from(source, (_, i) => {
    const row = Math.floor(i / 3) * 3;
    const axis = i % 3;
    return axis === 0
      ? -source[row + 1] + 5e-8
      : axis === 1
      ? source[row] - 4e-8
      : source[row + 2] + 2e-8;
  });
  const fit = fitKabsch(source, reference);
  assertAlmostEquals(fit.rmsd, 0, 1e-14);
  assertAlmostEquals(fit.matrix[0], 0, 1e-6);
  assertAlmostEquals(fit.matrix[1], 1, 1e-6);
});
