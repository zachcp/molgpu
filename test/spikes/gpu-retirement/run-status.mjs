import { assert, assertEquals } from "@std/assert";
import { chromium } from "playwright";
import { createServer } from "vite";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";
import { webgpuBrowserArgs } from "../../../packages/viewer/test/webgpu-browser-args.mjs";

const server = await createServer({
  root: new URL("../../../", import.meta.url).pathname,
  configFile: false,
  resolve: { alias: workspaceAliases() },
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: { entries: ["test/spikes/gpu-retirement/status.html"] },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: webgpuBrowserArgs,
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.addInitScript(() => {
    const held = [];
    const destroyed = [];
    const gpuErrors = [];
    const originalMap = GPUBuffer.prototype.mapAsync;
    GPUBuffer.prototype.mapAsync = function (...args) {
      const mapped = originalMap.apply(this, args);
      if (this.label !== "molgpu:status-probe") return mapped;
      return mapped.then(() => new Promise((resolve) => held.push(resolve)));
    };
    const originalDestroy = GPUBuffer.prototype.destroy;
    GPUBuffer.prototype.destroy = function () {
      destroyed.push(this.label);
      return originalDestroy.call(this);
    };
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await request.apply(this, args);
      device.addEventListener(
        "uncapturederror",
        (event) => gpuErrors.push(event.error.message),
      );
      return device;
    };
    globalThis.__statusGate = { held, destroyed, gpuErrors };
  });
  await page.goto(
    `${server.resolvedUrls.local[0]}test/spikes/gpu-retirement/status.html`,
  );
  await page.waitForFunction(() => globalThis.__statusGate.held.length === 1);
  await page.evaluate(() => globalThis.__statusProbe.unmount());
  await page.waitForFunction(() =>
    globalThis.__statusGate.destroyed.filter((label) =>
      label === "molgpu:status-probe"
    ).length === 2
  );
  await page.evaluate(async () => {
    globalThis.__statusGate.held[0]();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  const report = await page.evaluate(() => ({
    reports: [...globalThis.__statusProbe.reports],
    destroyed: [...globalThis.__statusGate.destroyed],
    gpuErrors: [...globalThis.__statusGate.gpuErrors],
  }));
  assertEquals(pageErrors, [], "status page errors");
  assertEquals(report.reports, [], "unmounted status map must not publish");
  assertEquals(report.gpuErrors, [], "status WebGPU errors");
  assert(
    report.destroyed.filter((label) => label === "molgpu:status-probe")
      .length === 2,
  );
  await Deno.writeTextFile(
    new URL(
      "../../../docs/findings/evidence/2026-09-29-status-retirement.json",
      import.meta.url,
    ),
    JSON.stringify({ browser: browser.version(), ...report }, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.close();
}
