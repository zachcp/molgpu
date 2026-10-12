import { assert, assertEquals } from "@std/assert";
import {
  captureErrors,
  launchWebGpuBrowser,
} from "../../../packages/viewer/test/harness.mjs";

import { startSketch } from "./serve.mjs";

Deno.test("residue distribution planning sketch", async () => {
  const server = await startSketch();
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 1100 },
    });
    const errors = captureErrors(page);
    await page.goto(
      "http://127.0.0.1:5287/test/spikes/residue-distributions/index.html",
    );
    await page.waitForFunction(() =>
      globalThis.__distribution?.geometryBuilds > 0 &&
      globalThis.__distribution.positionUploadBytes > 0
    );
    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
        await globalThis.__distribution.fence?.();
      });
    await settle();
    await settle();
    const before = await page.evaluate(() => ({
      ...globalThis.__distribution,
    }));
    const original = await page.locator("canvas").screenshot();
    await page.locator('button[data-row="3"][data-category="E"]').click();
    await settle();
    assert((await page.locator("#detail").innerText()).includes("A:3A"));
    assertEquals(
      await page.evaluate(() => globalThis.__distribution.selected),
      3,
    );
    assert(
      !(await page.locator("canvas").screenshot()).equals(original),
      "linked selection changes backbone colors",
    );
    await page.locator('button[data-row="4"][data-category="F"]').click();
    assert((await page.locator("#detail").innerText()).includes("missing"));
    await page.selectOption("#chain", "B");
    assertEquals(await page.locator("#matrix tr").count(), 4);
    await page.selectOption("#chain", "all");
    await page.selectOption("#window", "1");
    assertEquals(await page.locator("#matrix tr").count(), 8);
    const after = await page.evaluate(() => ({ ...globalThis.__distribution }));
    assertEquals(
      after.positionUploadBytes,
      before.positionUploadBytes,
      "inspection/filters upload no coordinates",
    );
    assertEquals(
      after.geometryBuilds,
      before.geometryBuilds,
      "inspection/filters rebuild no backbone geometry",
    );
    await page.selectOption("#window", "all");
    await page.locator('button[data-row="1"][data-category="C"]').focus();
    await page.keyboard.press("Enter");
    assertEquals(
      await page.evaluate(() => globalThis.__distribution.selected),
      1,
    );
    await page.screenshot({
      path: "/private/tmp/molgpu-r50-sketch.png",
      fullPage: true,
    });
    await page.click("#unmount");
    await settle();
    assertEquals(
      await page.evaluate(() => globalThis.__distribution.errors),
      [],
    );
    assertEquals(errors, []);
    console.log(JSON.stringify({
      browser: browser.version(),
      status: "passed",
      rows: 13,
      windows: 3,
      styleGeometryDelta: after.geometryBuilds -
        before.geometryBuilds,
      positionWriteDelta: after.positionUploadBytes -
        before.positionUploadBytes,
    }));
  } finally {
    await browser?.close();
    await server.close();
  }
});
