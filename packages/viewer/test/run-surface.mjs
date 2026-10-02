// 0sj.3 acceptance: a real corpus structure renders a surface with source
// attribution built in, probe radius/resolution rebuild geometry, an empty
// selection renders nothing without error, and color/opacity does not
// rebuild geometry.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  captureErrors,
  launchWebGpuBrowser,
  startDevServer,
} from "./harness.mjs";

Deno.test("viewer surface", async () => {
  const server = await startDevServer({
    port: 5201,
    entries: ["packages/viewer/test/surface.html"],
  });
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    const errors = captureErrors(page);
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

    // Live coordinates rebuild the mesh on the GPU from every generation,
    // with no CPU geometry upload; a style edit rebuilds nothing.
    const gpuMeshes = () =>
      page.evaluate(() =>
        globalThis.__probe.storageBuffers.filter((b) =>
          b.label === "molgpu:marching-cubes:positions"
        ).length
      );
    const cpuMeshes = () =>
      page.evaluate(() =>
        globalThis.__probe.storageBuffers.filter((b) =>
          b.label === "molgpu:positions"
        ).length
      );
    // An identity transform passes root coordinates through; shift first.
    await page.evaluate(() => globalThis.__probe.setShift(1));
    await page.evaluate(() => globalThis.__probe.setMode("moving"));
    await page.waitForFunction(
      () =>
        globalThis.__probe.storageBuffers.some((b) =>
          b.label === "molgpu:marching-cubes:positions"
        ),
      null,
      { timeout: 30000 },
    );
    await settle();
    await settle();
    const movingShot = await shot();
    const cpuBefore = await cpuMeshes();
    const gpuBefore = await gpuMeshes();
    assertEquals(
      (await snap()).errors,
      [],
      "GPU surface produced WebGPU errors",
    );
    await page.evaluate(() => globalThis.__probe.setShift(3));
    await page.waitForFunction(
      (n) =>
        globalThis.__probe.storageBuffers.filter((b) =>
          b.label === "molgpu:marching-cubes:positions"
        ).length > n,
      gpuBefore,
      { timeout: 30000 },
    );
    await settle();
    await settle();
    assert(
      !(await shot()).equals(movingShot),
      "moved coordinates must move the GPU surface",
    );
    // A burst of generations: builds coalesce and replaced meshes retire
    // without a draw touching a destroyed buffer.
    for (let i = 0; i < 12; i++) {
      await page.evaluate((x) => globalThis.__probe.setShift(x), 3 + i * 0.25);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await settle();
    await settle();
    const burst = await gpuMeshes();
    assert(burst - gpuBefore <= 13, "each generation builds at most once");
    assertEquals(
      await cpuMeshes(),
      cpuBefore,
      "live coordinates must not upload CPU surface geometry",
    );
    await page.evaluate(() => globalThis.__probe.setColor([0.2, 0.6, 0.9, 1]));
    await settle();
    await settle();
    assertEquals(
      await gpuMeshes(),
      burst,
      "a color edit must not rebuild the GPU surface",
    );
    await page.evaluate(() => globalThis.__probe.setMode("surface"));
    await settle();
    await settle();
    assertEquals(
      (await snap()).errors,
      [],
      "moving, recoloring and unmounting the GPU surface produced WebGPU errors",
    );

    console.log(
      JSON.stringify({
        status: "passed",
        gpuBuilds: burst,
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
