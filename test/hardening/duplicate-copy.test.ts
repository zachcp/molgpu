import { assertThrows } from "@std/assert";
import { createStructure } from "@molgpu/table";
import { createCurve } from "@molgpu/timeline";
import { fromFileUrl, join, toFileUrl } from "@std/path";

Deno.test("duplicate table and timeline copies explain identity rejection and deduplication", async () => {
  const root = fromFileUrl(new URL("../../", import.meta.url));
  const dir = await Deno.makeTempDir({ prefix: "molgpu-copy-errors-" });
  try {
    for (const pkg of ["table", "timeline"]) {
      const copy = await new Deno.Command("cp", {
        args: ["-R", join(root, "packages", pkg, "src"), join(dir, pkg)],
      }).output();
      if (!copy.success) throw new Error("copy failed");
    }
    const table = await import(toFileUrl(join(dir, "table/index.ts")).href);
    const timeline = await import(
      toFileUrl(join(dir, "timeline/index.ts")).href
    );
    const data = createStructure({
      positions: new Float32Array(),
      topology: {
        atoms: {
          count: 0,
          id: [],
          name: [],
          altloc: [],
          residue: new Uint32Array(),
          element: new Uint8Array(),
          occupancy: new Float32Array(),
          bfactor: new Float32Array(),
        },
        residues: {
          count: 0,
          chain: new Uint32Array(),
          labelSeq: new Int32Array(),
          authSeq: [],
          insertionCode: [],
          comp: [],
          polymer: [],
        },
        chains: { count: 0, model: new Int32Array(), labelId: [], authId: [] },
        bonds: {
          count: 0,
          a: new Uint32Array(),
          b: new Uint32Array(),
          order: new Uint8Array(),
          source: [],
        },
        instances: {
          count: 0,
          chain: new Uint32Array(),
          operatorId: [],
          transform: new Float64Array(),
        },
      },
    });
    for (
      const operation of [
        () => table.withAttributes(data, {}),
        () => table.bondTopology(data),
        () => table.withPositions(data, data.positions),
      ]
    ) {
      assertThrows(operation, TypeError, "another copy of @molgpu/table");
      assertThrows(operation, TypeError, "deduplicate @molgpu/table");
    }
    const curve = createCurve([{ time: 0, value: 1 }, { time: 1, value: 2 }]);
    assertThrows(
      () => timeline.sample(curve, 0),
      TypeError,
      "another copy of @molgpu/timeline",
    );
    assertThrows(
      () => timeline.sample(curve, 0),
      TypeError,
      "deduplicate @molgpu/timeline",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
