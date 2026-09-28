import {
  assert,
  assertEquals,
  assertMatch,
  assertStrictEquals,
} from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { demos } from "../src/demos/registry.ts";

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
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

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
    const githubLink = page.getByRole("link", { name: "GitHub", exact: true });
    assertStrictEquals(
      await githubLink.getAttribute("href"),
      "https://github.com/zachcp/molgpu",
    );
    await page.setViewportSize({ width: 320, height: 720 });
    assert(
      await githubLink.isVisible(),
      "the repository link remains visible on a narrow viewport",
    );
    assert(
      await githubLink.evaluate((link) =>
        link.getBoundingClientRect().right <= globalThis.innerWidth
      ),
      "the repository link stays inside the viewport",
    );
    await page.setViewportSize({ width: 960, height: 720 });

    for (const { id, title, fixture } of demos) {
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
      const host = page.locator("#molecule-canvas");
      assert(Number(await host.getAttribute("data-atom-count")) > 0);
      assert(Number(await host.getAttribute("data-residue-count")) > 0);
      if (id === "select") {
        assert(
          Number(await host.getAttribute("data-selected-count")) > 0,
          "the neighbourhood query resolves real CYS residues",
        );
      }
      if (id === "lighting") {
        assertStrictEquals(await host.getAttribute("data-world-light"), "true");
      }
      if (id === "bonds") {
        assert(
          Number(await host.getAttribute("data-bond-count")) > 0,
          "the imported structure yields a bond topology",
        );
      }
      if (id === "tube" || id === "ribbon") {
        assert(
          Number(await host.getAttribute("data-trace-count")) > 0,
          "the representation uses a polymer trace from the imported structure",
        );
      }
      if (id === "figure") {
        assert(
          Number(await host.getAttribute("data-sulfur-count")) > 0,
          "the figure's sulfur selection contains atoms",
        );
      }
      assertStrictEquals(
        await page.locator("[data-webgpu-error]").count(),
        1,
        "each route keeps a status region for WebGPU errors",
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
        assertStrictEquals(
          await page.getByLabel("Trajectory representation").inputValue(),
          "tube",
        );
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
        await frames(page);
        const tubeFrame = await page.locator("#molecule-canvas canvas")
          .screenshot();
        await page.getByLabel("Trajectory representation").selectOption(
          "ball-and-stick",
        );
        await frames(page);
        const ballAndStickFrame = await page.locator("#molecule-canvas canvas")
          .screenshot();
        assert(
          !tubeFrame.equals(ballAndStickFrame),
          "trajectory representation changes the rendered geometry",
        );
        assertStrictEquals(
          await page.getByLabel("Timeline time in seconds").inputValue(),
          "0.5",
          "switching representation preserves trajectory time",
        );
      }
      if (id === "timeline" || id === "coordinates" || id === "trajectory") {
        const initialRadius = id === "timeline"
          ? Number(await host.getAttribute("data-camera-radius"))
          : null;
        await page.getByLabel("Timeline time in seconds").fill("2");
        assertMatch(
          await page.locator(".timeline-control output").textContent(),
          /2\.00 s/,
        );
        if (initialRadius !== null) {
          await page.waitForFunction((radius) =>
            Number(
              document.querySelector("#molecule-canvas")?.dataset.cameraRadius,
            ) < radius, initialRadius);
          assert(
            Number(await host.getAttribute("data-camera-radius")) <
              initialRadius,
            "timeline scrub also moves the camera",
          );
        }
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
        assertStrictEquals(
          await page.getByLabel("Surface material").inputValue(),
          "opaque",
        );
        await page.getByLabel("Surface color field").selectOption("element");
        assertStrictEquals(
          await page.getByLabel("Surface color field").inputValue(),
          "element",
        );
        await page.getByLabel("Surface material").selectOption("pumice");
        assertStrictEquals(
          await page.getByLabel("Surface material").inputValue(),
          "pumice",
        );
      }
      if (id === "select") {
        const before = Number(await host.getAttribute("data-selected-count"));
        await page.getByLabel("Selection query").selectOption("sulfur");
        await page.waitForFunction(
          (count) =>
            Number(
              document.querySelector("#molecule-canvas")?.dataset.selectedCount,
            ) !== count,
          before,
        );
        assert(Number(await host.getAttribute("data-selected-count")) > 0);
      }
      if (id === "efield") {
        await page.getByLabel("Potential grid spacing").selectOption("1.5");
        await page.getByLabel("Field line seed spacing").selectOption("9");
        await page.getByLabel("Field line distance").selectOption("18");
        await page.waitForFunction(() => {
          const data = document.querySelector("#molecule-canvas")?.dataset;
          return data?.gridSpacing === "1.5" && data?.seedSpacing === "9" &&
            data?.lineDistance === "18";
        });
      }
      if (id === "materials") {
        const before = await page.locator("#molecule-canvas canvas")
          .screenshot();
        await page.getByLabel("Material model").selectOption("normal");
        await frames(page);
        const changed = await page.locator("#molecule-canvas canvas")
          .screenshot();
        assert(
          !before.equals(changed),
          "material model changes the scene shading",
        );
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
