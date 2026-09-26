import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

Deno.test("site landing page and maintained gallery routes", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const server = await createServer({
    root,
    configFile: `${root}vite.config.mjs`,
    server: { host: "127.0.0.1", port: 5190, strictPort: true },
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
      viewport: { width: 960, height: 720 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto("http://127.0.0.1:5190/");
    await page.waitForSelector("#hero-title");
    assert.match(
      await page.locator("#hero-title").textContent(),
      /composable toolkit/i,
    );
    assert.equal(
      await page.locator(".package-grid a").count(),
      7,
      "every public package is presented",
    );

    for (
      const [id, title, fixture] of [
        ["scene", "Composed scene", "1crn"],
        ["select", "Selections + fields", "1crn"],
        ["lighting", "World-fixed lighting", "1crn"],
        ["timeline", "Controlled timeline", "1crn"],
        ["bonds", "Bond topology", "1crn"],
        ["coordinates", "Coordinate stream", "1crn"],
        ["trajectory", "Trajectory playback", "1crn"],
        ["tube", "Backbone tube", "1crn"],
        ["ribbon", "Secondary-structure ribbon", "1crn"],
        ["surface", "Solvent-excluded surface", "1crn"],
        ["materials", "Materials", "1crn"],
        ["figure", "Feature composition", "1crn"],
      ]
    ) {
      await page.goto(`http://127.0.0.1:5190/#demos/${id}`);
      await page.waitForSelector(`#molecule-canvas[data-demo="${id}"]`);
      assert.equal(
        (await page.locator("#demo-title").textContent())?.trim(),
        title,
      );
      assert.equal(
        await page.locator("#molecule-canvas").getAttribute("data-fixture"),
        fixture,
      );
      assert.match(
        await page.locator(`[data-demo-assertion="${id}"]`).textContent(),
        /Behavior:/,
      );
      assert.equal(
        await page.locator("[data-webgpu-error]").count(),
        1,
        "each route keeps a visible fallback",
      );
      await page.waitForTimeout(250);
      assert.doesNotMatch(
        await page.locator("[data-webgpu-error]").textContent(),
        /unavailable|unable|error/i,
      );
      await page.locator("#molecule-canvas").hover();
      await page.mouse.down();
      await page.mouse.move(600, 420, { steps: 4 });
      await page.mouse.up();
      assert.equal(
        await page.locator("#molecule-canvas").getAttribute("data-orbit"),
        "dragging",
        "dragging updates the shared orbit controller",
      );
      await page.mouse.wheel(0, 120);
      assert.equal(
        await page.locator("#molecule-canvas").getAttribute("data-orbit"),
        "zooming",
        "wheel input updates the shared orbit controller",
      );
      let focusY;
      if (id === "coordinates") {
        await page.getByLabel("Timeline time in seconds").fill("0");
        await page.waitForFunction(() =>
          document.querySelector("#molecule-canvas")?.dataset.focusY !==
            undefined
        );
        await page.waitForTimeout(500);
        focusY = Number(
          await page.locator("#molecule-canvas").getAttribute("data-focus-y"),
        );
      }
      if (id === "trajectory") {
        // Scrubbing seeks: frames stream in and the displayed frame follows
        // the looping 15 fps curve (2 s → frame 30, 3.5 s → frame 52.5).
        for (const [seconds, frame] of [[2, 30], [3.5, 52.5], [0.5, 7.5]]) {
          await page.getByLabel("Timeline time in seconds").fill(
            String(seconds),
          );
          await page.waitForFunction(
            (want) =>
              Math.abs(
                Number(
                  document.querySelector("#molecule-canvas")?.dataset.frame,
                ) - want,
              ) < 1e-3,
            frame,
            { timeout: 15000 },
          );
        }
      }
      if (id === "timeline" || id === "coordinates" || id === "trajectory") {
        await page.getByLabel("Timeline time in seconds").fill("2");
        assert.match(
          await page.locator(".timeline-control output").textContent(),
          /2\.00 s/,
        );
      }
      if (id === "coordinates") {
        await page.waitForFunction((previous) => {
          const value = Number(
            document.querySelector("#molecule-canvas")?.dataset.focusY,
          );
          return Number.isFinite(value) && Math.abs(value - previous) > 0.01;
        }, focusY);
      }
      if (id === "surface") {
        await page.getByLabel("Surface material").selectOption("pumice");
      }
      if (id === "materials") {
        await page.getByLabel("Material model").selectOption("normal");
      }
    }
    assert.deepEqual(errors, [], "page has no JavaScript errors");
  } finally {
    await browser?.close();
    await server.close();
  }
});
