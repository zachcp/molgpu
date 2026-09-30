// urn.5 acceptance probe: a style-only `scale` change writes a uniform and
// re-uploads no per-atom column. Warm up, snapshot STORAGE allocations,
// change scale, and assert zero new storage buffers while the image changes.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";

Deno.test("viewer size field", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port: 5193, strictPort: true },
    optimizeDeps: {
      entries: ["packages/viewer/test/size-field.html"],
      exclude: [
        "@molgpu/fields",
        "@molgpu/table",
        "@molgpu/io",
        "@molgpu/viewer",
        "@molgpu/timeline",
      ],
      include: [
        "@use-gpu/live",
        "@use-gpu/workbench",
        "@use-gpu/webgpu",
        "@use-gpu/core",
        // @molgpu/timeline imports this pinned easing module. Prebundle it before
        // navigation so Vite does not reload live modules with an Outdated
        // Optimize Dep response during the test.
        "@use-gpu/core/mjs/ease.mjs",
        "@use-gpu/shader",
        "@use-gpu/shader/wgsl",
        "@use-gpu/wgsl",
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
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(
      "http://127.0.0.1:5193/packages/viewer/test/size-field.html",
    );
    await page.waitForFunction(
      () => globalThis.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    );

    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      });
    const shot = () => page.locator("canvas").screenshot();
    const snap = () =>
      page.evaluate(() => ({
        storage: globalThis.__probe.storage,
        storageLabels: globalThis.__probe.storageBuffers.map((buffer) =>
          buffer.label
        ),
        storageWrites: [...globalThis.__probe.storageWrites],
        uniform: globalThis.__probe.uniform,
        camera: globalThis.__probe.camera,
        errors: [...globalThis.__probe.errors],
      }));
    const geometryWrites = (after, before) =>
      after.storageWrites.slice(before.storageWrites.length)
        .filter((label) =>
          ["molgpu:positions", "molgpu:elements", "molgpu:radii"].includes(
            label,
          )
        );

    await settle();
    await settle(); // reach a resource fixed point
    const before = await snap();
    const beforeShot = await shot();
    for (
      const label of [
        "molgpu:positions",
        "molgpu:elements",
        "molgpu:radii",
      ]
    ) {
      assert(
        before.storageLabels.includes(label),
        `probe missed ${label} buffer`,
      );
    }

    // A style-only scale change. Larger spheres must appear, but no per-atom
    // (STORAGE) column may be reallocated — only the scale uniform is written.
    await page.evaluate(() => globalThis.__probe.setScale(2.5));
    await settle();
    await settle();
    const after = await snap();
    const afterShot = await shot();

    assert(
      !afterShot.equals(beforeShot),
      "scale change must change the rendered image",
    );
    const storageDelta = after.storage - before.storage;
    assertStrictEquals(
      storageDelta,
      0,
      `scale change reallocated ${storageDelta} storage buffers (expected 0)`,
    );

    // Colour field: swapping the byElement palette recompiles the shader module but
    // must re-upload no per-atom column (the element source is reused).
    await page.evaluate(() => globalThis.__probe.setPalette(1));
    await settle();
    await settle();
    const afterPalette = await snap();
    const paletteShot = await shot();
    const paletteDelta = afterPalette.storage - after.storage;
    assert(
      !paletteShot.equals(afterShot),
      "palette change must change the rendered image",
    );
    assertStrictEquals(
      paletteDelta,
      0,
      `palette change reallocated ${paletteDelta} storage buffers (expected 0)`,
    );

    // Time field: switch to the time-driven colour, then advance t. The colour
    // must change from a uniform write with no per-atom re-upload.
    await page.evaluate(() => globalThis.__probe.setPalette(2));
    await settle();
    await settle();
    const timeBase = await snap();
    const timeBaseShot = await shot();
    await page.evaluate(() => globalThis.__probe.setTime(0.85));
    await settle();
    await settle();
    const afterTime = await snap();
    const timeShot = await shot();
    const timeDelta = afterTime.storage - timeBase.storage;
    assert(
      !timeShot.equals(timeBaseShot),
      "time change must change the rendered image",
    );
    assertStrictEquals(
      timeDelta,
      0,
      `time change reallocated ${timeDelta} storage buffers (expected 0)`,
    );
    assertEquals(
      geometryWrites(afterTime, timeBase),
      [],
      "time change rewrote geometry",
    );
    assertEquals(
      afterTime.camera,
      { radius: 34, bearing: 0.6 },
      "style beat keeps camera fixed",
    );

    // The next beat moves the camera with the same controlled t. Rewind through
    // the style beat and back to zero; no per-atom data is allocated on either leg.
    await page.evaluate(() => globalThis.__probe.setTime(2));
    await settle();
    await settle();
    const orbit = await snap();
    const orbitShot = await shot();
    assertEquals(orbit.camera, { radius: 20, bearing: 1.1 });
    assert(
      !orbitShot.equals(timeShot),
      "camera curve must change the rendered image",
    );
    assertStrictEquals(
      orbit.storage - afterTime.storage,
      0,
      "camera scrub reallocated storage",
    );
    assertEquals(
      geometryWrites(orbit, afterTime),
      [],
      "camera scrub rewrote geometry",
    );

    await page.evaluate(() => globalThis.__probe.setTime(0.85));
    await settle();
    await settle();
    const rewind = await snap();
    const rewindShot = await shot();
    assertEquals(rewind.camera, { radius: 34, bearing: 0.6 });
    assert(
      rewindShot.equals(timeShot),
      "reverse scrub must reproduce the prior beat image",
    );
    assertStrictEquals(
      rewind.storage - orbit.storage,
      0,
      "reverse scrub reallocated storage",
    );
    assertEquals(
      geometryWrites(rewind, orbit),
      [],
      "reverse scrub rewrote geometry",
    );

    await page.evaluate(() => globalThis.__probe.setTime(0));
    await settle();
    await settle();
    const reset = await snap();
    assert(
      (await shot()).equals(timeBaseShot),
      "scrub to zero must reproduce the start image",
    );
    assertStrictEquals(
      reset.storage - rewind.storage,
      0,
      "reset scrub reallocated storage",
    );
    assertEquals(
      geometryWrites(reset, rewind),
      [],
      "reset scrub rewrote geometry",
    );

    assertEquals(errors, [], "page errors");
    assertEquals(reset.errors, [], "uncaptured WebGPU errors");

    console.log(JSON.stringify({
      status: "passed",
      storageBefore: before.storage,
      scaleStorageDelta: storageDelta,
      paletteStorageDelta: paletteDelta,
      timeStorageDelta: timeDelta,
      orbitStorageDelta: orbit.storage - afterTime.storage,
      rewindStorageDelta: rewind.storage - orbit.storage,
      uniformBefore: before.uniform,
      browser: browser.version(),
    }));
  } finally {
    await browser?.close();
    await server.close();
  }
});
