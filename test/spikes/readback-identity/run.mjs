import { assertEquals } from "@std/assert";
import { createServer } from "vite";
import { chromium } from "playwright";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";
import { webgpuBrowserArgs } from "../../../packages/viewer/test/webgpu-browser-args.mjs";

Deno.test("readback provenance survives replacement, resize and unmount", async () => {
  const server = await createServer({
    root: new URL("../../../", import.meta.url).pathname,
    configFile: false,
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port: 0 },
    optimizeDeps: { entries: ["test/spikes/readback-identity/index.html"] },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: webgpuBrowserArgs,
    });
    for (
      const [mode, values] of [
        ["same-buffer", [1, 2]],
        ["buffer", [3, 4]],
        ["layout", [1, 2]],
        ["resize", [5, 6, 7]],
        ["unmount", null],
      ]
    ) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      await page.addInitScript(() => {
        const held = [];
        const gpuErrors = [];
        const seen = new WeakSet();
        const createBuffer = GPUDevice.prototype.createBuffer;
        GPUDevice.prototype.createBuffer = function (descriptor) {
          if (!seen.has(this)) {
            seen.add(this);
            this.addEventListener(
              "uncapturederror",
              (event) => gpuErrors.push(event.error.message),
            );
          }
          return createBuffer.call(this, descriptor);
        };
        const mapAsync = GPUBuffer.prototype.mapAsync;
        GPUBuffer.prototype.mapAsync = function (...args) {
          const mapped = mapAsync.apply(this, args);
          if (this.label !== "molgpu:readback-probe") return mapped;
          return mapped.then(() =>
            new Promise((resolve) => held.push(resolve))
          );
        };
        globalThis.__mapGate = {
          held,
          gpuErrors,
          release: (index) => held[index](),
        };
      });
      await page.goto(
        `${
          server.resolvedUrls.local[0]
        }test/spikes/readback-identity/index.html`,
      );
      await page.waitForFunction(() => globalThis.__mapGate.held.length === 1);
      if (mode === "unmount") {
        await page.evaluate(() => globalThis.__readbackIdentity.unmount());
      } else {
        await page.evaluate(
          (source) => globalThis.__readbackIdentity.replace(source),
          mode,
        );
      }
      await page.evaluate(() => globalThis.__mapGate.release(0));
      if (mode === "unmount") {
        await page.waitForTimeout(100);
        assertEquals(
          await page.evaluate(() => globalThis.__readbackIdentity.events),
          [],
          "unmounted copy must not publish",
        );
      } else {
        await page.waitForFunction(() =>
          globalThis.__mapGate.held.length === 2
        );
        assertEquals(
          await page.evaluate(() => globalThis.__readbackIdentity.events),
          [],
          "old source must be discarded before new map completes",
        );
        await page.evaluate(() => globalThis.__mapGate.release(1));
        await page.waitForFunction(() =>
          globalThis.__readbackIdentity.events.length === 1
        );
        assertEquals(
          await page.evaluate(() => globalThis.__readbackIdentity.events),
          [{ owner: mode, values }],
          `${mode} must obtain its first snapshot at the same generation`,
        );
      }
      assertEquals(errors, [], `${mode} page errors`);
      assertEquals(
        await page.evaluate(() => globalThis.__mapGate.gpuErrors),
        [],
        `${mode} WebGPU errors`,
      );
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});
