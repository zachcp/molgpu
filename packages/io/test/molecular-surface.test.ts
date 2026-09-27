import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "@std/assert";
import { activeAtoms } from "@molgpu/table";
import { validateVolume } from "../../table/src/volume.ts";
import {
  IoError,
  molecularSurfaceField,
  structureFromBcif,
} from "../src/index.ts";

async function loadAtoms(id: string) {
  const bytes = new Uint8Array(
    await Deno.readFile(new URL(`./fixtures/${id}.bcif`, import.meta.url)),
  );
  const data = await structureFromBcif(bytes);
  const radii = data.topology.atoms.radius;
  assert(radii, "io assigns per-atom radii");
  const indices = activeAtoms(data);
  const n = indices.length;
  const x = new Float32Array(n),
    y = new Float32Array(n),
    z = new Float32Array(n),
    radius = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = indices[k];
    x[k] = data.positions[i * 3];
    y[k] = data.positions[i * 3 + 1];
    z[k] = data.positions[i * 3 + 2];
    radius[k] = radii[i];
  }
  return { x, y, z, radius, count: n };
}

Deno.test("computes a finite scalar field with a scale+translate transform, over a real structure", async () => {
  const atoms = await loadAtoms("1crn");
  const field = await molecularSurfaceField(atoms, { resolution: 0.7 });
  assertStrictEquals(
    field.values.length,
    field.dims[0] * field.dims[1] * field.dims[2],
  );
  assertStrictEquals(field.level, 1.4); // solvent-excluded-surface isolevel == probeRadius
  for (const v of field.values) assert(Number.isFinite(v));
  // Column-major scale+translate: every off-diagonal/rotation term is zero.
  const m = field.transform;
  for (const i of [1, 2, 3, 4, 6, 7, 8, 9, 11]) {
    assertStrictEquals(m[i], 0, `transform[${i}] expected 0`);
  }
  assertStrictEquals(m[15], 1);
  assert(
    m[0] > 0 && m[5] > 0 && m[10] > 0,
    "diagonal scale factors must be positive",
  );
  // VolumeData compatibility: the surface field is a valid scalar volume that
  // keeps its surface metadata.
  assertStrictEquals(validateVolume(field, { maxSamples: Infinity }), field);
  assertStrictEquals(field.components, 1);
  assertStrictEquals(field.stats.min, Math.min(...field.values));
  assertStrictEquals(field.resolution, 0.7);
  assert(field.maxRadius > 1);
  assert(Object.isFrozen(field));
});

Deno.test("probeRadius sets the isolevel and resolution changes the grid size", async () => {
  const atoms = await loadAtoms("1crn");
  const wet = await molecularSurfaceField(atoms, {
    probeRadius: 1.4,
    resolution: 0.8,
  });
  const dry = await molecularSurfaceField(atoms, {
    probeRadius: 1.0,
    resolution: 0.8,
  });
  assertStrictEquals(wet.level, 1.4);
  assertStrictEquals(dry.level, 1.0);
  const coarse = await molecularSurfaceField(atoms, { resolution: 1.2 });
  const fine = await molecularSurfaceField(atoms, { resolution: 0.6 });
  assert(
    fine.dims[0] * fine.dims[1] * fine.dims[2] >
      coarse.dims[0] * coarse.dims[1] * coarse.dims[2],
  );
});

Deno.test("rejects malformed or empty atom input before touching Mol*", async () => {
  await assertRejects(
    () =>
      molecularSurfaceField({
        x: new Float32Array(1),
        y: new Float32Array(1),
        z: new Float32Array(1),
        radius: new Float32Array(1),
        count: 2,
      }),
    IoError,
  );
  await assertRejects(
    () =>
      molecularSurfaceField({
        x: new Float32Array(0),
        y: new Float32Array(0),
        z: new Float32Array(0),
        radius: new Float32Array(0),
        count: 0,
      }),
    Error,
    "at least one atom",
  );
});

Deno.test("matches Mol's own probe-radius-inflated search radius (mol-repr/.../util/molecular-surface.js), not the bare van der Waals radius", async () => {
  // Regression: an earlier version passed atoms.radius straight through.
  // calcMolecularSurface's *search* radius must be vdW + probeRadius (Mol*'s
  // own getUnitPositionDataAndMaxRadius/getStructurePositionDataAndMaxRadius
  // do exactly this), or the internal "visited" neighborhood shrinks and the
  // -1001 sentinel reaches close enough to the true isosurface to fragment
  // it into scattered slivers instead of a closed surface — silent and
  // finite, so nothing here would fail without this explicit check.
  const atoms = await loadAtoms("1crn");
  const probeRadius = 1.4, resolution = 0.9;
  const ours = await molecularSurfaceField(atoms, { probeRadius, resolution });

  const [{ calcMolecularSurface }, { getFastBoundary }, { OrderedSet }] =
    await Promise.all([
      import("molstar/lib/mol-math/geometry/molecular-surface.js"),
      import("molstar/lib/mol-math/geometry/boundary.js"),
      import("molstar/lib/mol-data/int/ordered-set.js"),
    ]);
  const { x, y, z, radius, count } = atoms;
  const id = Uint32Array.from({ length: count }, (_, i) => i);
  const indices = OrderedSet.ofBounds(0, count);
  const boundary = getFastBoundary({ x, y, z, radius, id, indices });
  let maxRadius = 0;
  const searchRadius = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (radius[i] > maxRadius) maxRadius = radius[i];
    searchRadius[i] = radius[i] + probeRadius;
  }
  const oracle = await calcMolecularSurface(
    // Same stub as the implementation: only shouldUpdate/update are read.
    { shouldUpdate: false, update: async () => {} } as unknown as Parameters<
      typeof calcMolecularSurface
    >[0],
    { x, y, z, id, indices, radius: searchRadius },
    boundary,
    maxRadius,
    null,
    { probeRadius, resolution, probePositions: 36 },
  );

  assertEquals([...ours.dims], [...oracle.field.space.dimensions]);
  // Same samples as Mol*, re-laid out x-fastest for @molgpu/geo.
  const [nx, ny, nz] = ours.dims;
  const { space, data } = oracle.field;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        assertStrictEquals(
          ours.values[i + nx * (j + ny * k)],
          space.get(data, i, j, k),
          `sample (${i}, ${j}, ${k})`,
        );
      }
    }
  }
});

Deno.test("owns its output: mutating the returned arrays cannot affect a second call", async () => {
  const atoms = await loadAtoms("1crn");
  const first = await molecularSurfaceField(atoms, { resolution: 0.9 });
  first.values.fill(0);
  first.transform.fill(0);
  const second = await molecularSurfaceField(atoms, { resolution: 0.9 });
  assert(second.values.some((v) => v !== 0));
  assert(second.transform.some((v) => v !== 0));
});
