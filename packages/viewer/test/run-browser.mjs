import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";

Deno.test("viewer GPU smoke", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const out = `${root}packages/viewer/test/results`;
  await mkdir(out, { recursive: true });
  const server = await createServer({
    root,
    configFile: false,
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port: 5186, strictPort: true },
    optimizeDeps: {
      include: [
        "@use-gpu/live",
        "@use-gpu/workbench",
        "@use-gpu/webgpu",
        "@use-gpu/core",
        "@use-gpu/shader",
        "@use-gpu/wgsl",
        "lodash",
      ],
    },
  });
  let browser;
  const report = { date: new Date().toISOString(), status: "running" };
  await writeFile(`${out}/report.json`, JSON.stringify(report));
  try {
    await server.listen();
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: webgpuBrowserArgs,
    });
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("http://127.0.0.1:5186/packages/viewer/test/index.html");
    await page.waitForFunction(() => window.__adapter?.mounted, null, {
      timeout: 30000,
    });
    const settle = async () =>
      page.evaluate(async () => {
        for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
        await window.__adapter.drain();
      });
    await settle();
    const snapshot = () => page.evaluate(() => window.__adapter.snapshot());
    const update = async (patch) => {
      await page.evaluate((patch) => window.__adapter.update(patch), patch);
      await settle();
    };
    const read = (key, elements, type) =>
      page.evaluate(([k, n, t]) => window.__adapter.read(k, n, t), [
        key,
        elements,
        type,
      ]);
    const expected = {
      f32: [1.25, 2.5],
      i32: [-1, 2],
      u32: [2147483649, 2],
      "vec2<f32>": [1, 2, 3, 4],
      "vec3<f32>": [1, 2, 3, 0, 4, 5, 6, 0],
      "vec4<f32>": [1, 2, 3, 4, 5, 6, 7, 8],
    };
    const before = await snapshot();
    for (const [format, values] of Object.entries(expected)) {
      assert.deepEqual(
        await read(format, values.length, format),
        values,
        `${format} GPU readback`,
      );
      assert.equal(before.sources[format].length, 2, `${format} logical rows`);
      assert.deepEqual(before.sources[format].size, [2]);
    }
    report.readback = expected;
    // Analyze canvas pixels, not PNG bytes or DOM state, for disconnected strokes.
    const screenshot = async (name) => {
      const png = await page.locator("canvas").screenshot({
        path: `${out}/${name}.png`,
      });
      return page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bmp.width, bmp.height),
          ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const w = canvas.width, h = canvas.height, mask = new Uint8Array(w * h);
        for (let i = 0; i < mask.length; i++) {
          mask[i] =
            data[i * 4] > 128 && data[i * 4 + 1] > 128 && data[i * 4 + 2] > 128
              ? 1
              : 0;
        }
        const components = [];
        for (let i = 0; i < mask.length; i++) {
          if (mask[i]) {
            const queue = [i];
            mask[i] = 0;
            let size = 0;
            for (let q = 0; q < queue.length; q++) {
              const k = queue[q];
              size++;
              for (
                const j of [
                  k - w,
                  k + w,
                  ...(k % w ? [k - 1] : []),
                  ...(k % w < w - 1 ? [k + 1] : []),
                ]
              ) {
                if (j >= 0 && j < mask.length && mask[j]) {
                  mask[j] = 0;
                  queue.push(j);
                }
              }
            }
            if (size > 10) components.push(size);
          }
        }
        return components;
      }, png.toString("base64"));
    };
    assert.equal((await screenshot("three-strokes")).length, 3);
    await update({ trace: true });
    assert.equal((await screenshot("two-traces")).length, 2);
    await page.evaluate(() => window.__adapter.mutate());
    await settle();
    assert.deepEqual(await read("f32", 2, "f32"), [11.25, 2.5]);
    const changed = await snapshot();
    assert.ok(changed.sources.f32.version > before.sources.f32.version);
    report.updated = changed;
    await update({ empty: true });
    assert.equal((await screenshot("empty")).length, 0);
    const empty = await snapshot();
    assert.ok(Object.values(empty.sources).every((s) => s === null));
    assert.equal(
      empty.destroyed,
      before.buffers,
      "empty input must release every observed column buffer",
    );
    await update({ empty: false });
    assert.equal((await screenshot("remounted")).length, 2);
    assert.deepEqual(await read("vec3<f32>", 8, "f32"), expected["vec3<f32>"]);
    await update({ mounted: false });
    const unmounted = await snapshot();
    assert.equal(
      unmounted.destroyed,
      unmounted.buffers,
      "all observed buffers destroyed on unmount",
    );
    report.cleanup = unmounted;
    await update({ mounted: true, trace: false, mode: "hook-segments" });
    report.hookSegmentsComponents = await screenshot("hook-segments");
    await update({ mode: "hook-all" });
    report.hookAllComponents = await screenshot("hook-all");
    // Hook variants are diagnostic controls, not production adapter paths.
    await settle();
    assert.deepEqual(errors, [], "Browser errors");
    assert.deepEqual((await snapshot()).errors, [], "WebGPU errors");
    report.status = "passed";
    report.browser = browser.version();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "failed";
    report.error = String(error);
    throw error;
  } finally {
    await writeFile(
      `${out}/report.json`,
      JSON.stringify(report, null, 2) + "\n",
    );
    await browser?.close();
    await server.close();
  }
});
