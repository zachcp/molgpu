import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { createVolume, volumeLevel } from "@molgpu/table";
import { buildIsosurface } from "../src/internal/isosurface-geometry.ts";
import {
  enableInstrumentation,
  resetAllInstrumentation,
  snapshotCounters,
} from "../src/internal/instrumentation.ts";

// A Gaussian blob centred at `c` on a sheared, rotated grid.
const M = [0.9, 0.2, 0, 0, 0.3, 1.1, 0.1, 0, 0, -0.2, 0.7, 0, -8, -9, -4, 1];
const c = [1.3, 0.7, -0.4];
function blob(n = 20) {
  const values = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = M[0] * i + M[4] * j + M[8] * k + M[12] - c[0];
        const y = M[1] * i + M[5] * j + M[9] * k + M[13] - c[1];
        const z = M[2] * i + M[6] * j + M[10] * k + M[14] - c[2];
        values[i + n * (j + n * k)] = 10 *
          Math.exp(-(x * x + y * y + z * z) / 8);
      }
    }
  }
  return createVolume({ values, dims: [n, n, n], transform: M });
}
// exp(-r²/8) * 10 = level  →  r = sqrt(-8 ln(level / 10))
const radiusAt = (level: number) => Math.sqrt(-8 * Math.log(level / 10));

Deno.test("isosurface vertices lie on the world-space level set of a sheared volume", () => {
  const volume = blob();
  for (const level of [5, 2]) {
    const mesh = buildIsosurface(volume, level)!;
    assert(mesh.triangleCount > 100);
    const r = radiusAt(level);
    for (let v = 0; v < mesh.positions.length; v += 3) {
      const d = Math.hypot(
        mesh.positions[v] - c[0],
        mesh.positions[v + 1] - c[1],
        mesh.positions[v + 2] - c[2],
      );
      assert(Math.abs(d - r) < 0.2, `vertex at ${d}, expected ${r}`);
      // Normals point out of the blob (towards decreasing values).
      const radial = (mesh.positions[v] - c[0]) * mesh.normals[v] +
        (mesh.positions[v + 1] - c[1]) * mesh.normals[v + 1] +
        (mesh.positions[v + 2] - c[2]) * mesh.normals[v + 2];
      assert(radial > 0, "normal faces outward");
    }
  }
});

Deno.test("a sigma level resolves through the volume's statistics", () => {
  const volume = blob();
  const iso = volumeLevel(volume, { sigma: 2 });
  assertEquals(iso, volume.stats.mean + 2 * volume.stats.sigma);
  const mesh = buildIsosurface(volume, iso)!;
  assert(mesh.vertexCount > 0);
});

Deno.test("empty level sets and single-plane grids produce no mesh; builds are counted", () => {
  resetAllInstrumentation();
  enableInstrumentation();
  const volume = blob(8);
  assertStrictEquals(buildIsosurface(volume, 1000), null);
  const flat = createVolume({
    values: new Float32Array(4),
    dims: [2, 2, 1],
    transform: M,
  });
  assertStrictEquals(buildIsosurface(flat, 0), null);
  assertStrictEquals(
    snapshotCounters().detail["geometryBuilds:isosurface:mesh"],
    1,
  );
});
