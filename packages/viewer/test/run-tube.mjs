// 0sj.5 acceptance: multiple runs render as separate strips (never bridged
// across the chain break), empty input renders nothing without error, and a
// width/color edit uploads no new geometry.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";

Deno.test("viewer tube", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port: 5197, strictPort: true },
    optimizeDeps: {
      entries: ["packages/viewer/test/tube.html"],
      exclude: [
        "@molgpu/fields",
        "@molgpu/table",
        "@molgpu/io",
        "@molgpu/select",
        "@molgpu/viewer",
      ],
      include: [
        "@use-gpu/live",
        "@use-gpu/workbench",
        "@use-gpu/webgpu",
        "@use-gpu/core",
        "@use-gpu/shader",
        "@use-gpu/shader/wgsl",
        "@use-gpu/wgsl",
        "lodash",
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
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("http://127.0.0.1:5197/packages/viewer/test/tube.html");
    await page.waitForFunction(
      () => window.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Tube mount failed: ${errors.join("; ") || error.message}`,
        );
      });

    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      });
    const shot = () => page.locator("canvas").screenshot();
    const snap = () =>
      page.evaluate(() => ({
        storage: window.__probe.storage.length,
        storageCapacities: window.__probe.storage.map((s) => s.capacity),
        storageLabels: window.__probe.storageBuffers.map((b) => b.label),
        storageWrites: [...window.__probe.storageWrites],
        errors: [...window.__probe.errors],
      }));

    await settle();
    await settle();
    const multi = await snap();
    const multiShot = await shot();
    assert.deepEqual(
      multi.errors,
      [],
      "multi-run scene produced WebGPU errors",
    );
    assert.ok(
      multi.storageLabels.includes("molgpu:positions"),
      "expected a positions storage buffer",
    );
    assert.ok(
      multi.storageLabels.includes("molgpu:segments"),
      "expected a segments storage buffer",
    );
    // Each 4-residue chain subdivides at the default smooth=6 into 3 segs * 6 + 1
    // = 19 samples; two chains never bridged means 38 total i32 codes, not 19.
    // GPUBuffer sizes round up (observed: to a 16-byte alignment), so allow slack.
    const segmentsCapacity =
      multi.storageCapacities[multi.storageLabels.indexOf("molgpu:segments")];
    assert.ok(
      segmentsCapacity >= 38 * 4 && segmentsCapacity <= 38 * 4 + 16,
      `expected ~38 i32 segment codes (152-168 bytes) for two unbridged 19-sample runs, got ${segmentsCapacity} bytes`,
    );

    // Empty input (a selection that matches no atoms): renders nothing, no crash.
    await page.evaluate(() => window.__probe.setMode("empty"));
    await settle();
    await settle();
    const empty = await snap();
    const emptyShot = await shot();
    assert.deepEqual(
      empty.errors,
      [],
      "empty-input scene produced WebGPU errors",
    );
    assert.ok(
      !emptyShot.equals(multiShot),
      "empty input must stop drawing the tubes",
    );
    const newTubeBuffers = empty.storageLabels.slice(multi.storage)
      .filter((label) =>
        label === "molgpu:positions" || label === "molgpu:segments"
      );
    assert.deepEqual(
      newTubeBuffers,
      [],
      "empty selection must allocate no new tube geometry buffers",
    );

    // Back to the multi-run scene (a fresh mount, so new buffers are expected),
    // then a width/color edit on that now-settled tree: rendered image changes,
    // but zero new geometry (positions/segments) buffers are created.
    await page.evaluate(() => window.__probe.setMode("multi"));
    await settle();
    await settle();
    const restored = await snap();
    const restoredShot = await shot();
    assert.ok(
      restoredShot.equals(multiShot),
      "switching back to the multi-run scene must reproduce the same image",
    );

    await page.evaluate(() => {
      window.__probe.setRadius(0.6);
      window.__probe.setColor([0.9, 0.3, 0.2, 1]);
    });
    await settle();
    await settle();
    const styled = await snap();
    const styledShot = await shot();
    assert.ok(
      !styledShot.equals(restoredShot),
      "a width/color edit must change the rendered image",
    );
    const newGeometryBuffers = styled.storageLabels.slice(restored.storage)
      .filter((label) =>
        label === "molgpu:positions" || label === "molgpu:segments"
      );
    assert.deepEqual(
      newGeometryBuffers,
      [],
      "a width/color edit must not rebuild trace/spline geometry",
    );
    const newGeometryWrites = styled.storageWrites.slice(
      restored.storageWrites.length,
    )
      .filter((w) =>
        w.label === "molgpu:positions" || w.label === "molgpu:segments"
      );
    assert.deepEqual(
      newGeometryWrites,
      [],
      "a width/color edit must not re-upload trace/spline geometry",
    );

    assert.deepEqual(errors, [], "page errors");
    assert.deepEqual(styled.errors, [], "uncaptured WebGPU errors");

    console.log(
      JSON.stringify({
        status: "passed",
        multiStorage: multi.storage,
        segmentsCapacity,
        styledStorageDelta: styled.storage - restored.storage,
        browser: browser.version(),
      }),
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});
