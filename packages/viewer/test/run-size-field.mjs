// urn.5 acceptance probe: a style-only `scale` change writes a uniform and
// re-uploads no per-atom column. Warm up, snapshot STORAGE allocations,
// change scale, and assert zero new storage buffers while the image changes.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  captureErrors,
  launchWebGpuBrowser,
  startDevServer,
} from "./harness.mjs";

Deno.test("viewer size field", async () => {
  const server = await startDevServer({
    port: 5193,
    entries: ["packages/viewer/test/size-field.html"],
  });
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
      deviceScaleFactor: 1,
    });
    const errors = captureErrors(page);
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

    // A unit-radius, unshaded circle at the orbit target has an independently
    // known projected diameter. This catches radius/diameter confusion and
    // accidental screen-space sizing across camera, viewport and DPR changes.
    const diameters = [];
    for (
      const { width, height, dpr, radius, scale } of [
        { width: 640, height: 480, dpr: 1, radius: 14, scale: 1 },
        { width: 800, height: 600, dpr: 2, radius: 25, scale: 1.7 },
        { width: 480, height: 640, dpr: 1.5, radius: 20, scale: 0.8 },
      ]
    ) {
      const sizing = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: dpr,
      });
      const sizingErrors = captureErrors(sizing);
      try {
        await sizing.goto(
          "http://127.0.0.1:5193/packages/viewer/test/size-field.html?sizing",
        );
        await sizing.waitForFunction(() => globalThis.__probe?.mounted);
        await sizing.evaluate(({ radius, scale }) => {
          globalThis.__probe.setRadius(radius);
          globalThis.__probe.setScale(scale);
        }, { radius, scale });
        const expected = height * dpr * scale /
          (radius * Math.tan(Math.PI / 6));
        let actual = 0;
        const started = performance.now();
        while (!actual && performance.now() - started < 30000) {
          const png = await sizing.locator("canvas").screenshot();
          actual = await sizing.evaluate(async (base64) => {
            const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
            const bitmap = await createImageBitmap(
              new Blob([bytes], { type: "image/png" }),
            );
            const copy = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = copy.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            const { data } = context.getImageData(
              0,
              Math.floor(copy.height / 2),
              copy.width,
              1,
            );
            let diameter = 0;
            for (let x = 0; x < copy.width; x++) {
              if (data[x * 4] > 32) diameter++;
            }
            return diameter;
          }, png.toString("base64"));
        }
        assert(
          Math.abs(actual - expected) <= 3,
          `world-unit diameter: ${actual} pixels, expected ${expected}`,
        );
        diameters.push({ expected, actual });
        assertEquals(sizingErrors, [], "sizing page errors");
        assertEquals(
          await sizing.evaluate(() => globalThis.__probe.errors),
          [],
          "sizing WebGPU errors",
        );
      } finally {
        await sizing.close();
      }
    }

    console.log(JSON.stringify({
      status: "passed",
      diameters,
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
