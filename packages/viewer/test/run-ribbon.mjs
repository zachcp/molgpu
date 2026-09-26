// 0sj.6 acceptance: a real corpus structure renders a ribbon, a color edit
// uploads no new geometry, and an empty selection renders nothing without
// error.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";

Deno.test("viewer ribbon", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port: 5209, strictPort: true },
    optimizeDeps: {
      entries: ["packages/viewer/test/ribbon.html"],
      exclude: [
        "@molgpu/fields",
        "@molgpu/table",
        "@molgpu/io",
        "@molgpu/geo",
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
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto("http://127.0.0.1:5209/packages/viewer/test/ribbon.html");
    await page.waitForFunction(
      () => window.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Ribbon mount failed: ${errors.join("; ") || error.message}`,
        );
      });
    await page.waitForFunction(
      () =>
        window.__probe.storageBuffers.some((b) =>
          b.label === "molgpu:positions"
        ),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Ribbon geometry never appeared: ${
            errors.join("; ") || error.message
          }`,
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
        storageLabels: window.__probe.storageBuffers.map((b) => b.label),
        errors: [...window.__probe.errors],
      }));

    await settle();
    await settle();
    const initial = await snap();
    const initialShot = await shot();
    assert.deepEqual(
      initial.errors,
      [],
      "initial ribbon produced WebGPU errors",
    );
    assert.ok(
      initial.storageLabels.includes("molgpu:positions"),
      "expected a positions storage buffer",
    );
    assert.ok(
      initial.storageLabels.includes("molgpu:normals"),
      "expected a normals storage buffer",
    );
    assert.ok(
      initial.storageLabels.includes("molgpu:indices"),
      "expected an indices storage buffer",
    );

    // Color is a style edit: the image changes, geometry does not.
    await page.evaluate(() => window.__probe.setColor([0.2, 0.6, 0.9, 1]));
    await settle();
    await settle();
    const styled = await snap();
    const styledShot = await shot();
    assert.deepEqual(styled.errors, [], "color edit produced WebGPU errors");
    assert.equal(
      styled.storage - initial.storage,
      0,
      "a color edit must not rebuild ribbon geometry",
    );
    assert.ok(
      !styledShot.equals(initialShot),
      "a color edit must change the rendered image",
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
      !emptyShot.equals(styledShot),
      "empty input must stop drawing the ribbon",
    );
    const newRibbonBuffers = empty.storageLabels.slice(styled.storage)
      .filter((label) =>
        label === "molgpu:positions" || label === "molgpu:normals" ||
        label === "molgpu:indices"
      );
    assert.deepEqual(
      newRibbonBuffers,
      [],
      "empty selection must allocate no new ribbon geometry buffers",
    );

    console.log(
      JSON.stringify({
        status: "passed",
        initialStorage: initial.storage,
        styledStorageDelta: styled.storage - initial.storage,
        browser: browser.version(),
      }),
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});
