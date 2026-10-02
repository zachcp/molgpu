// 0sj.6 acceptance: a real corpus structure renders a ribbon, a color edit
// uploads no new geometry, and an empty selection renders nothing without
// error.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  captureErrors,
  launchWebGpuBrowser,
  startDevServer,
} from "./harness.mjs";

Deno.test("viewer ribbon", async () => {
  const server = await startDevServer({
    port: 5209,
    entries: ["packages/viewer/test/ribbon.html"],
  });
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    const errors = captureErrors(page);
    await page.goto("http://127.0.0.1:5209/packages/viewer/test/ribbon.html");
    await page.waitForFunction(
      () => globalThis.__probe?.mounted && document.querySelector("canvas"),
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
        globalThis.__probe.storageBuffers.some((b) =>
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
      "initial ribbon produced WebGPU errors",
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

    // Color is a style edit: the image changes, geometry does not.
    await page.evaluate(() => globalThis.__probe.setColor([0.2, 0.6, 0.9, 1]));
    await settle();
    await settle();
    const styled = await snap();
    const styledShot = await shot();
    assertEquals(styled.errors, [], "color edit produced WebGPU errors");
    assertStrictEquals(
      styled.storage - initial.storage,
      0,
      "a color edit must not rebuild ribbon geometry",
    );
    assert(
      !styledShot.equals(initialShot),
      "a color edit must change the rendered image",
    );

    // Colour Fields (molgpu-sept-o4r): each is a style edit too. The first field
    // that reads an atom/residue column uploads its source-atom index and the
    // column once; switching fields rebuilds no ribbon geometry.
    const geometry = (labels) =>
      labels.filter((label) =>
        label === "molgpu:positions" || label === "molgpu:normals" ||
        label === "molgpu:indices"
      ).length;
    let previousShot = styledShot;
    for (const name of ["chain", "ss", "bfactor", "chain"]) {
      const before = await snap();
      await page.evaluate((n) => globalThis.__probe.setField(n), name);
      await settle();
      await settle();
      const after = await snap();
      const fieldShot = await shot();
      assertEquals(after.errors, [], `${name} field produced WebGPU errors`);
      assertStrictEquals(
        geometry(after.storageLabels.slice(before.storage)),
        0,
        `a ${name} colour field must not rebuild ribbon geometry`,
      );
      assert(
        !fieldShot.equals(previousShot),
        `the ${name} colour field must change the rendered image`,
      );
      previousShot = fieldShot;
    }
    const fieldsDone = await snap();
    await page.evaluate(() => globalThis.__probe.setColor([0.2, 0.6, 0.9, 1]));
    await settle();
    await settle();
    assertStrictEquals(
      geometry((await snap()).storageLabels.slice(fieldsDone.storage)),
      0,
      "returning to a flat colour must not rebuild ribbon geometry",
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
      !emptyShot.equals(styledShot),
      "empty input must stop drawing the ribbon",
    );
    const newRibbonBuffers = empty.storageLabels.slice(styled.storage)
      .filter((label) =>
        label === "molgpu:positions" || label === "molgpu:normals" ||
        label === "molgpu:indices"
      );
    assertEquals(
      newRibbonBuffers,
      [],
      "empty selection must allocate no new ribbon geometry buffers",
    );

    await page.evaluate(() => globalThis.__probe.setMode("gpu"));
    await page.waitForFunction(() => globalThis.__probe.dsspStatus !== null)
      .catch(async (failure) => {
        throw new Error(
          `GPU DSSP did not publish: ${
            JSON.stringify({
              errors,
              probe: await page.evaluate(() => ({
                status: globalThis.__probe.dsspStatus,
                gpuErrors: globalThis.__probe.errors,
              })),
            })
          }`,
          { cause: failure },
        );
      });
    await settle();
    assertEquals(
      (await snap()).errors,
      [],
      "GPU DSSP ribbon produced WebGPU errors",
    );
    const status = await page.evaluate(() => globalThis.__probe.dsspStatus);
    assertStrictEquals(status.fallback, false);
    assert(status.bridgeCount > 0);
    const snapshot = await page.evaluate(() => globalThis.__probe.dsspSnapshot);
    assertEquals(snapshot, {
      generation: status.generation,
      provenance: "gpu:dssp",
    });
    const gpuBuffers = (await snap()).storageLabels;
    await page.evaluate(() => globalThis.__probe.setColor([0.7, 0.3, 0.5, 1]));
    await settle();
    const afterGpuStyle = await snap();
    assertEquals(afterGpuStyle.errors, []);
    assertStrictEquals(
      await page.evaluate(() => globalThis.__probe.dsspRuns),
      1,
    );
    assertEquals(
      afterGpuStyle.storageLabels.slice(gpuBuffers.length).filter((label) =>
        ["molgpu:positions", "molgpu:normals", "molgpu:indices"].includes(label)
      ),
      [],
      "GPU DSSP ribbon style edit must not rebuild geometry",
    );
    await page.evaluate(() => globalThis.__probe.setShift(2));
    await page.waitForFunction(
      (previous) => globalThis.__probe.dsspStatus?.generation > previous,
      status.generation,
    );
    await page.waitForFunction(() =>
      globalThis.__probe.dsspSnapshot?.generation ===
        globalThis.__probe.dsspStatus?.generation
    );
    assertEquals((await snap()).errors, []);

    // A kernel-backed coordinate source may compile after its buffer appears.
    // One static generation must publish codes only after its first dispatch.
    await page.evaluate(() => {
      globalThis.__probe.dsspStatus = null;
      globalThis.__probe.setMode("wobble");
    });
    await page.waitForFunction(() =>
      globalThis.__probe.dsspStatus !== null &&
      globalThis.__probe.dsspCodes !== null
    );
    assertEquals(
      await page.evaluate(() => globalThis.__probe.dsspCodes),
      await page.evaluate(() => globalThis.__probe.expectedWobbleCodes),
      "static WobbleCoordinates must publish DSSP for its computed positions",
    );

    // Continuous playback keeps one run in flight and publishes intermediate
    // results even when the coordinate generation advances during a readback.
    const runsBeforePlayback = await page.evaluate(() =>
      globalThis.__probe.dsspRuns
    );
    await page.evaluate(() => {
      let phase = 0.7;
      globalThis.__probe.playback = setInterval(
        () => globalThis.__probe.setPhase(phase += 0.08),
        16,
      );
    });
    let duringPlayback;
    try {
      // SwiftShader's readback time varies across CI hosts. Require two
      // publications within a deadline instead of sampling at one arbitrary
      // instant, when the second run may still be in flight.
      await page.waitForFunction(
        (minimum) => globalThis.__probe.dsspRuns >= minimum,
        runsBeforePlayback + 2,
        { timeout: 3000 },
      );
      duringPlayback = await page.evaluate(() => ({
        runs: globalThis.__probe.dsspRuns,
        inFlight: globalThis.__probe.counters().gauges["dssp:in-flight"],
        codes: globalThis.__probe.dsspCodes,
      }));
    } finally {
      await page.evaluate(() => clearInterval(globalThis.__probe.playback));
    }
    assert(
      duringPlayback.runs >= runsBeforePlayback + 2,
      "continuous playback must publish GPU DSSP at a bounded rate",
    );
    assert(
      duringPlayback.inFlight === 0 || duringPlayback.inFlight === 1,
      "continuous playback must keep at most one GPU DSSP run in flight",
    );
    assert(duringPlayback.codes?.length > 0);
    assertEquals((await snap()).errors, []);

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
