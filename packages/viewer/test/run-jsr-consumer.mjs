/**
 * Isolated JSR consumer gate. The packages are published to a local
 * stand-in registry, and a consumer outside the workspace (OS temp
 * directory, no aliases) resolves `jsr:@molgpu/*` from those tarballs as
 * jsr.io would serve them (test/spikes/jsr-consumer/run.ts, which sends
 * nothing to jsr.io). Asserted here:
 *
 * - every public entry type-checks from its published form, and io keeps
 *   Mol* and use.gpu out of its static graph;
 * - a JSX scene written only against public entries type-checks, bundles
 *   with code splitting and draws in WebGPU Chrome. The preloaded scene never
 *   fetches Mol*; the BCIF scene loads it lazily, with no load failure or
 *   browser error;
 * - compatible package copies deduplicate. Divergent copies fail with the
 *   documented "another copy" identity errors, not wrong results.
 *
 * Documented limitations are asserted too, so a change in them fails here
 * instead of passing silently:
 * - the viewer loads only through a bundler, not by a direct Deno import
 *   (use.gpu's CommonJS main);
 * - a consumer on another use.gpu version does not type-check (exact pin).
 */
import { assert, assertEquals, assertMatch } from "@std/assert";
import { fromFileUrl } from "@std/path";

const ENTRIES = [
  "@molgpu/table",
  "@molgpu/geo",
  "@molgpu/timeline",
  "@molgpu/select",
  "@molgpu/fields",
  "@molgpu/dynamics",
  "@molgpu/dynamics/wgsl",
  "@molgpu/io",
  "@molgpu/viewer",
  "@molgpu/viewer/advanced",
];
const MOLSTAR_CHUNK = /^(cif|mmcif|mol-task)-/;

Deno.test("isolated JSR consumers", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const dir = await Deno.makeTempDir({ prefix: "molgpu-consumer-gate-" });
  const reportPath = `${dir}/report.json`;
  try {
    const run = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "test/spikes/jsr-consumer/run.ts",
        "--browser",
        "--out",
        reportPath,
      ],
      cwd: root,
      stdout: "null",
    }).output();
    const stderr = new TextDecoder().decode(run.stderr);
    assertEquals(run.code, 0, stderr.slice(-4000));
    const report = JSON.parse(await Deno.readTextFile(reportPath));
    assertEquals(report.status, "complete");

    // Entries.
    assertEquals(report.entries.check, "pass", report.entries.errors);
    assertEquals(
      Object.keys(report.entries.graphs).sort(),
      [...ENTRIES].sort(),
    );
    assertEquals(report.entries.graphs["@molgpu/io"].npm, []);
    for (const name of ["table", "geo", "select", "fields", "dynamics"]) {
      assertEquals(report.entries.graphs[`@molgpu/${name}`].npm, [], name);
    }

    // JSX scene: type-checked, bundled and drawn.
    const { scene } = report;
    assertEquals(scene.check, "pass", scene.checkErrors);
    assertEquals(scene.bundle, "pass", scene.bundleErrors);
    const { preloaded, bcif } = scene.render;
    assertEquals(preloaded.errors, [], "preloaded scene errors");
    assert(preloaded.litPixels > 1000, `preloaded drew ${preloaded.litPixels}`);
    assertEquals(
      preloaded.molstarChunksFetched,
      [],
      "a preloaded structure must not fetch Mol*",
    );
    assertEquals(bcif.errors, [], "BCIF scene errors");
    assert(bcif.litPixels > 10000, `BCIF scene drew ${bcif.litPixels}`);
    assert(
      bcif.molstarChunksFetched.some((chunk) => MOLSTAR_CHUNK.test(chunk)),
      `BCIF scene must load Mol* lazily: ${bcif.molstarChunksFetched}`,
    );

    // Package copies.
    const { compatible, divergent, useGpu } = report.copies;
    assert(compatible.sameTableModule, "compatible table copies deduplicate");
    assert(compatible.sameTimelineModule, "compatible timeline copies dedupe");
    for (const [name, result] of Object.entries(compatible.cases)) {
      if (name.startsWith("viewer:")) continue;
      assertEquals(result.outcome, "ok", `compatible ${name}`);
    }
    assert(!divergent.sameTableModule && !divergent.sameTimelineModule);
    for (const [name, result] of Object.entries(divergent.cases)) {
      if (name.startsWith("viewer:")) continue;
      if (result.outcome === "ok") continue;
      // Divergent copies may only fail with the named identity error.
      assertMatch(result.message, /another copy of @molgpu\/(table|timeline)/);
    }

    // Documented limitations.
    for (const copy of [compatible, divergent]) {
      assertMatch(copy.viewerLoad, /does not provide an export named/);
    }
    assertEquals(useGpu.check, "fail", "a use.gpu 0.19 consumer must not pass");
    assertEquals(useGpu.liveVersionsInGraph, ["0.19.0", "0.20.0"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
