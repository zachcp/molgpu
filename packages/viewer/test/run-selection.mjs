import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";

Deno.test("subtree-local public selection props", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const cacheDir = await Deno.makeTempDir({ prefix: "molgpu-selection-vite-" });
  const server = await createServer({
    cacheDir,
    root,
    configFile: false,
    oxc: {
      jsx: {
        runtime: "classic",
        pragma: "React.createElement",
        pragmaFrag: "React.Fragment",
      },
    },
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port: 5216, strictPort: true },
    optimizeDeps: {
      noDiscovery: true,
      entries: ["packages/viewer/test/selection/index.html"],
      exclude: [
        "@molgpu/viewer",
        "@molgpu/table",
        "@molgpu/select",
        "@molgpu/fields",
        "@molgpu/io",
      ],
      include: [
        "@use-gpu/live",
        "@use-gpu/workbench",
        "@use-gpu/webgpu",
        "@use-gpu/core",
        "@use-gpu/core/mjs/ease.mjs",
        "@use-gpu/shader",
        "@use-gpu/shader/wgsl",
        "@use-gpu/wgsl",
        "molstar/lib/mol-io/reader/cif.js",
        "molstar/lib/mol-model-formats/structure/mmcif.js",
        "molstar/lib/mol-model-formats/structure/property/secondary-structure.js",
        "molstar/lib/mol-model-formats/structure/property/bonds/chem_comp.js",
        "molstar/lib/mol-model-formats/structure/property/bonds/struct_conn.js",
        "molstar/lib/mol-task/index.js",
        "molstar/lib/mol-math/geometry/molecular-surface.js",
        "molstar/lib/mol-math/geometry/boundary.js",
        "molstar/lib/mol-data/int/ordered-set.js",
      ],
    },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: webgpuBrowserArgs,
    });
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    const errors = [];
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(
      "http://127.0.0.1:5216/packages/viewer/test/selection/index.html",
    );
    const wait = async (name, status, count) => {
      await page.waitForFunction(
        ({ name, status, count }) => {
          const value = globalThis.__selection?.statuses[name];
          return value?.status === status &&
            (count === undefined || value.count === count);
        },
        { name, status, count },
        { timeout: 30000 },
      ).catch(async (e) => {
        throw new Error(
          `${name} ${status}(${count}): ${
            errors.join("; ") || e.message
          }; probe=${
            JSON.stringify(
              await page.evaluate(() => ({
                statuses: globalThis.__selection.statuses,
                subscriptions: globalThis.__selection.subscriptions,
                errors: globalThis.__selection.errors,
                events: globalThis.__selection.events.slice(-4),
              })),
            )
          }`,
        );
      });
      assertEquals(errors, [], "page errors");
    };
    const set = (patch) =>
      page.evaluate(async (patch) => {
        globalThis.__selection.set(patch);
        await new Promise(requestAnimationFrame);
      }, patch);
    const snapshot = () =>
      page.evaluate(() => ({
        statuses: globalThis.__selection.statuses,
        subscriptions: globalThis.__selection.subscriptions,
        warnings: globalThis.__selection.warnings,
        errors: globalThis.__selection.errors,
        events: globalThis.__selection.events,
      }));
    await wait("main", "ready", 3);
    assertEquals((await snapshot()).subscriptions, {
      coordinates: 0,
      a: 0,
      b: 0,
    });
    await set({ mode: "model2" });
    await wait("main", "ready", 3);
    await set({ mode: "all" });
    await wait("main", "ready", 8);
    await set({ mode: "fixed" });
    await wait("main", "ready", 8);
    await set({ mode: "site", coordinates: true });
    await wait("main", "ready", 2);
    await set({ mode: "empty", warn: true });
    await wait("main", "ready", 0);
    await wait("field", "ready", 0);
    await wait("label", "ready", 0);
    assertEquals((await snapshot()).statuses.distance.status, "ready");
    const warningCount = (await snapshot()).warnings.length;
    assert(warningCount > 0);
    await set({ generation: 2 });
    await wait("main", "ready", 0);
    assertEquals(
      (await snapshot()).warnings.length,
      warningCount,
      "stable empty warning deduplicates redraws",
    );
    for (const mode of ["bad", "foreign", "stale"]) {
      await set({ mode });
      await wait("main", "error");
      await page.waitForFunction(() =>
        globalThis.__selection.statuses.sibling?.count === 3 ||
        globalThis.__selection.events.some((e) =>
          e.name === "sibling" && e.status.count === 3
        )
      );
      assertEquals((await snapshot()).errors, []);
    }
    await set({ mode: "position", coordinates: false });
    await wait("main", "pending");
    assert((await snapshot()).subscriptions.coordinates > 0);
    await set({ coordinates: true });
    await wait("main", "ready", 3);
    await set({ mode: "attr", coordinates: false, attributes: false });
    await wait("main", "pending");
    let state = await snapshot();
    assert(state.subscriptions.a > 0);
    assertEquals(state.subscriptions.b, 0);
    assertEquals(state.subscriptions.coordinates, 0);
    await set({ attributes: true });
    await wait("main", "ready", 1);
    await wait("transform", "ready", 2); // coordinate selections retain all-row defaults
    await set({ mode: "opaque" });
    await wait("main", "ready", 3);
    assert((await snapshot()).subscriptions.b > 0);
    await set({ mode: "combined", coordinates: false });
    await wait("main", "pending");
    await set({ coordinates: true });
    await wait("main", "ready", 2);
    const tuple = (await snapshot()).statuses.main.sources;
    assert(tuple.some((source) => source.kind === "positions"));
    assert(tuple.some((source) => source.name === "gpu:a"));
    await set({ generation: 3, attributes: false });
    await wait("main", "ready", 2);
    state = await snapshot();
    assert(
      state.statuses.main.updating,
      "retain a complete tuple while the same source updates",
    );
    assertEquals(
      state.statuses.main.sources,
      tuple,
      "retained status reports the published tuple",
    );
    await set({ source: 1 });
    await wait("main", "pending");
    await set({ attributes: true, publication: 3 });
    await wait("main", "ready", 2);
    state = await snapshot();
    assert(
      state.statuses.main.sources.find((source) => source.name === "gpu:a")
        .source !== tuple.find((source) => source.name === "gpu:a").source,
    );
    assert(
      state.statuses.main.sources[0].owner !==
        state.statuses.nested.sources[0].owner,
      "nested structure sources stay isolated",
    );
    await set({ replacement: true, coordinates: false, attributes: false });
    await wait("main", "pending");
    await set({ coordinates: true, attributes: true });
    await wait("main", "ready", 2);
    await set({ mounted: false });
    await page.waitForFunction(() =>
      Object.values(globalThis.__selection.subscriptions).every((n) => n === 0)
    );
    await set({ mounted: true, coordinates: false, attributes: false });
    await wait("main", "pending");
    // Actual coordinate and attribute providers with controllable map completion.
    await page.evaluate(() => {
      globalThis.__selection.hold = true;
    });
    await set({ mounted: false, real: true, resize: false, phase: 0 });
    await wait("real", "pending");
    await page.waitForFunction(() => globalThis.__selection.maps.length >= 2);
    await page.evaluate(async () => {
      globalThis.__selection.hold = false;
      await globalThis.__selection.release();
    });
    await wait("real", "ready", 2);
    assertEquals(await page.evaluate(() => globalThis.__selection.rows), [
      2,
      3,
    ]);
    const realTuple = (await snapshot()).statuses.real.sources;
    await page.evaluate(() => {
      globalThis.__selection.hold = true;
    });
    await set({ phase: 2 });
    await page.waitForFunction(() =>
      globalThis.__selection.maps.length > 0 &&
      globalThis.__selection.statuses.real.updating
    );
    assertEquals((await snapshot()).statuses.real.sources, realTuple);
    await page.evaluate(async () => {
      globalThis.__selection.hold = false;
      await globalThis.__selection.release();
    });
    await wait("real", "ready", 1);
    assertEquals(await page.evaluate(() => globalThis.__selection.rows), [0]);
    await page.evaluate(() => {
      globalThis.__selection.hold = true;
    });
    await set({ phase: 3 });
    await page.waitForFunction(() => globalThis.__selection.maps.length > 0);
    const oldOwner = (await snapshot()).statuses.real.sources[0].owner;
    await set({ resize: true });
    await wait("real", "pending");
    const cutoff = (await snapshot()).events.length;
    await page.evaluate(async () => {
      globalThis.__selection.hold = false;
      await globalThis.__selection.release();
    });
    await wait("real", "ready", 0);
    state = await snapshot();
    assert(state.statuses.real.sources[0].owner !== oldOwner);
    assert(
      !state.events.slice(cutoff).some((event) =>
        event.name === "real" && event.status.sources[0].owner === oldOwner
      ),
      "late maps cannot revive old owner membership",
    );
    await page.evaluate(() => {
      globalThis.__selection.hold = true;
    });
    await set({ phase: 4 });
    await page.waitForFunction(() => globalThis.__selection.maps.length > 0);
    await set({ real: false });
    const beforeRelease = (await snapshot()).events.filter((event) =>
      event.name === "real"
    ).length;
    await page.evaluate(async () => {
      globalThis.__selection.hold = false;
      await globalThis.__selection.release();
      await globalThis.__selection.drain();
    });
    assertEquals(
      (await snapshot()).events.filter((event) => event.name === "real").length,
      beforeRelease,
      "unmounted selection emits no late status",
    );
    // Real molecular acceptance scene: BCIF loader, trajectory, transform,
    // Ribbon/ligand/within, EField/isosurface, and coordinate+DSSP query.
    await set({ mounted: false, acceptance: true });
    await wait("acceptance", "ready");
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
    });
    await page.evaluate(() => globalThis.__selection.drain());
    assertEquals(errors, []);
    assertEquals((await snapshot()).errors, [], "uncaptured WebGPU errors");
    await set({ acceptance: false });
    console.log(
      JSON.stringify({
        status: "passed",
        browser: browser.version(),
        events: (await snapshot()).events.length,
      }),
    );
  } finally {
    await browser?.close();
    await server.close();
    await Deno.remove(cacheDir, { recursive: true });
  }
});
