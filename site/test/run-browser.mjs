import {
  assert,
  assertEquals,
  assertMatch,
  assertStrictEquals,
} from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "../../packages/viewer/test/webgpu-browser-args.mjs";
import { demos } from "../src/demos/registry.ts";

// Wait for rendered molecular output, not a frame count or page compositor
// screenshot. Software-GPU shader compilation can outlast several animation
// frames; a blank canvas must keep waiting and eventually fail the same budget.
const waitForVisibleCanvas = async (page) => {
  const canvas = page.locator("#molecule-canvas canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert(box && box.width > 0 && box.height > 0, "the demo canvas has a size");
  const rendered = await page.waitForFunction(
    async () => {
      const canvas = document.querySelector("#molecule-canvas canvas");
      if (!canvas) return false;
      const png = canvas.toDataURL("image/png");
      if (!png.startsWith("data:image/png;base64,")) return false;
      const bytes = Uint8Array.from(
        atob(png.slice("data:image/png;base64,".length)),
        (c) => c.charCodeAt(0),
      );
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      try {
        const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = snapshot.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(
          0,
          0,
          bitmap.width,
          bitmap.height,
        );
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] > 120) return true;
        }
        return false;
      } finally {
        bitmap.close();
      }
    },
    null,
    { timeout: 30000, polling: 100 },
  );
  await rendered.dispose();
};

// Classify the canvas's lit pixels by Mol*'s secondary-structure palette:
// magenta helix, yellow strand and white coil. Brightness spread within the
// helix pixels shows the cartoon is shaded rather than a flat silhouette.
const cartoonPixels = (page) =>
  page.evaluate(async () => {
    const canvas = document.querySelector("#molecule-canvas canvas");
    const png = canvas.toDataURL("image/png");
    const bytes = Uint8Array.from(
      atob(png.slice("data:image/png;base64,".length)),
      (c) => c.charCodeAt(0),
    );
    const bitmap = await createImageBitmap(
      new Blob([bytes], { type: "image/png" }),
    );
    const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = snapshot.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    const counts = {
      area: data.length / 4,
      lit: 0,
      helix: 0,
      sheet: 0,
      coil: 0,
    };
    const helixRed = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r + g + b <= 120) continue;
      counts.lit++;
      if (r > 80 && r > 1.6 * g && b > 1.3 * g) {
        counts.helix++;
        helixRed.push(r);
      } else if (r > 80 && r > 1.6 * b && g > 1.4 * b) counts.sheet++;
      else if (r > 80 && Math.abs(r - g) < 20 && Math.abs(g - b) < 25) {
        counts.coil++;
      }
    }
    // An unlit helix is one flat colour apart from its antialiased edges.
    const brightest = Math.max(0, ...helixRed);
    const shaded = helixRed.filter((r) => r < brightest * 0.8).length;
    return { ...counts, helixShaded: shaded / Math.max(1, counts.helix) };
  });

// The site viewer publishes `data-webgpu` (pending | ready | error) on the
// host. Ready is set inside AutoCanvas, so the canvas element then exists.
const dataIs0 = (page, key, value) =>
  page.waitForFunction(
    ([k, v]) => document.querySelector("#molecule-canvas")?.dataset[k] === v,
    [key, value],
    { timeout: 30000 },
  );

const waitForWebGpu = async (page) => {
  const host = page.locator("#molecule-canvas");
  const settled = await page.waitForFunction(
    () => {
      const state = document.querySelector("#molecule-canvas")?.dataset
        .webgpu;
      return state === "ready" || state === "error" ? state : false;
    },
    null,
    { timeout: 30000, polling: 50 },
  ).catch(async (failure) => {
    throw new Error(
      `WebGPU device not ready after 30 s (state ${await host.getAttribute(
        "data-webgpu",
      )})`,
      { cause: failure },
    );
  });
  const state = await settled.jsonValue();
  await settled.dispose();
  if (state === "error") {
    throw new Error(
      `WebGPU failed: ${await page.locator("[data-webgpu-error]")
        .textContent()}`,
    );
  }
  return { ms: Number(await host.getAttribute("data-webgpu-ms")) };
};

Deno.test("site landing page and maintained gallery routes", async () => {
  const root = fromFileUrl(new URL("../", import.meta.url));
  const server = await createServer({
    root,
    configFile: `${root}vite.config.mjs`,
    server: { host: "127.0.0.1", port: 5190, strictPort: true },
  });
  let browser;
  // The route under test, so a failure names the demo that caused it.
  let route = "landing";
  try {
    await server.listen();
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: webgpuBrowserArgs,
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

    // Local data for examples and bundler-free pages is served from /data/
    // and its structure files stay byte-identical to the io fixtures.
    const manifest =
      await (await fetch("http://127.0.0.1:5190/data/manifest.json"))
        .json();
    for (const { file, kind } of manifest.files) {
      const served = await fetch(`http://127.0.0.1:5190/data/${file}`);
      assert(served.ok, `${file} is served`);
      const bytes = new Uint8Array(await served.arrayBuffer());
      assert(bytes.length > 0, `${file} is not empty`);
      if (kind === "structure" || file.endsWith(".pqr")) {
        const fixture = await Deno.readFile(
          fromFileUrl(
            new URL(`../../packages/io/test/fixtures/${file}`, import.meta.url),
          ),
        );
        assertEquals(bytes, fixture, `${file} matches its io fixture`);
      }
    }

    /** WebGPU device acquisition per demo route, in ms (flake evidence). */
    const deviceMs = {};
    for (const { id, title, fixture } of demos) {
      route = `#demos/${id}`;
      await page.goto(`http://127.0.0.1:5190/#demos/${id}`);
      await page.waitForSelector(`#molecule-canvas[data-demo="${id}"]`);
      assertStrictEquals(
        (await page.locator("#demo-title").textContent())?.trim(),
        title,
      );
      const host = page.locator("#molecule-canvas");
      assertStrictEquals(await host.getAttribute("data-fixture"), fixture);
      assert(Number(await host.getAttribute("data-atom-count")) > 0);
      assert(Number(await host.getAttribute("data-residue-count")) > 0);
      assertStrictEquals(
        await page.locator("[data-webgpu-error]").count(),
        1,
        "each route keeps a status region for WebGPU errors",
      );
      // Each demo mounts a fresh WebGPU root; wait for its device (or its
      // reported failure) instead of a timer, and keep the timing as evidence.
      const gpu = await waitForWebGpu(page);
      deviceMs[id] = gpu.ms;
      assertStrictEquals(
        await page.locator("[data-webgpu-error]").textContent(),
        "",
        "successful mounting clears the loading status",
      );
      await waitForVisibleCanvas(page);
      await host.hover();
      await page.mouse.down();
      await page.mouse.move(600, 420, { steps: 4 });
      await page.mouse.up();
      assertStrictEquals(
        await host.getAttribute("data-orbit"),
        "dragging",
        "dragging updates the shared orbit controller",
      );
      await page.mouse.wheel(0, 120);
      assertStrictEquals(
        await host.getAttribute("data-orbit"),
        "zooming",
        "wheel input updates the shared orbit controller",
      );
      const dataIs = (key, value) =>
        page.waitForFunction(
          ([k, v]) =>
            document.querySelector("#molecule-canvas")?.dataset[k] === v,
          [key, value],
          { timeout: 30000 },
        );
      const scrubTo = (seconds) =>
        page.getByLabel("Timeline time in seconds").fill(String(seconds));
      if (id === "compose") {
        assertStrictEquals(
          await host.getAttribute("data-layers"),
          "cartoon,sulfur",
        );
        assert(
          Number(await host.getAttribute("data-bond-count")) > 0,
          "the imported structure yields a bond topology for sticks",
        );
        assert(
          Number(await host.getAttribute("data-sulfur-count")) > 0,
          "the sulfur layer's selection contains atoms",
        );
        // Cartoon + sulfur only: the Mol* secondary-structure palette shows.
        const pixels = await cartoonPixels(page);
        console.log("cartoon pixels", JSON.stringify(pixels));
        assert(
          pixels.lit > pixels.area * 0.01,
          `the cartoon covers the frame: ${JSON.stringify(pixels)}`,
        );
        for (const kind of ["helix", "sheet", "coil"]) {
          assert(
            pixels[kind] > pixels.lit * 0.05,
            `${kind} is visible in its secondary-structure colour: ${
              JSON.stringify(pixels)
            }`,
          );
        }
        assert(
          pixels.helixShaded > 0.15,
          `helix faces are shaded, not flat: ${JSON.stringify(pixels)}`,
        );
        await page.getByLabel("Ball and stick").check();
        await page.getByLabel("Glass surface").check();
        await dataIs("layers", "cartoon,sticks,surface,sulfur");
        await page.getByLabel("Cartoon").uncheck();
        await dataIs("layers", "sticks,surface,sulfur");
      }
      if (id === "select") {
        const before = Number(await host.getAttribute("data-selected-count"));
        assert(
          before > 0,
          "the neighbourhood query resolves real CYS residues",
        );
        await page.getByLabel("Selection query").selectOption("sulfur");
        await page.waitForFunction(
          (count) =>
            Number(
              document.querySelector("#molecule-canvas")?.dataset.selectedCount,
            ) !== count,
          before,
        );
        assert(Number(await host.getAttribute("data-selected-count")) > 0);
        await page.getByLabel("Color field").selectOption("charge");
        assertStrictEquals(
          await host.getAttribute("data-charge-provenance"),
          "imported:pqr",
        );
        // Crambin is neutral; applyPqr's hydrogen folding keeps the total.
        const net = Number(await host.getAttribute("data-net-charge"));
        assert(Math.abs(net) < 1e-3, `net charge ${net}`);
      }
      if (id === "surface") {
        assertStrictEquals(
          await page.getByLabel("Surface style").inputValue(),
          "opaque",
        );
        await page.getByLabel("Surface color field").selectOption("element");
        await page.getByLabel("Material model").selectOption("normal");
        assertStrictEquals(
          await page.getByLabel("Material model").inputValue(),
          "normal",
        );
        assertStrictEquals(
          await host.getAttribute("data-world-light"),
          "false",
        );
        await page.getByLabel("World-fixed light").check();
        await dataIs("worldLight", "true");
        await page.getByLabel("Surface style").selectOption("pumice");
        assertStrictEquals(
          await page.getByLabel("Surface style").inputValue(),
          "pumice",
        );
      }
      if (id === "motion") {
        assertStrictEquals(
          await host.getAttribute("data-motion"),
          "trajectory",
        );
        assertStrictEquals(
          await page.getByLabel("Trajectory representation").inputValue(),
          "tube",
        );
        // Scrubbing seeks: frames stream in and the displayed frame follows
        // the looping 15 fps curve (2 s → frame 30, 3.5 s → frame 52.5).
        for (const [seconds, frame] of [[2, 30], [3.5, 52.5], [0.5, 7.5]]) {
          await scrubTo(seconds);
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
        await page.getByLabel("Trajectory representation").selectOption(
          "ball-and-stick",
        );
        assertStrictEquals(
          await page.getByLabel("Timeline time in seconds").inputValue(),
          "0.5",
          "switching representation preserves trajectory time",
        );

        // Camera move: the scrub also moves the camera toward the cysteines.
        await page.getByLabel("Motion source").selectOption("camera");
        await dataIs("motion", "camera");
        await waitForWebGpu(page);
        const initialRadius = Number(
          await host.getAttribute("data-camera-radius"),
        );
        await scrubTo(2);
        await page.waitForFunction(
          (radius) =>
            Number(
              document.querySelector("#molecule-canvas")?.dataset.cameraRadius,
            ) < radius,
          initialRadius,
        );

        // GPU wobble: the coordinate provider chain mounts and renders.
        await page.getByLabel("Motion source").selectOption("wobble");
        await dataIs("motion", "wobble");
        await waitForWebGpu(page);
        await waitForVisibleCanvas(page);
        await scrubTo(2);
        assertMatch(
          await page.locator(".timeline-control output").first().textContent(),
          /2\.00 s/,
        );

        // Elastic network: the timeline sets the integrator step, a tug
        // perturbs the run and scrubbing back restores a checkpoint.
        await page.getByLabel("Motion source").selectOption("elastic");
        await dataIs("motion", "elastic");
        await waitForWebGpu(page);
        const stepIs = (step) =>
          page.waitForFunction(
            (want) =>
              document.querySelector("#molecule-canvas")?.dataset
                .elasticStep === String(want),
            step,
            { timeout: 20000 },
          );
        await scrubTo(1);
        await stepIs(500);
        const box = await host.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down({ button: "right" });
        await page.mouse.move(
          box.x + box.width / 2 + 60,
          box.y + box.height / 2 - 30,
          { steps: 4 },
        );
        await scrubTo(2);
        await stepIs(1000);
        await page.mouse.up({ button: "right" });
        assertStrictEquals(await host.getAttribute("data-tug"), "released");
        assertStrictEquals(
          await host.getAttribute("data-perturbed"),
          "true",
          "the tug perturbed the run",
        );
        await scrubTo(0.5);
        await stepIs(250);
      }
      if (id === "volume") {
        assertStrictEquals(await host.getAttribute("data-volume"), "density");
        await page.getByLabel("Slice position").fill("0.8");
        assertMatch(
          await page.locator('[data-output="slice"]').textContent(),
          /80%/,
        );
        await page.waitForFunction(() =>
          Number(
            document.querySelector("#molecule-canvas")?.dataset.sliceIndex,
          ) > 0
        );
        await page.getByLabel("Isosurface level in sigma").fill("1");
        assertMatch(
          await page.locator('[data-output="iso"]').textContent(),
          /1\.0 σ/,
        );
        await page.getByLabel("Volume source").selectOption("potential");
        await dataIs("volume", "potential");
        await page.locator("summary", { hasText: "Advanced" }).click();
        await page.getByLabel("Potential grid spacing").selectOption("1.5");
        await page.getByLabel("Field line seed spacing").selectOption("9");
        await page.getByLabel("Field line distance").selectOption("18");
        await page.waitForFunction(() => {
          const data = document.querySelector("#molecule-canvas")?.dataset;
          return data?.gridSpacing === "1.5" && data?.seedSpacing === "9" &&
            data?.lineDistance === "18";
        });
      }
      assertStrictEquals(
        await page.locator("#molecule-canvas canvas").count(),
        1,
        "re-rendering reuses one canvas instead of stacking new ones",
      );
    }

    // Hashes from the former 16-demo gallery land on the new demos with
    // the matching settings.
    for (
      const [old, id, key, value] of [
        ["ribbon", "compose", "layers", "cartoon"],
        ["efield", "volume", "volume", "potential"],
        ["dynamics", "motion", "motion", "elastic"],
        ["charge", "select", "selectedCount", null],
      ]
    ) {
      route = `legacy #demos/${old}`;
      await page.goto("about:blank");
      await page.goto(`http://127.0.0.1:5190/#demos/${old}`);
      await page.waitForSelector(`#molecule-canvas[data-demo="${id}"]`);
      if (value !== null) await dataIs0(page, key, value);
      assertStrictEquals(
        new URL(page.url()).hash,
        `#demos/${id}`,
        "legacy hashes are rewritten to the current id",
      );
    }
    console.log(`WebGPU device ms per demo: ${JSON.stringify(deviceMs)}`);
    route = "overview and back";
    await page.getByRole("link", { name: "Overview" }).click();
    await page.waitForSelector("#molecule-canvas", { state: "detached" });
    assertStrictEquals(
      await page.locator("canvas").count(),
      0,
      "leaving the demo page disposes its canvas root",
    );
    await page.getByRole("link", { name: "Demos" }).click();
    await page.waitForSelector('#molecule-canvas[data-demo="compose"]');
    await page.waitForSelector("#molecule-canvas canvas");
    assertStrictEquals(
      await page.locator("#molecule-canvas canvas").count(),
      1,
      "returning to demos creates one fresh viewer root",
    );
    assertEquals(errors, [], "page has no JavaScript errors");
  } catch (error) {
    throw new Error(`site test failed at ${route}: ${error.message}`, {
      cause: error,
    });
  } finally {
    await browser?.close();
    await server.close();
  }
});
