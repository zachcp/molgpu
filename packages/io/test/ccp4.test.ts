import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { volumeIndexToWorld } from "@molgpu/table";
import { IoError, volumeFromCcp4 } from "../src/index.ts";
import { type Ccp4Fixture, fixtureWorld, writeCcp4 } from "./ccp4-fixture.ts";
import { parse } from "molstar/lib/mol-io/reader/ccp4/parser.js";
import { volumeFromCcp4 as molstarVolume } from "molstar/lib/mol-model-formats/volume/ccp4.js";
import { Grid } from "molstar/lib/mol-model/volume/grid.js";

const f = (x: number, y: number, z: number) => 0.3 * x - 0.2 * y + 0.1 * z + 1;

// Cryo-EM style: orthogonal 1.2 Å voxels, MRC2014 ORIGIN in Å.
const EM: Ccp4Fixture = {
  extent: [6, 5, 4],
  cell: [7.2, 6, 4.8],
  origin: [10, -4, 2.4],
  f,
};
// Crystallographic: triclinic cell, nonzero starts, permuted axes (sections
// along x, columns along z), sampled from a larger unit-cell grid.
const XTAL: Ccp4Fixture = {
  extent: [5, 4, 3],
  grid: [20, 16, 24],
  cell: [30, 24, 36],
  angles: [80, 95, 105],
  axisOrder: [3, 2, 1],
  start: [2, -3, 5],
  f,
};

async function oracle(bytes: Uint8Array) {
  const parsed = await parse(bytes, "oracle").run();
  if (parsed.isError) throw new Error(parsed.message);
  await Promise.resolve();
  const { grid } = await molstarVolume(parsed.result).run();
  return {
    dims: Array.from(grid.cells.space.dimensions),
    transform: Array.from(Grid.getGridToCartesianTransform(grid)),
  };
}

for (
  const [name, fixture] of [["EM", EM], ["crystallographic", XTAL]] as const
) {
  Deno.test(`${name} map: affine places every sample where f(world) was written`, async () => {
    const bytes = writeCcp4(fixture);
    const volume = await volumeFromCcp4(bytes);
    const [nx, ny, nz] = volume.dims;
    assertEquals(nx * ny * nz, fixture.extent.reduce((a, b) => a * b));
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const w = volumeIndexToWorld(volume, i, j, k);
          const value = volume.values[i + nx * (j + ny * k)];
          assertAlmostEquals(
            value,
            f(w[0], w[1], w[2]),
            2e-4,
            `(${i},${j},${k})`,
          );
        }
      }
    }
    // File sample (0,0,0) is grid index (0,0,0) whatever the axis order.
    const first = fixtureWorld(fixture, 0, 0, 0);
    const w0 = volumeIndexToWorld(volume, 0, 0, 0);
    for (let a = 0; a < 3; a++) assertAlmostEquals(w0[a], first[a], 1e-4);
  });

  Deno.test(`${name} map: dims and affine match Mol*'s parsed grid`, async () => {
    const bytes = writeCcp4(fixture);
    const volume = await volumeFromCcp4(bytes);
    const expected = await oracle(bytes);
    assertEquals([...volume.dims], expected.dims);
    for (let n = 0; n < 16; n++) {
      assertAlmostEquals(volume.transform[n], expected.transform[n], 1e-4);
    }
  });
}

Deno.test("the crystallographic affine is non-orthogonal", async () => {
  const m = (await volumeFromCcp4(writeCcp4(XTAL))).transform;
  const dot = (a: number, b: number) =>
    m[a] * m[b] + m[a + 1] * m[b + 1] + m[a + 2] * m[b + 2];
  assert(Math.abs(dot(0, 4)) > 1e-3 || Math.abs(dot(0, 8)) > 1e-3);
});

Deno.test("big-endian, int8 and int16 maps read as float values", async () => {
  const big = await volumeFromCcp4(writeCcp4({ ...EM, littleEndian: false }));
  const little = await volumeFromCcp4(writeCcp4(EM));
  assertEquals(Array.from(big.values), Array.from(little.values));
  const g = () => 7;
  for (const mode of [0, 1] as const) {
    const v = await volumeFromCcp4(writeCcp4({ ...EM, mode, f: g }));
    assert(v.values.every((x) => x === 7), `mode ${mode}`);
    assertStrictEquals(v.stats.sigma, 0);
  }
});

Deno.test("statistics come from the values, not the header", async () => {
  const volume = await volumeFromCcp4(writeCcp4(EM));
  let sum = 0;
  for (const v of volume.values) sum += v;
  assertAlmostEquals(volume.stats.mean, sum / volume.values.length, 1e-6);
});

Deno.test("malformed, unsupported and oversize maps fail with stable codes", async () => {
  const code = async (input: unknown, expected: string, options = {}) => {
    const error = await assertRejects(
      () => volumeFromCcp4(input as Uint8Array, options),
      IoError,
    );
    assertStrictEquals((error as IoError).code, expected);
  };
  const good = writeCcp4(EM);
  await code(42, "INVALID_INPUT");
  await code("file:///nonexistent/molgpu.map", "FETCH_FAILED");
  await code(good.subarray(0, 500), "INVALID_MAP");
  await code(good.subarray(0, good.length - 1), "INVALID_MAP");
  const noMarker = good.slice();
  noMarker[208] = 0;
  await code(noMarker, "INVALID_MAP");
  const badAxes = good.slice();
  new DataView(badAxes.buffer).setInt32(17 * 4, 1, true);
  await code(badAxes, "INVALID_MAP");
  await code(writeCcp4({ ...EM, mode: 4 }), "UNSUPPORTED_MODE");
  await code(good, "VOLUME_TOO_LARGE", { maxSamples: 100 });
  assertEquals((await volumeFromCcp4(good, { maxSamples: 120 })).dims, [
    6,
    5,
    4,
  ]);
});

Deno.test("reads a Blob and a file URL like the bytes", async () => {
  const bytes = writeCcp4(EM);
  const expected = await volumeFromCcp4(bytes);
  const fromBlob = await volumeFromCcp4(new Blob([bytes as BlobPart]));
  assertEquals([...fromBlob.dims], [...expected.dims]);
  assertEquals(fromBlob.values, expected.values);
  const path = await Deno.makeTempFile({ suffix: ".map" });
  try {
    await Deno.writeFile(path, bytes);
    const fromUrl = await volumeFromCcp4(new URL(`file://${path}`));
    assertEquals(fromUrl.values, expected.values);
  } finally {
    await Deno.remove(path);
  }
});
