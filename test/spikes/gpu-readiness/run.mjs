import { createServer } from "vite";
import { chromium } from "playwright";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";
import { webgpuBrowserArgs } from "../../../packages/viewer/test/webgpu-browser-args.mjs";

const root = new URL("../../../", import.meta.url).pathname;
const acceptance = Deno.args.includes("--acceptance");
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: workspaceAliases() },
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: { entries: ["test/spikes/gpu-readiness/index.html"] },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: webgpuBrowserArgs,
  });
  const results = { browser: browser.version(), scenarios: [] };
  for (const mode of ["attribute", "coordinates"]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.addInitScript((mode) => {
      const code = new WeakMap();
      const shader = GPUDevice.prototype.createShaderModule;
      GPUDevice.prototype.createShaderModule = function (descriptor) {
        const module = shader.call(this, descriptor);
        code.set(module, descriptor.code);
        return module;
      };
      const pipeline = GPUDevice.prototype.createComputePipelineAsync;
      const held = [];
      const gpuErrors = [];
      const seen = new WeakSet();
      let released = false;
      GPUDevice.prototype.createComputePipelineAsync = function (descriptor) {
        if (!seen.has(this)) {
          seen.add(this);
          this.addEventListener(
            "uncapturederror",
            (event) => gpuErrors.push(event.error.message),
          );
        }
        const result = pipeline.call(this, descriptor);
        const isAttribute = code.get(descriptor.compute.module)?.includes(
          "113.0",
        );
        if (released || isAttribute !== (mode === "attribute")) return result;
        return new Promise((resolve, reject) => {
          held.push(() => result.then(resolve, reject));
        });
      };
      globalThis.__compileGate = {
        held,
        gpuErrors,
        release: () => {
          released = true;
          held.forEach((release) => release());
        },
      };
    }, mode);
    await page.goto(
      `${server.resolvedUrls.local[0]}test/spikes/gpu-readiness/index.html`,
    );
    await page.waitForFunction(
      () =>
        globalThis.__compileGate.held.length &&
        globalThis.__readiness?.coordinates,
      null,
      { timeout: 30000 },
    );
    // Keep the promise unresolved beyond every existing 16..800 ms wakeup.
    await page.waitForTimeout(1000);
    const sample = () =>
      page.evaluate(async () => ({
        held: globalThis.__compileGate.held.length,
        ready: globalThis.__readiness.coordinates?.ready,
        generation: globalThis.__readiness.coordinates?.generation,
        positions: globalThis.__readiness.positions,
        snapshot: globalThis.__readiness.snapshot,
        gpu: await globalThis.__readiness.read(),
        gpuErrors: [...globalThis.__compileGate.gpuErrors],
      }));
    const before = await sample();
    await page.evaluate(() => globalThis.__compileGate.release());
    await page.waitForFunction(
      async () => (await globalThis.__readiness.read())[0] === 120,
      null,
      { timeout: 10000 },
    );
    await page.waitForTimeout(1000);
    const after = await sample();
    const expected = [120, 121, 122, 123];
    const checks = {
      pendingAttributeHidden: before.snapshot === null,
      pendingCoordinatesHidden: mode !== "coordinates" ||
        before.positions === null,
      finalSnapshotCorrect: JSON.stringify(after.snapshot) ===
        JSON.stringify(expected),
      finalGpuCorrect: JSON.stringify(after.gpu) === JSON.stringify(expected),
      noErrors: errors.length === 0 && before.gpuErrors.length === 0 &&
        after.gpuErrors.length === 0,
    };
    results.scenarios.push({ mode, before, after, checks, errors });
    await page.close();
  }
  const output = new URL(
    "../../../docs/findings/evidence/2026-09-28-gpu-readiness.json",
    import.meta.url,
  );
  await Deno.writeTextFile(output, JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
  if (
    acceptance &&
    results.scenarios.some((s) =>
      Object.values(s.checks).some((passed) => !passed)
    )
  ) {
    throw new Error("GPU publication acceptance failed; see saved checks");
  }
} finally {
  await browser?.close();
  await server.close();
}
