import { assert, assertEquals } from "@std/assert";
import {
  captureErrors,
  launchWebGpuBrowser,
  startDevServer,
} from "./harness.mjs";

Deno.test("x0p: native sphere depth, mesh reference, shadow and 100k probe", async () => {
  const server = await startDevServer({
    port: 5233,
    entries: ["packages/viewer/test/sphere-spike.html"],
  });
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    const errors = captureErrors(page);
    const load = async (query) => {
      await page.goto(
        `http://127.0.0.1:5233/packages/viewer/test/sphere-spike.html?${query}`,
      );
      await page.waitForFunction(() => globalThis.__sphere?.objectDraws > 0);
      await page.evaluate(() => globalThis.__sphere.drain());
      return await pixels();
    };
    const change = async (next, capture = true) => {
      const draws = await page.evaluate((next) => {
        const draws = globalThis.__sphere.objectDraws;
        globalThis.__sphere.set(next);
        return draws;
      }, next);
      await page.waitForFunction(
        (draws) => globalThis.__sphere.objectDraws > draws,
        draws,
      );
      await page.evaluate(() => globalThis.__sphere.drain());
      return capture ? await pixels() : null;
    };
    const pixels = async () => {
      const png = await page.locator("canvas").screenshot();
      return await page.evaluate(async (bytes) => {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
        );
        const c = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = c.getContext("2d");
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return [...ctx.getImageData(0, 0, c.width, c.height).data];
      }, [...png]);
    };
    const current = await load("renderer=current");
    const candidate = await load("renderer=candidate");
    const reference = await load("renderer=mesh");
    const compare = (a, b) => {
      let error = 0, lit = 0, different = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (
          a[i] + a[i + 1] + a[i + 2] < 60 && b[i] + b[i + 1] + b[i + 2] < 60
        ) continue;
        lit++;
        const e = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) +
          Math.abs(a[i + 2] - b[i + 2]);
        error += e / 3;
        if (e > 60) different++;
      }
      return {
        lit,
        meanChannelError: error / lit,
        differentFraction: different / lit,
      };
    };
    const depth = {
      current: compare(current, reference),
      candidate: compare(candidate, reference),
    };
    console.log("sphere vs mesh normals", JSON.stringify(depth));
    assert(depth.current.lit > 1000);
    assert(
      depth.current.meanChannelError < 20,
      "native sphere normals/intersections agree with tessellated mesh",
    );
    assert(
      depth.candidate.meanChannelError < 20,
      "pass-aware candidate retains camera correctness",
    );
    const shadow = {};
    for (const renderer of ["mesh", "current", "candidate"]) {
      const image = await load(`renderer=${renderer}&shadow&pbr`);
      shadow[renderer] = image.filter((_, i) => i % 4 !== 3).reduce(
        (a, b) => a + b,
        0,
      );
    }
    console.log("shadow image brightness", JSON.stringify(shadow));
    await load("renderer=candidate&ssao&pbr");
    assertEquals(await page.evaluate(() => globalThis.__sphere.errors), []);
    const timings = {};
    for (const renderer of ["current", "candidate"]) {
      await load(`renderer=${renderer}&count=100000&pbr`);
      const storage = await page.evaluate(() => globalThis.__sphere.storage);
      await change({ roughness: 0.8 }, false);
      const samples = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        await change({ bearing: 0.02 + i * 0.01 }, false);
        samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      timings[renderer] = { medianMs: samples[10], p95Ms: samples[19] };
      assertEquals(
        await page.evaluate(() => globalThis.__sphere.storage),
        storage,
        "camera and roughness edits reuse molecular storage",
      );
    }
    // CPU updates plus submitted queue completion; not GPU timestamp time.
    console.log(
      "100k camera update and queue completion",
      JSON.stringify(timings),
    );
    await Deno.writeTextFile(
      new URL(
        "../../../docs/findings/evidence/2026-10-10-sphere-spike.json",
        import.meta.url,
      ),
      JSON.stringify(
        { browser: await browser.version(), depth, shadow, timings },
        null,
        2,
      ) + "\n",
    );
    await page.evaluate(() => globalThis.__sphere.unmount());
    await page.evaluate(() => globalThis.__sphere.drain());
    assertEquals(await page.evaluate(() => globalThis.__sphere.errors), []);
    assertEquals(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});
