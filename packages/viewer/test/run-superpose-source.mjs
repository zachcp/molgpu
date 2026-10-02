import { assert, assertEquals, assertMatch } from "@std/assert";
import {
  captureErrors,
  launchWebGpuBrowser,
  startDevServer,
} from "./harness.mjs";

Deno.test("Superpose first reference follows nearest source and request ownership", async () => {
  const server = await startDevServer({
    port: 5199,
    entries: ["packages/viewer/test/trajectory/index.html"],
  });
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage();
    const errors = captureErrors(page);
    await page.goto("http://127.0.0.1:5199/packages/viewer/test/trajectory/");
    await page.waitForFunction(() => globalThis.__trajectory?.mounted);
    const update = (patch) =>
      page.evaluate((patch) => globalThis.__trajectory.update(patch), patch);
    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame);
        await globalThis.__trajectory.device.queue.onSubmittedWorkDone();
      });
    const status = (wanted) =>
      page.waitForFunction(
        (wanted) =>
          globalThis.__trajectory.superpose.statuses.at(-1)?.status === wanted,
        wanted,
      );
    const clear = () =>
      page.evaluate(() => {
        globalThis.__trajectory.superpose.statuses.length = 0;
      });
    const expectPositions = async (kind, tolerance = 0.003) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        await settle();
        const matches = await page.evaluate(async ({ kind, tolerance }) => {
          const t = globalThis.__trajectory;
          const expected = kind === "root"
            ? t.superpose.root
            : t.superpose.frames[kind];
          const source = t.source;
          const staging = t.device.createBuffer({
            size: source.length * 12,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          try {
            const encoder = t.device.createCommandEncoder();
            encoder.copyBufferToBuffer(
              source.buffer,
              0,
              staging,
              0,
              source.length * 12,
            );
            t.device.queue.submit([encoder.finish()]);
            await staging.mapAsync(GPUMapMode.READ);
            const values = new Float32Array(staging.getMappedRange());
            return values.length === expected.length &&
              values.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
          } finally {
            staging.destroy();
          }
        }, { kind, tolerance });
        if (matches) return;
      }
      throw new Error(`coordinates did not match ${kind}`);
    };
    const waitLoad = (count) =>
      page.waitForFunction(
        (count) => globalThis.__trajectory.loads.length === count,
        count,
      );
    const resolveLoad = (index) =>
      page.evaluate((index) => {
        // A noncollinear source, obtained from the ordinary superpose fixture.
        globalThis.__trajectory.loads[index].resolve(
          globalThis.__trajectory.referenceTrajectory,
        );
      }, index);

    await update({ mode: "superpose-reload", src: "opening.xtc", frame: 0 });
    await waitLoad(1);
    await settle();
    assertEquals(
      errors,
      [],
      "opening source must not throw a missing-ancestor error",
    );
    await status("pending");
    await expectPositions("root");
    await resolveLoad(0);
    await status("solved");
    await expectPositions(0);

    await clear();
    await update({ src: "replacement.xtc" });
    await waitLoad(2);
    await status("pending");
    await expectPositions("root");
    await page.evaluate(() =>
      globalThis.__trajectory.loads[1].reject(new Error("source rejected"))
    );
    await status("error");
    assertEquals(
      await page.evaluate(() =>
        globalThis.__trajectory.superpose.statuses.at(-1).phase
      ),
      "source",
    );
    await expectPositions("root");
    await clear();
    await update({ src: "cancel.xtc" });
    await waitLoad(3);
    await status("pending");
    await update({ src: "retry.xtc" });
    await waitLoad(4);
    assert(
      await page.evaluate(() =>
        globalThis.__trajectory.loads[2].signal.aborted
      ),
    );
    await resolveLoad(2);
    await settle();
    assertEquals(
      await page.evaluate(() =>
        globalThis.__trajectory.superpose.statuses.at(-1).status
      ),
      "pending",
    );
    await resolveLoad(3);
    await status("solved");
    await expectPositions(0);
    await update({ mode: "none" });
    await settle();

    // An opening/failed inner trajectory shadows outer metadata while passing
    // through the outer coordinates. Siblings continue to see their own scope.
    await clear();
    await update({ mode: "superpose-nested", src: "nested.xtc", frame: 0 });
    await waitLoad(5);
    await status("pending");
    await expectPositions(1);
    const scope = await page.evaluate(() => globalThis.__trajectory.scope);
    assertEquals(scope.inner.trajectory, false);
    assertEquals(scope.outer.trajectory, true);
    assertEquals(scope.afterInner.trajectory, true);
    assertEquals(scope.sibling.trajectory, false);
    await page.evaluate(() =>
      globalThis.__trajectory.loads[4].reject(new Error("inner rejected"))
    );
    await status("error");
    await expectPositions(1);
    await update({ src: "nested-retry.xtc" });
    await waitLoad(6);
    await resolveLoad(5);
    await status("solved");
    await expectPositions(0);
    await update({ mode: "none" });
    await settle();

    // The player reads frame 1; a separate controlled read of frame 0 fails,
    // is cancelled on replacement, and cannot publish a late reference.
    await clear();
    await update({ mode: "superpose-read", badFrames: false });
    await page.waitForFunction(() =>
      globalThis.__trajectory.references.length === 1
    );
    await status("pending");
    await expectPositions(1);
    await page.evaluate(() =>
      globalThis.__trajectory.references[0].reject(
        new Error("reference rejected"),
      )
    );
    await status("error");
    assertEquals(
      await page.evaluate(() =>
        globalThis.__trajectory.superpose.statuses.at(-1).phase
      ),
      "reference",
    );
    await expectPositions(1);
    await clear();
    await update({ badFrames: true });
    await page.waitForFunction(() =>
      globalThis.__trajectory.references.length === 2
    );
    await status("pending");
    await update({ badFrames: false });
    await page.waitForFunction(() =>
      globalThis.__trajectory.references.length === 3
    );
    assert(
      await page.evaluate(() =>
        globalThis.__trajectory.references[1].signal.aborted
      ),
    );
    await page.evaluate(() => globalThis.__trajectory.references[1].resolve());
    await settle();
    assertEquals(
      await page.evaluate(() =>
        globalThis.__trajectory.superpose.statuses.at(-1).status
      ),
      "pending",
    );
    await page.evaluate(() => globalThis.__trajectory.references[2].resolve());
    await status("solved");
    await update({ badFrames: true });
    await page.waitForFunction(() =>
      globalThis.__trajectory.references.length === 4
    );
    await update({ mode: "none" });
    await settle();
    assert(
      await page.evaluate(() =>
        globalThis.__trajectory.references[3].signal.aborted
      ),
    );
    const length = await page.evaluate(() =>
      globalThis.__trajectory.superpose.statuses.length
    );
    await page.evaluate(() =>
      globalThis.__trajectory.references[3].reject(new Error("late rejection"))
    );
    await settle();
    assertEquals(
      await page.evaluate(() =>
        globalThis.__trajectory.superpose.statuses.length
      ),
      length,
    );
    assertEquals([
      ...errors,
      ...await page.evaluate(() => globalThis.__trajectory.errors),
    ], []);

    // Without a status callback the reference error is logged once, allowing
    // the viewer to continue. Missing ancestors remain composition errors.
    await update({ mode: "superpose-read", reportStatus: false });
    await page.waitForFunction(() =>
      globalThis.__trajectory.references.length === 5
    );
    await page.evaluate(() =>
      globalThis.__trajectory.references[4].reject(
        new Error("logged reference"),
      )
    );
    await page.waitForFunction(() =>
      globalThis.__trajectory.references[4].signal.aborted === false
    );
    await settle();
    assertEquals(errors.length, 1);
    assertMatch(errors[0], /<Superpose>: the trajectory's first frame failed/);
    await update({ supTranslate: false });
    await settle();
    assertEquals(errors.length, 1, "same failure logged only once");
    await update({ mode: "none" });
    await settle();
    const rejection = page.waitForEvent("pageerror");
    await update({ mode: "scope-superpose" });
    assertMatch(String(await rejection), /needs a <Trajectory> ancestor/);

    const invalidPage = await browser.newPage();
    await invalidPage.goto(
      "http://127.0.0.1:5199/packages/viewer/test/trajectory/",
    );
    await invalidPage.waitForFunction(() => globalThis.__trajectory?.mounted);
    await invalidPage.evaluate(() =>
      globalThis.__trajectory.update({ mode: "superpose-read" })
    );
    await invalidPage.waitForFunction(() =>
      globalThis.__trajectory.references.length === 1
    );
    const invalid = invalidPage.waitForEvent("pageerror");
    await invalidPage.evaluate(() =>
      globalThis.__trajectory.references[0].resolve(true)
    );
    assertMatch(String(await invalid), /collinear/);
  } finally {
    await browser?.close();
    await server.close();
  }
});
