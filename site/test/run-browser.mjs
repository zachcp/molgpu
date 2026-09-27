import {
  assert,
  assertEquals,
  assertMatch,
  assertStrictEquals,
} from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";

const frames = (page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
  });

const litPixels = (page, png) =>
  page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 120) count++;
    }
    return count;
  }, png.toString("base64"));

/** A canvas frame equal to its successor, with something drawn on it. */
const settledFrame = async (page) => {
  const shot = () => page.locator("#molecule-canvas canvas").screenshot();
  await frames(page);
  let previous = await shot();
  for (let attempt = 0; attempt < 30; attempt++) {
    await frames(page);
    const current = await shot();
    if (current.equals(previous) && (await litPixels(page, current)) > 0) {
      return current;
    }
    previous = current;
  }
  throw new Error("volume demo frame never settled");
};

Deno.test("site landing page and maintained gallery routes", async () => {
  const root = fromFileUrl(new URL("../", import.meta.url));
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
    assertMatch(
      await page.locator("#hero-title").textContent(),
      /composable toolkit/i,
    );
    assertEquals(
      (await page.locator(".package-grid a code").allTextContents()).map(
        (name) => name.trim(),
      ),
      [
        "@molgpu/table",
        "@molgpu/select",
        "@molgpu/fields",
        "@molgpu/io",
        "@molgpu/geo",
        "@molgpu/timeline",
        "@molgpu/dynamics",
        "@molgpu/viewer",
      ],
      "every public package has a card in dependency order",
    );
    for (const link of await page.locator(".package-grid a").all()) {
      assertMatch(
        await link.getAttribute("href"),
        /^https:\/\/github\.com\/zachcp\/molgpu\/blob\/main\/packages\/[\w-]+\/README\.md$/,
        "package documentation links work from deployed pages",
      );
    }
    assertMatch(
      await page.getByRole("link", { name: "API", exact: true })
        .getAttribute("href"),
      /^https:\/\/github\.com\/zachcp\/molgpu\/blob\/main\/packages\/viewer\/README\.md$/,
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
        ["volume", "Density volume", "1crn"],
        ["charge", "Partial charge", "1crn"],
        ["efield", "Electrostatic potential", "1crn"],
        ["figure", "Feature composition", "1crn"],
      ]
    ) {
      await page.goto(`http://127.0.0.1:5190/#demos/${id}`);
      await page.waitForSelector(`#molecule-canvas[data-demo="${id}"]`);
      assertStrictEquals(
        (await page.locator("#demo-title").textContent())?.trim(),
        title,
      );
      assertStrictEquals(
        await page.locator("#molecule-canvas").getAttribute("data-fixture"),
        fixture,
      );
      assertMatch(
        await page.locator(`[data-demo-assertion="${id}"]`).textContent(),
        /Behavior:/,
      );
      assertStrictEquals(
        await page.locator("[data-webgpu-error]").count(),
        1,
        "each route keeps a visible fallback",
      );
      await page.waitForTimeout(250);
      assertStrictEquals(
        await page.locator("[data-webgpu-error]").textContent(),
        "",
        "successful mounting clears the loading status",
      );
      await frames(page);
      const initialFrame = await page.locator("#molecule-canvas canvas")
        .screenshot();
      assert(
        await litPixels(page, initialFrame) > 0,
        `${id} produces visible WebGPU output`,
      );
      await page.locator("#molecule-canvas").hover();
      await page.mouse.down();
      await page.mouse.move(600, 420, { steps: 4 });
      await page.mouse.up();
      assertStrictEquals(
        await page.locator("#molecule-canvas").getAttribute("data-orbit"),
        "dragging",
        "dragging updates the shared orbit controller",
      );
      await page.mouse.wheel(0, 120);
      assertStrictEquals(
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
        assertMatch(
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
      assertStrictEquals(
        await page.locator("#molecule-canvas canvas").count(),
        1,
        "re-rendering reuses one canvas instead of stacking new ones",
      );
      if (id === "charge") {
        assertStrictEquals(
          await page.locator("#molecule-canvas").getAttribute(
            "data-charge-provenance",
          ),
          "imported:pqr",
        );
        // Crambin is neutral; applyPqr's hydrogen folding keeps the total.
        const net = Number(
          await page.locator("#molecule-canvas").getAttribute(
            "data-net-charge",
          ),
        );
        assert(Math.abs(net) < 1e-3, `net charge ${net}`);
      }
      if (id === "volume") {
        const before = await settledFrame(page);
        await page.getByLabel("Slice position").fill("0.8");
        assertMatch(
          await page.locator('[data-output="slice"]').textContent(),
          /80%/,
        );
        await page.waitForFunction(() =>
          Number(
            document.querySelector("#molecule-canvas")?.dataset.sliceIndex,
          ) >
            0
        );
        const after = await settledFrame(page);
        assert(
          !before.equals(after),
          "moving the slice plane changes the rendered WebGPU frame",
        );
        await page.getByLabel("Isosurface level in sigma").fill("1");
        assertMatch(
          await page.locator('[data-output="iso"]').textContent(),
          /1\.0 σ/,
        );
      }
    }
    await page.getByRole("link", { name: "Overview" }).click();
    await page.waitForSelector("#molecule-canvas", { state: "detached" });
    assertStrictEquals(
      await page.locator("canvas").count(),
      0,
      "leaving the demo page disposes its canvas root",
    );
    await page.getByRole("link", { name: "Demos" }).click();
    await page.waitForSelector('#molecule-canvas[data-demo="scene"]');
    assertStrictEquals(
      await page.locator("#molecule-canvas canvas").count(),
      1,
      "returning to demos creates one fresh viewer root",
    );
    assertEquals(errors, [], "page has no JavaScript errors");
  } finally {
    await browser?.close();
    await server.close();
  }
});
