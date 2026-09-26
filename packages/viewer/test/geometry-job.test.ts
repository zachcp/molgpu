import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
  fail,
} from "@std/assert";
import { createStructure } from "@molgpu/table";
import { createStructureResource } from "../src/internal/structure-resource.ts";
import {
  assertGridBudget,
  copyOwned,
  geometryDeps,
  runGeometryJob,
} from "../src/internal/geometry-job.ts";

const structure = () =>
  createStructure({
    positions: new Float32Array([0, 0, 0, 2, 4, 6]),
    topology: {
      atoms: {
        count: 2,
        id: ["1", "2"],
        name: ["C", "O"],
        altloc: ["", ""],
        residue: new Uint32Array([0, 0]),
        element: new Uint8Array([6, 8]),
        occupancy: new Float32Array([1, 1]),
        bfactor: new Float32Array(2),
      },
      residues: {
        count: 1,
        chain: new Uint32Array([0]),
        labelSeq: new Int32Array([1]),
        authSeq: ["1"],
        insertionCode: [""],
        comp: ["GLY"],
        polymer: ["protein"],
      },
      chains: {
        count: 1,
        model: new Int32Array([1]),
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
        count: 1,
        chain: new Uint32Array([0]),
        operatorId: ["identity"],
        transform: new Float64Array([
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
          0,
          0,
          0,
          0,
          1,
        ]),
      },
    },
  });

Deno.test("geometryDeps keys on structure identity/revisions plus sorted geometry params", () => {
  const resource = createStructureResource(structure());
  const a = geometryDeps(resource, { isoLevel: 0.5, resolution: 1 });
  const b = geometryDeps(resource, { resolution: 1, isoLevel: 0.5 }); // key order must not matter
  assertEquals(a, b);
  const c = geometryDeps(resource, { isoLevel: 0.6, resolution: 1 });
  assertNotEquals(a, c);
});

Deno.test("geometryDeps refuses a style parameter so a color/opacity edit cannot gate scheduling", () => {
  const resource = createStructureResource(structure());
  assertThrows(
    () => geometryDeps(resource, { color: [1, 0, 0, 1] }),
    Error,
    "style parameter",
  );
  assertThrows(
    () => geometryDeps(resource, { opacity: 0.5 }),
    Error,
    "style parameter",
  );
  geometryDeps(resource, { isoLevel: 0.5 }); // must not throw
});

Deno.test("geometryDeps requires an actual structure resource", () => {
  // @ts-expect-error: no resource
  assertThrows(() => geometryDeps(null, {}), Error, "structure resource");
  // @ts-expect-error: not a resource
  assertThrows(() => geometryDeps({}, {}), Error, "structure resource");
});

Deno.test("assertGridBudget rejects an oversize grid before any allocation happens", () => {
  assertStrictEquals(
    assertGridBudget([10, 10, 10], { maxBytes: 1_000_000 }),
    4000,
  );
  assertMatch(
    (assertThrows(() => assertGridBudget([1000, 1000, 1000]), Error)).message,
    /exceeds the .* byte limit/,
  );
  try {
    assertGridBudget([1000, 1000, 1000]);
    fail("expected assertGridBudget to throw");
  } catch (error) {
    assertStrictEquals(
      (error as { code?: string }).code,
      "GEOMETRY_BUDGET_EXCEEDED",
    );
  }
  assertThrows(
    // @ts-expect-error: two dimensions
    () => assertGridBudget([1, 1]),
    Error,
    "three positive integers",
  );
  assertThrows(
    () => assertGridBudget([1, 1, 1.5]),
    Error,
    "three positive integers",
  );
});

Deno.test("copyOwned leaves the source Structure buffer usable and unmutated", () => {
  const data = structure();
  const copy = copyOwned(data.positions);
  assertNotStrictEquals(
    copy.buffer,
    data.positions.buffer,
    "must not alias the shared buffer",
  );
  copy.fill(999);
  assertStrictEquals(
    data.positions[0],
    0,
    "source Structure positions remain usable after the job touches its copy",
  );
  assertStrictEquals(data.positions.length, 6);
});

Deno.test("runGeometryJob discards a result that was cancelled before it settled", async () => {
  let cancelled = false;
  const slow = () =>
    new Promise((resolve) => setTimeout(() => resolve("mesh-A"), 5));
  const pending = runGeometryJob(slow, () => cancelled);
  cancelled = true; // superseded by a later request before slow() resolves
  assertStrictEquals(await pending, null);
});

Deno.test("runGeometryJob returns the kernel result when not cancelled", async () => {
  const result = await runGeometryJob(() => "mesh-B", () => false);
  assertStrictEquals(result, "mesh-B");
});

Deno.test("runGeometryJob propagates a kernel error (e.g. a budget rejection) as a rejection", async () => {
  assertMatch(
    (await assertRejects(
      () =>
        runGeometryJob(() => assertGridBudget([1000, 1000, 1000]), () => false),
      Error,
    )).message,
    /GEOMETRY_BUDGET_EXCEEDED|exceeds the/,
  );
});
