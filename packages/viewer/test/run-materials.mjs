// hj0.1 acceptance: a representation wrapped in each @molgpu/viewer material
// mounts and draws under the viewer's light wrappers with no WebGPU errors, and
// a runtime material switch compiles a new render pipeline (the material reaches
// the shaded layer) without allocating new geometry storage buffers.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  captureErrors,
  launchWebGpuBrowser,
  startDevServer,
} from "./harness.mjs";

Deno.test("viewer materials", async () => {
  const server = await startDevServer({
    port: 5211,
    entries: ["packages/viewer/test/materials.html"],
  });
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    const errors = captureErrors(page);
    await page.goto(
      "http://127.0.0.1:5211/packages/viewer/test/materials.html",
    );
    await page.waitForFunction(
      () => globalThis.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Materials mount failed: ${errors.join("; ") || error.message}`,
        );
      });

    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      });
    // Labels are assigned after createBuffer, so read them live off the buffers.
    // The shaded points read Structure's shared GPU radii column.
    const snap = () =>
      page.evaluate(() => ({
        storage: globalThis.__probe.storage.length,
        geometryBuffers: globalThis.__probe.storageBuffers.filter((b) =>
          b.label === "molgpu:radii"
        ).length,
        pipelines: globalThis.__probe.pipelines,
        errors: [...globalThis.__probe.errors],
      }));

    // Default mount is the matte PBR material. It must draw shaded geometry.
    await settle();
    await settle();
    const pbr = await snap();
    assertEquals(
      pbr.errors,
      [],
      "PBR material scene produced WebGPU errors",
    );
    assert(
      pbr.geometryBuffers > 0,
      "expected the structure to upload its radii column",
    );
    assert(
      pbr.pipelines > 0,
      "expected at least one shaded render pipeline",
    );

    // Change a PBR PARAMETER (matte -> metal, same material type). The wrappers
    // bind albedo/metalness/roughness as shader uniforms, so this must be a plain
    // uniform write: no new render pipeline and no rebuilt geometry.
    await page.evaluate(() => globalThis.__probe.setMaterial("metal"));
    await settle();
    await settle();
    const metal = await snap();
    assertEquals(
      metal.errors,
      [],
      "metal PBR scene produced WebGPU errors",
    );
    assertStrictEquals(
      metal.pipelines,
      pbr.pipelines,
      "a PBR parameter change must not compile a new pipeline",
    );
    assertStrictEquals(
      metal.geometryBuffers,
      pbr.geometryBuffers,
      "a PBR parameter change must not rebuild geometry",
    );

    // Switch to a different SHADING MODEL (unlit basic vs lit PBR). That changes
    // the layer's fragment/surface shader, so it must compile a new render
    // pipeline — proving the material really reaches the shaded layer.
    await page.evaluate(() => globalThis.__probe.setMaterial("basic"));
    await settle();
    await settle();
    const basic = await snap();
    assertEquals(
      basic.errors,
      [],
      "basic material scene produced WebGPU errors",
    );
    assert(
      basic.pipelines > metal.pipelines,
      "switching shading model must compile a new render pipeline",
    );

    // The normal-debug material, the function-wrapper escape hatch, and the
    // no-material default must each mount and draw without WebGPU errors.
    for (const name of ["normal", "wrapper", "none"]) {
      await page.evaluate((n) => globalThis.__probe.setMaterial(n), name);
      await settle();
      await settle();
      const s = await snap();
      assertEquals(
        s.errors,
        [],
        `material '${name}' produced WebGPU errors`,
      );
    }

    const final = await snap();
    assertEquals(errors, [], "page errors");
    assertEquals(final.errors, [], "uncaptured WebGPU errors");

    console.log(
      JSON.stringify({
        status: "passed",
        pbrPipelines: pbr.pipelines,
        basicPipelines: basic.pipelines,
        storage: final.storage,
        browser: browser.version(),
      }),
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});
