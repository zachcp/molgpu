// Gate 2 acceptance: recolouring the ball-and-stick uploads no new geometry.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";

Deno.test("viewer gate 2", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
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
      args: ["--enable-unsafe-webgpu"],
    });
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://127.0.0.1:5195/packages/viewer/test/gate2.html");
    await page.waitForFunction(
      () => window.__probe?.mounted && document.querySelector("canvas"),
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
        storage: [...window.__probe.storage],
        storageLabels: window.__probe.storageBuffers.map((buffer) =>
          buffer.label
        ),
        storageWrites: [...window.__probe.storageWrites],
        errors: [...window.__probe.errors],
      }));

    await settle();
    await settle();
    const before = await snap();
    const beforeShot = await shot();
    assert.ok(
      before.storageLabels.filter((label) => label === "molgpu:positions")
        .length >= 1,
      "probe must observe the shared coordinate buffer",
    );
    assert.ok(
      before.storageLabels.includes("molgpu:endpoints"),
      "probe must observe bond endpoint rows",
    );
    assert.ok(
      before.storageLabels.includes("molgpu:segments"),
      "probe must observe bond segment buffer",
    );

    // Recolour by swapping the field on all three consumers at once.
    await page.evaluate(() => window.__probe.setPalette(1));
    await settle();
    await settle();
    const after = await snap();
    const afterShot = await shot();

    assert.ok(
      !afterShot.equals(beforeShot),
      "recolour must change the rendered image",
    );
    const newBuffers = after.storage.slice(before.storage.length);
    const newWrites = after.storageWrites.slice(before.storageWrites.length);
    assert.equal(
      newBuffers.length,
      0,
      `recolour allocated storage buffers: ${newBuffers}`,
    );
    const geometryWrites = newWrites.filter(({ label }) =>
      label === "molgpu:positions" || label === "molgpu:endpoints" ||
      label === "molgpu:segments"
    );
    assert.deepEqual(
      geometryWrites,
      [],
      `recolour uploaded geometry: ${JSON.stringify(geometryWrites)}`,
    );
    assert.deepEqual(after.errors, [], "uncaptured WebGPU errors");
    // Exercise the default Bonds appearance in the same real WebGPU scene.
    await page.evaluate(() => window.__probe.setMode("bonds"));
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
    assert.ok(
      colorCounts.blue > 20 && colorCounts.red > 20,
      `default C-N-O bonds must show blue N and red O halves: ${
        JSON.stringify(colorCounts)
      }`,
    );
    assert.deepEqual((await snap()).errors, [], "default bonds WebGPU errors");
    // The same controlled clock now samples a focused camera curve. Rewind must
    // reproduce the earlier frame without touching molecular geometry.
    const beforeFocus = await snap();
    await page.evaluate(() => window.__probe.setTime(2));
    await settle();
    await settle();
    const focused = await snap();
    const focusedShot = await shot();
    assert.deepEqual(await page.evaluate(() => window.__probe.camera.target), [
      1,
      0,
      0,
    ]);
    assert.ok(
      !focusedShot.equals(defaultBondPng),
      "focused camera must change the image",
    );
    assert.equal(
      focused.storage.length - beforeFocus.storage.length,
      0,
      "focus allocated geometry",
    );
    assert.deepEqual(
      focused.storageWrites.slice(beforeFocus.storageWrites.length)
        .filter(({ label }) =>
          label === "molgpu:positions" || label === "molgpu:segments"
        ),
      [],
      "focus rewrote geometry",
    );
    await page.evaluate(() => window.__probe.setTime(0));
    await settle();
    await settle();
    const rewound = await snap();
    assert.ok(
      (await shot()).equals(defaultBondPng),
      "reverse camera scrub must reproduce the prior image",
    );
    assert.equal(
      rewound.storage.length - focused.storage.length,
      0,
      "reverse focus allocated geometry",
    );
    assert.deepEqual(rewound.errors, [], "focused camera WebGPU errors");
    console.log(JSON.stringify({
      status: "passed",
      storageBefore: before.storage.length,
      recolorStorageSizes: newBuffers,
      recolorStorageWrites: newWrites.length,
      geometryWrites: geometryWrites.length,
      browser: browser.version(),
    }));
  } finally {
    await browser?.close();
    await server.close();
  }
});
