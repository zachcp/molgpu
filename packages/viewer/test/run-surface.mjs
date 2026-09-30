// 0sj.3 acceptance: a real corpus structure renders a surface with source
// attribution built in, probe radius/resolution rebuild geometry, an empty
// selection renders nothing without error, and color/opacity does not
// rebuild geometry.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";

Deno.test("viewer surface", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port: 5201, strictPort: true },
    optimizeDeps: {
      entries: ["packages/viewer/test/surface.html"],
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
        // @molgpu/timeline imports this pinned easing module. Prebundle it before
        // navigation so Vite does not reload live modules with an Outdated
        // Optimize Dep response during the test.
        "@use-gpu/core/mjs/ease.mjs",
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
    await page.goto("http://127.0.0.1:5201/packages/viewer/test/surface.html");
    await page.waitForFunction(
      () => globalThis.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Surface mount failed: ${errors.join("; ") || error.message}`,
        );
      });
    // The field/mesh build is async (useGeometryJob); wait for its geometry
    // buffer to actually appear rather than guessing a frame count.
    await page.waitForFunction(
      () =>
        globalThis.__probe.storageBuffers.some((b) =>
          b.label === "molgpu:positions"
        ),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Surface geometry never appeared: ${
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
        storage: globalThis.__probe.storage.length,
        storageLabels: globalThis.__probe.storageBuffers.map((b) => b.label),
        errors: [...globalThis.__probe.errors],
      }));

    await settle();
    await settle();
    const initial = await snap();
    const initialShot = await shot();
    assertEquals(
      initial.errors,
      [],
      "initial surface produced WebGPU errors",
    );
    assert(
      initial.storageLabels.includes("molgpu:positions"),
      "expected a positions storage buffer",
    );
    assert(
      initial.storageLabels.includes("molgpu:normals"),
      "expected a normals storage buffer",
    );
    assert(
      initial.storageLabels.includes("molgpu:indices"),
      "expected an indices storage buffer",
    );

    // A resolution change rebuilds the field/mesh: new geometry buffers appear.
    await page.evaluate(() => globalThis.__probe.setResolution(0.7));
    await page.waitForFunction(
      (n) => globalThis.__probe.storage.length > n,
      initial.storage,
      { timeout: 30000 },
    );
    await settle();
    await settle();
    const rebuilt = await snap();
    const rebuiltShot = await shot();
    assertEquals(
      rebuilt.errors,
      [],
      "resolution rebuild produced WebGPU errors",
    );
    assert(
      rebuilt.storage > initial.storage,
      "a resolution change must rebuild geometry (new storage buffers)",
    );
    assert(
      !rebuiltShot.equals(initialShot),
      "a resolution change must change the rendered image",
    );

    // Color/opacity is a style edit: the image changes, geometry does not.
    await page.evaluate(() => globalThis.__probe.setColor([0.9, 0.3, 0.2, 1]));
    await settle();
    await settle();
    const styled = await snap();
    const styledShot = await shot();
    assertEquals(styled.errors, [], "color edit produced WebGPU errors");
    assertStrictEquals(
      styled.storage - rebuilt.storage,
      0,
      "a color edit must not rebuild surface geometry",
    );
    assert(
      !styledShot.equals(rebuiltShot),
      "a color edit must change the rendered image",
    );

    // Atom fields gather through sourceAtom, while the surface mesh is reused.
    await page.evaluate(() => globalThis.__probe.setElementColor());
    await settle();
    await settle();
    const attributed = await snap();
    const attributedShot = await shot();
    assertEquals(attributed.errors, [], "atom field produced WebGPU errors");
    for (
      const label of ["molgpu:positions", "molgpu:normals", "molgpu:indices"]
    ) {
      assertStrictEquals(
        attributed.storageLabels.filter((name) => name === label).length,
        styled.storageLabels.filter((name) => name === label).length,
        `${label} must not be rebuilt for atom coloring`,
      );
    }
    assert(
      attributed.storageLabels.includes("molgpu:sourceAtom"),
      "atom coloring uploads the vertex-to-atom index",
    );
    assert(
      !attributedShot.equals(styledShot),
      "atom field changes surface colors",
    );

    // Empty input (a selection that matches no atoms): renders nothing, no crash.
    await page.evaluate(() => globalThis.__probe.setMode("empty"));
    await settle();
    await settle();
    const empty = await snap();
    const emptyShot = await shot();
    assertEquals(
      empty.errors,
      [],
      "empty-input scene produced WebGPU errors",
    );
    assert(
      !emptyShot.equals(attributedShot),
      "empty input must stop drawing the surface",
    );
    const newSurfaceBuffers = empty.storageLabels.slice(styled.storage)
      .filter((label) =>
        label === "molgpu:positions" || label === "molgpu:normals" ||
        label === "molgpu:indices"
      );
    assertEquals(
      newSurfaceBuffers,
      [],
      "empty selection must allocate no new surface geometry buffers",
    );

    console.log(
      JSON.stringify({
        status: "passed",
        initialStorage: initial.storage,
        rebuiltStorage: rebuilt.storage,
        styledStorageDelta: styled.storage - rebuilt.storage,
        browser: browser.version(),
      }),
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});
