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
  for (
    const mode of [
      "attribute",
      "coordinates",
      "both",
      "replacement",
      "unmount",
      "attribute-replacement",
      "attribute-unmount",
    ]
  ) {
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
      const dispatch = GPUComputePassEncoder.prototype.dispatchWorkgroups;
      let dispatches = 0;
      GPUComputePassEncoder.prototype.dispatchWorkgroups = function (...args) {
        dispatches++;
        return dispatch.apply(this, args);
      };
      const held = [];
      const gpuErrors = [];
      const seen = new WeakSet();
      let released = false;
      let releasedCoordinates = false;
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
        if (
          released || (releasedCoordinates && !isAttribute) ||
          (!["both", "replacement", "unmount"].includes(mode) &&
            isAttribute !== mode.startsWith("attribute"))
        ) return result;
        return new Promise((resolve, reject) => {
          held.push({
            isAttribute,
            release: () => result.then(resolve, reject),
          });
        });
      };
      globalThis.__compileGate = {
        held,
        gpuErrors,
        dispatches: () => dispatches,
        release: () => {
          released = true;
          held.forEach((entry) => entry.release());
        },
        releaseCoordinates: () => {
          releasedCoordinates = true;
          held.filter((entry) => !entry.isAttribute).forEach((entry) =>
            entry.release()
          );
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
      page.evaluate(async (mode) => ({
        held: globalThis.__compileGate.held.length,
        ready: globalThis.__readiness.coordinates?.ready,
        attributeReady: globalThis.__readiness.attributeReady,
        generation: globalThis.__readiness.coordinates?.generation,
        positions: globalThis.__readiness.positions,
        snapshot: globalThis.__readiness.snapshot,
        bounds: globalThis.__readiness.bounds,
        dispatches: globalThis.__compileGate.dispatches(),
        gpu: mode.endsWith("unmount") && globalThis.__unmounted
          ? null
          : await globalThis.__readiness.read(),
        gpuErrors: [...globalThis.__compileGate.gpuErrors],
      }), mode);
    const before = await sample();
    let middle = null;
    if (mode === "both") {
      await page.evaluate(() => globalThis.__compileGate.releaseCoordinates());
      await page.waitForFunction(
        () =>
          globalThis.__readiness.coordinates?.ready &&
          globalThis.__compileGate.held.some((entry) => entry.isAttribute),
        null,
        { timeout: 10000 },
      );
      await page.waitForTimeout(1000);
      middle = await sample();
    }
    if (mode.endsWith("replacement") || mode.endsWith("unmount")) {
      await page.evaluate(() => {
        globalThis.__readiness.setMounted(false);
        globalThis.__unmounted = true;
        globalThis.__readiness.positions = null;
        globalThis.__readiness.snapshot = null;
        globalThis.__readiness.bounds = null;
      });
      if (mode.endsWith("replacement")) {
        await page.evaluate(() => {
          globalThis.__readiness.setOffset(9);
          globalThis.__readiness.setMounted(true);
          globalThis.__unmounted = false;
        });
      }
    }
    await page.evaluate(() => globalThis.__compileGate.release());
    if (!mode.endsWith("unmount")) {
      await page.waitForFunction(
        async (mode) =>
          (await globalThis.__readiness.read())[0] ===
            (mode.endsWith("replacement") ? 122 : 120),
        mode,
        { timeout: 10000 },
      );
    }
    await page.waitForTimeout(1000);
    const after = await sample();
    const expected = mode.endsWith("replacement")
      ? [122, 123, 124, 125]
      : [120, 121, 122, 123];
    const checks = {
      pendingAttributeHidden: before.snapshot === null,
      pendingCoordinatesHidden:
        !["coordinates", "both", "replacement", "unmount"]
          .includes(mode) || before.positions === null,
      pendingBoundsHidden: !["coordinates", "both", "replacement", "unmount"]
        .includes(mode) || before.bounds === null,
      chainedAttributeHidden: mode !== "both" ||
        (middle.snapshot === null && middle.attributeReady === false),
      finalSnapshotCorrect: mode.endsWith("unmount") ||
        JSON.stringify(after.snapshot) ===
          JSON.stringify(expected),
      finalGpuCorrect: mode.endsWith("unmount") ||
        JSON.stringify(after.gpu) === JSON.stringify(expected),
      finalBoundsCorrect: mode.endsWith("unmount") ||
        JSON.stringify(after.bounds) ===
          JSON.stringify(
            mode.endsWith("replacement")
              ? [9, 0, 0, 12, 0, 0]
              : [7, 0, 0, 10, 0, 0],
          ),
      noErrors: errors.length === 0 && before.gpuErrors.length === 0 &&
        after.gpuErrors.length === 0,
    };
    if (mode === "attribute") {
      await page.evaluate(() => {
        globalThis.__oldAttributeBuffer =
          globalThis.__readiness.attributeBuffer;
        globalThis.__readiness.setOffset(10);
      });
      await page.waitForFunction(
        async () =>
          globalThis.__readiness.snapshot?.[0] === 123 &&
          (await globalThis.__readiness.read())[0] === 123,
        null,
        { timeout: 10000 },
      );
      const updated = await sample();
      checks.sameBufferUpdate = JSON.stringify(updated.snapshot) ===
          JSON.stringify([123, 124, 125, 126]) &&
        updated.generation === before.generation + 1 &&
        updated.dispatches - after.dispatches === 3 &&
        await page.evaluate(() =>
          globalThis.__oldAttributeBuffer ===
            globalThis.__readiness.attributeBuffer
        );
    }
    results.scenarios.push({ mode, before, middle, after, checks, errors });
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
