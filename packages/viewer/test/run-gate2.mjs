// Gate 2 acceptance: first attribute demand uploads once; styles reuse it.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";

Deno.test("viewer gate 2", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port: 5195, strictPort: true },
    optimizeDeps: {
      entries: ["packages/viewer/test/gate2.html"],
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
      ],
    },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: [...webgpuBrowserArgs, "--js-flags=--expose-gc"],
    });
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://127.0.0.1:5195/packages/viewer/test/gate2.html");
    await page.waitForFunction(
      () => globalThis.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Gate 2 mount failed: ${errors.join("; ") || error.message}`,
        );
      });
    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      });
    const shot = () => page.locator("canvas").screenshot();
    const snap = () =>
      page.evaluate(() => ({
        storage: [...globalThis.__probe.storage],
        storageLabels: globalThis.__probe.storageBuffers.map((buffer) =>
          buffer.label
        ),
        storageWrites: [...globalThis.__probe.storageWrites],
        errors: [...globalThis.__probe.errors],
      }));

    // Wait until first-time allocations stop: a software adapter compiles
    // pipelines slowly, and late startup buffers are not recolour work.
    for (let i = 0, seen = -1; i < 40; i++) {
      await settle();
      const count = await page.evaluate(() =>
        globalThis.__probe.storage.length
      );
      if (count === seen) break;
      seen = count;
    }
    const before = await snap();
    const beforeShot = await shot();
    assert(
      before.storageLabels.filter((label) => label === "molgpu:positions")
        .length >= 1,
      "probe must observe the shared coordinate buffer",
    );
    assert(
      before.storageLabels.includes("molgpu:endpoints"),
      "probe must observe bond endpoint rows",
    );
    assert(
      before.storageLabels.includes("molgpu:segments"),
      "probe must observe bond segment buffer",
    );

    // Recolour by swapping the field on all three consumers at once.
    await page.evaluate(() => globalThis.__probe.setPalette(1));
    await settle();
    await settle();
    const after = await snap();
    const afterShot = await shot();

    assert(
      !afterShot.equals(beforeShot),
      "recolour must change the rendered image",
    );
    const newBuffers = after.storage.slice(before.storage.length);
    const newWrites = after.storageWrites.slice(before.storageWrites.length);
    assertEquals(
      newBuffers.map(({ label, capacity }) => ({ label, capacity })),
      [
        { label: "molgpu:attribute:bfactor", capacity: 16 },
      ],
      "first demand should upload only the immutable bfactor column",
    );
    assertEquals(
      newWrites.filter(({ label }) => label === "molgpu:attribute:bfactor")
        .length,
      1,
      "first demand should write bfactor once",
    );
    const geometryWrites = newWrites.filter(({ label }) =>
      label === "molgpu:positions" || label === "molgpu:endpoints" ||
      label === "molgpu:segments"
    );
    assertEquals(
      geometryWrites,
      [],
      `recolour uploaded geometry: ${JSON.stringify(geometryWrites)}`,
    );
    assertEquals(after.errors, [], "uncaptured WebGPU errors");
    // The previous style may still be held by use.gpu during compilation.
    // Swapping it back and forth must reuse both owner-owned columns.
    await page.evaluate(() => globalThis.__probe.setPalette(0));
    await settle();
    await page.evaluate(() => globalThis.__probe.setPalette(1));
    await settle();
    const repeated = await snap();
    assertEquals(
      repeated.storage.slice(after.storage.length),
      [],
      "repeated styles allocated storage",
    );
    assertEquals(
      repeated.storageWrites.slice(after.storageWrites.length)
        .filter(({ label }) => label?.startsWith("molgpu:attribute:")),
      [],
      "repeated styles uploaded immutable attributes",
    );
    assertEquals(repeated.errors, [], "style replacement WebGPU errors");
    // Exercise the default Bonds appearance in the same real WebGPU scene.
    await page.evaluate(() => globalThis.__probe.setMode("bonds"));
    await settle();
    await settle();
    const defaultBondPng = await shot();
    const colorCounts = await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const image = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      image.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let blue = 0, red = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], b = pixels[i + 2];
        if (b > 60 && b > r * 1.3) blue++;
        if (r > 60 && r > b * 1.3) red++;
      }
      return { blue, red };
    }, defaultBondPng.toString("base64"));
    assert(
      colorCounts.blue > 20 && colorCounts.red > 20,
      `default C-N-O bonds must show blue N and red O halves: ${
        JSON.stringify(colorCounts)
      }`,
    );
    assertEquals((await snap()).errors, [], "default bonds WebGPU errors");
    // The same controlled clock now samples a focused camera curve. Rewind must
    // reproduce the earlier frame without touching molecular geometry.
    const beforeFocus = await snap();
    await page.evaluate(() => globalThis.__probe.setTime(2));
    await settle();
    await settle();
    const focused = await snap();
    const focusedShot = await shot();
    assertEquals(await page.evaluate(() => globalThis.__probe.camera.target), [
      1,
      0,
      0,
    ]);
    assert(
      !focusedShot.equals(defaultBondPng),
      "focused camera must change the image",
    );
    assertStrictEquals(
      focused.storage.length - beforeFocus.storage.length,
      0,
      "focus allocated geometry",
    );
    assertEquals(
      focused.storageWrites.slice(beforeFocus.storageWrites.length)
        .filter(({ label }) =>
          label === "molgpu:positions" || label === "molgpu:segments"
        ),
      [],
      "focus rewrote geometry",
    );
    await page.evaluate(() => globalThis.__probe.setTime(0));
    await settle();
    await settle();
    const rewound = await snap();
    assert(
      (await shot()).equals(defaultBondPng),
      "reverse camera scrub must reproduce the prior image",
    );
    assertStrictEquals(
      rewound.storage.length - focused.storage.length,
      0,
      "reverse focus allocated geometry",
    );
    assertEquals(rewound.errors, [], "focused camera WebGPU errors");

    // Hold the replacement render pipeline while old draw calls can still be
    // submitted. Unmount the Structure before allowing compilation to finish.
    const heldPage = await browser.newPage();
    const heldPageErrors = [];
    heldPage.on("pageerror", (error) => heldPageErrors.push(String(error)));
    await heldPage.addInitScript(() => {
      const held = [];
      const destroyed = [];
      let armed = false;
      const compile = GPUDevice.prototype.createRenderPipelineAsync;
      GPUDevice.prototype.createRenderPipelineAsync = function (desc) {
        const result = compile.call(this, desc);
        if (!armed) return result;
        return new Promise((resolve, reject) => {
          held.push(() => result.then(resolve, reject));
        });
      };
      const destroy = GPUBuffer.prototype.destroy;
      GPUBuffer.prototype.destroy = function () {
        if (this.label?.startsWith("molgpu:attribute:")) {
          destroyed.push(this.label);
        }
        return destroy.call(this);
      };
      globalThis.__compileGate = {
        arm: () => armed = true,
        held: () => held.length,
        release: () => {
          armed = false;
          held.splice(0).forEach((release) => release());
        },
        destroyed,
      };
    });
    await heldPage.goto(
      "http://127.0.0.1:5195/packages/viewer/test/gate2.html",
    );
    await heldPage.waitForFunction(() => globalThis.__probe?.mounted);
    await heldPage.evaluate(async () => {
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      globalThis.__compileGate.arm();
      globalThis.__probe.setPalette(1);
    });
    await heldPage.waitForFunction(() => globalThis.__compileGate.held() > 0);
    await heldPage.evaluate(async () => {
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      globalThis.__probe.setMounted(false);
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      globalThis.__compileGate.release();
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
    });
    const heldResult = await heldPage.evaluate(() => ({
      destroyed: globalThis.__compileGate.destroyed,
      gpuErrors: globalThis.__probe.errors,
    }));
    assertEquals(
      heldResult.destroyed,
      [],
      "owner cleanup explicitly destroyed a possibly retained attribute",
    );
    assertEquals(
      heldResult.gpuErrors,
      [],
      "held replacement or unmount produced a WebGPU error",
    );
    assertEquals(heldPageErrors, [], "held replacement page errors");
    // Reuse one 50k-row column across 64 owners, then churn 64 distinct
    // columns. Browser-native GPU memory is opaque to WebGPU.
    const retention = await heldPage.evaluate(async () => {
      const { immutableAttributeSource, releaseImmutableAttributes } =
        await import("../src/internal/immutable-attribute-cache.ts");
      const values = new Float32Array(50_000);
      const column = { name: "bfactor", values };
      const beforeAllocations = globalThis.__probe.storage.length;
      for (let i = 0; i < 64; i++) {
        const owner = {};
        const source = immutableAttributeSource(
          owner,
          globalThis.__probe.device,
          column,
        );
        if (
          immutableAttributeSource(owner, globalThis.__probe.device, column) !==
            source
        ) throw new Error("same owner did not reuse its attribute source");
        releaseImmutableAttributes(owner);
      }
      const sharedAllocations = globalThis.__probe.storage.length -
        beforeAllocations;
      const refs = [];
      for (let i = 0; i < 64; i++) {
        const owner = {};
        const distinctColumn = { name: `budget-${i}`, values };
        const source = immutableAttributeSource(
          owner,
          globalThis.__probe.device,
          distinctColumn,
        );
        refs.push(new WeakRef(source.buffer));
        releaseImmutableAttributes(owner);
      }
      globalThis.__probe.storageBuffers.length = 0;
      if (typeof globalThis.gc !== "function") {
        throw new Error("Chrome exposed GC is required for wrapper budget");
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        globalThis.gc();
      }
      return {
        owners: refs.length,
        bytesPerOwner: values.byteLength,
        sharedAllocations,
        distinctAllocations: globalThis.__probe.storage.length -
          beforeAllocations - sharedAllocations,
        wrappersRemaining: new Set(
          refs.map((ref) => ref.deref()).filter(Boolean),
        )
          .size,
      };
    });
    assertEquals(
      retention.sharedAllocations,
      1,
      `rapid owner replacement reuploaded the same immutable column: ${
        JSON.stringify(retention)
      }`,
    );
    assertEquals(
      retention.distinctAllocations,
      64,
      "distinct immutable columns must each request one GPUBuffer",
    );
    assert(
      retention.wrappersRemaining <= 1,
      `attribute wrapper retention exceeded one after 64 owner cycles: ${
        JSON.stringify(retention)
      }`,
    );
    await heldPage.close();
    console.log(JSON.stringify({
      status: "passed",
      storageBefore: before.storage.length,
      recolorStorageSizes: newBuffers,
      recolorStorageWrites: newWrites.length,
      geometryWrites: geometryWrites.length,
      retention,
      browser: browser.version(),
    }));
  } finally {
    await browser?.close();
    await server.close();
  }
});
