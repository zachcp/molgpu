import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertMatch,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "../../packages/viewer/test/webgpu-browser-args.mjs";
import { demos } from "../src/demos/registry.ts";
import { dihedralAngle } from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";

// The membrane example, read independently of the page.
const bacteriorhodopsin = await structureFromBcif(
  await Deno.readFile(
    new URL("../../packages/io/test/fixtures/1c3w.bcif", import.meta.url),
  ),
);

// The viewer's dev counters, imported in the page through Vite's /@fs route.
const instrumentationPath = fromFileUrl(
  new URL(
    "../../packages/viewer/src/internal/instrumentation.ts",
    import.meta.url,
  ),
);

// The structure the site loads, for recomputing measurements independently.
const crambin = await structureFromBcif(
  await Deno.readFile(
    new URL("../../packages/io/test/fixtures/1crn.bcif", import.meta.url),
  ),
);

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

    // Observe actual FaceLayer draws, not generic canvas/device readiness.
    // Surface is the only face primitive on this route. Delay its first
    // pipeline deliberately to exercise the atoms-before-surface race.
    await page.addInitScript(() => {
      if (!globalThis.GPUDevice) return;
      const modules = new WeakSet();
      const pipelines = new WeakSet();
      const passes = new WeakSet();
      globalThis.__surfaceDraws = 0;
      const request = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function (...args) {
        const device = await request.apply(this, args);
        globalThis.__surfaceDrain = () => device.queue.onSubmittedWorkDone();
        return device;
      };
      const shader = GPUDevice.prototype.createShaderModule;
      GPUDevice.prototype.createShaderModule = function (descriptor) {
        const module = shader.call(this, descriptor);
        if (descriptor.code.includes("getFaceVertex")) modules.add(module);
        return module;
      };
      const pipeline = GPUDevice.prototype.createRenderPipelineAsync;
      GPUDevice.prototype.createRenderPipelineAsync = async function (
        descriptor,
      ) {
        const face = modules.has(descriptor.vertex.module);
        const result = await pipeline.call(this, descriptor);
        if (face) {
          if (location.hash === "#demos/surface") {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          pipelines.add(result);
        }
        return result;
      };
      const setPipeline = GPURenderPassEncoder.prototype.setPipeline;
      GPURenderPassEncoder.prototype.setPipeline = function (pipeline) {
        if (pipelines.has(pipeline)) passes.add(this);
        else passes.delete(this);
        return setPipeline.call(this, pipeline);
      };
      const draw = GPURenderPassEncoder.prototype.draw;
      GPURenderPassEncoder.prototype.draw = function (...args) {
        if (passes.has(this) && args[0] > 0 && args[1] > 0) {
          globalThis.__surfaceDraws++;
        }
        return draw.apply(this, args);
      };
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
      if (
        Deno.env.get("MOLGPU_SITE_DEMO") &&
        Deno.env.get("MOLGPU_SITE_DEMO") !== id
      ) continue;
      route = `#demos/${id}`;
      await page.goto(`http://127.0.0.1:5190/#demos/${id}`);
      await page.waitForSelector(`#molecule-canvas[data-demo="${id}"]`);
      assertStrictEquals(
        (await page.locator("#demo-title").textContent())?.trim(),
        title,
      );
      // The panel shows the example file that runs (0z3.2), not a copy.
      const source = await page.locator(`[data-demo-source="${id}"] pre`)
        .textContent();
      assertStringIncludes(source ?? "", `export const ${id}Scene`);
      assertStringIncludes(source ?? "", "@molgpu/viewer");
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
      if (id === demos[0].id) {
        // Save PNG downloads the presented frame at canvas pixel size.
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.getByRole("button", { name: "Save PNG" }).click(),
        ]);
        assertStrictEquals(download.suggestedFilename(), `molgpu-${id}.png`);
        await page.waitForSelector('#molecule-canvas[data-capture="done"]');
        const size = await page.evaluate(() => {
          const canvas = document.querySelector("#molecule-canvas canvas");
          return `${canvas.width}x${canvas.height}`;
        });
        assertStrictEquals(await host.getAttribute("data-capture-size"), size);
        const png = await Deno.readFile(await download.path());
        assertEquals(
          [...png.subarray(0, 8)],
          [137, 80, 78, 71, 13, 10, 26, 10],
          "the download is a PNG",
        );
        const lit = await page.evaluate(async (bytes) => {
          const bitmap = await createImageBitmap(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          );
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = canvas.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const { data } = context.getImageData(
            0,
            0,
            bitmap.width,
            bitmap.height,
          );
          bitmap.close();
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] + data[i + 1] + data[i + 2] > 120) count++;
          }
          return count;
        }, [...png]);
        assert(lit > 0, "the saved PNG contains the rendered molecule");
      }
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
        // Compose starts with the backbone tube alone.
        assertStrictEquals(await host.getAttribute("data-layers"), "tube");
        await page.getByLabel("Tube", { exact: true }).uncheck();
        await page.getByLabel("Cartoon").check();
        await page.getByLabel("Sulfur atoms").check();
        await dataIs("layers", "cartoon,sulfur");
        await waitForVisibleCanvas(page);
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

        // The layer list stays in its column: with wide fonts it once ran
        // under the canvas, which then intercepted the checkbox clicks.
        const fieldset = await page.locator("fieldset.timeline-control")
          .boundingBox();
        const canvasBox = await page.locator("#molecule-canvas").boundingBox();
        assert(
          fieldset.x + fieldset.width <= canvasBox.x + 1 ||
            fieldset.y + fieldset.height <= canvasBox.y + 1,
          `layer controls overlap the canvas: ${
            JSON.stringify([fieldset, canvasBox])
          }`,
        );
        // Measure alone: click lit pixels (atoms or bonds) until four atoms
        // are picked; each reported value matches the 1CRN coordinates.
        for (
          const label of ["Ball and stick", "Glass surface", "Sulfur atoms"]
        ) {
          await page.getByLabel(label).uncheck();
        }
        await page.getByLabel("Measure (click atoms)").check();
        await dataIs("layers", "measure");
        await waitForVisibleCanvas(page);
        const targets = await page.evaluate(async () => {
          const canvas = document.querySelector("#molecule-canvas canvas");
          const bitmap = await createImageBitmap(
            await new Promise((resolve) => canvas.toBlob(resolve)),
          );
          const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = snapshot.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const { data } = context.getImageData(
            0,
            0,
            bitmap.width,
            bitmap.height,
          );
          const rect = canvas.getBoundingClientRect();
          const points = [];
          for (let y = 0; y < bitmap.height; y += 9) {
            for (let x = 0; x < bitmap.width; x += 9) {
              const i = 4 * (y * bitmap.width + x);
              if (data[i] + data[i + 1] + data[i + 2] > 300) {
                points.push([
                  rect.left + x * rect.width / bitmap.width,
                  rect.top + y * rect.height / bitmap.height,
                ]);
              }
            }
          }
          bitmap.close();
          return points;
        });
        assert(targets.length > 20, "atoms are drawn for picking");
        const rows = () =>
          page.evaluate(() =>
            document.querySelector("#molecule-canvas").dataset.measureRows ?? ""
          );
        const step = Math.max(1, Math.floor(targets.length / 97));
        const seen = [];
        for (let k = 0; k < targets.length && seen.length < 4; k += step) {
          const before = await rows();
          await page.mouse.click(targets[k][0], targets[k][1]);
          for (let t = 0; t < 10 && (await rows()) === before; t++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          const now = (await rows()).split(",").filter(Boolean).map(Number);
          if (now.length !== seen.length) {
            seen.splice(0, seen.length, ...now);
            const kind = await host.getAttribute("data-measure-kind");
            const value = Number(await host.getAttribute("data-measure-value"));
            const P = crambin.positions;
            const at = (row) => [0, 1, 2].map((c) => P[3 * row + c]);
            if (seen.length === 2) {
              const [a, b] = seen.map(at);
              assertStrictEquals(kind, "distance");
              assertAlmostEquals(
                value,
                Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
                1e-4,
              );
            }
            if (seen.length === 4) {
              assertStrictEquals(kind, "dihedral");
              assertAlmostEquals(value, dihedralAngle(P, ...seen), 1e-3);
            }
          }
        }
        assertEquals(seen.length, 4, "four clicks landed on atoms");
        assertMatch(
          await page.locator("[data-measure-readout]").innerText(),
          /dihedral: -?\d+\.\d°/,
        );
        await page.getByRole("button", { name: "Clear" }).click();
        await dataIs("measureRows", "");

        // Figure mode: ground plane, SSAO and a shadow-mapped key light. It
        // and orbiting are pass, light and camera changes: no molecular
        // geometry build, gather, allocation or upload.
        await page.getByLabel("Measure (click atoms)").uncheck();
        await page.getByLabel("Cartoon").check();
        await dataIs("layers", "cartoon");
        await waitForVisibleCanvas(page);
        await page.evaluate(async (url) => {
          const counters = await import(url);
          counters.enableInstrumentation();
          counters.resetCounters();
          globalThis.__figureCounters = counters;
        }, `/@fs${instrumentationPath}`);
        await page.getByLabel("Figure mode").check();
        await dataIs("figure", "shadows");
        await waitForVisibleCanvas(page);
        const canvasBounds = await page.locator("#molecule-canvas canvas")
          .boundingBox();
        await page.mouse.move(
          canvasBounds.x + canvasBounds.width / 2,
          canvasBounds.y + canvasBounds.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          canvasBounds.x + canvasBounds.width / 2 + 60,
          canvasBounds.y + canvasBounds.height / 2,
          { steps: 6 },
        );
        await page.mouse.up();
        await dataIs("orbit", "dragging");
        const figureWork = await page.evaluate(() => {
          const counters = globalThis.__figureCounters;
          const s = counters.snapshotCounters();
          counters.disableInstrumentation();
          return {
            geometryBuilds: s.geometryBuilds,
            gathers: s.gathers,
            allocations: s.allocations,
            uploadBytes: s.uploadBytes,
          };
        });
        assertEquals(
          figureWork,
          { geometryBuilds: 0, gathers: 0, allocations: 0, uploadBytes: 0 },
          "figure mode and orbiting rebuild and upload nothing",
        );

        // Shadow probe (molgpu-sept-jcc). A representation casts iff it draws
        // into use.gpu's depth-only shadow-map pass (labelled "<ShadowPass>
        // Atlas #n" in workbench 0.20.0). Wrapping beginRenderPass records
        // the draws in the last such pass; the ground plane is one of them.
        await page.evaluate(() => {
          const begin = GPUCommandEncoder.prototype.beginRenderPass;
          GPUCommandEncoder.prototype.beginRenderPass = function (descriptor) {
            const pass = begin.call(this, descriptor);
            if (!descriptor.label?.startsWith("<ShadowPass>")) return pass;
            let draws = 0;
            for (const name of ["draw", "drawIndexed", "drawIndirect"]) {
              const call = pass[name].bind(pass);
              pass[name] = (...args) => {
                draws++;
                return call(...args);
              };
            }
            const end = pass.end.bind(pass);
            pass.end = () => {
              globalThis.__shadowDraws = draws;
              globalThis.__shadowPasses = (globalThis.__shadowPasses ?? 0) + 1;
              return end();
            };
            return pass;
          };
        });
        const frameHash = () =>
          page.evaluate(async () => {
            const canvas = document.querySelector("#molecule-canvas canvas");
            const bitmap = await createImageBitmap(
              await new Promise((resolve) => canvas.toBlob(resolve)),
            );
            const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = snapshot.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            const { data } = context.getImageData(
              0,
              0,
              bitmap.width,
              bitmap.height,
            );
            bitmap.close();
            let hash = 0;
            for (let i = 0; i < data.length; i += 4) {
              hash = (hash * 31 + data[i] + data[i + 1] + data[i + 2]) | 0;
            }
            return hash;
          });
        // The displayed frame differs from `before` (the new layer drew) and
        // is unchanged across two captures; its shadow pass is the last one.
        const drawnFrame = async (before) => {
          let previous = before;
          for (const start = Date.now(); Date.now() - start < 60000;) {
            const hash = await frameHash();
            if (hash !== before && hash === previous) return hash;
            previous = hash;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          throw new Error("the new layer did not draw within 60 s");
        };
        const shadowProbe = {};
        // Cartoon alone is already showing, so it goes last: every step must
        // change the drawn layer, or no new frame is rendered on demand.
        const probeLayers = [
          ["tube", "Tube"],
          ["sticks", "Ball and stick"],
          ["spacefill", "Spacefill"],
          ["surface", "Glass surface"],
          ["cartoon", "Cartoon"],
        ];
        let frame = await frameHash();
        for (const [layer, label] of probeLayers) {
          for (const [other, otherLabel] of probeLayers) {
            if (other !== layer) await page.getByLabel(otherLabel).uncheck();
          }
          await page.getByLabel(label).check();
          await dataIs("layers", layer);
          frame = await drawnFrame(frame);
          // Draws beyond the ground plane's one are the layer's. A shadow
          // pipeline variant compiles after the colour draw lands, so allow
          // it 10 s (software GPU); a layer that never registers a shadow draw stays at 0.
          const shadowDraws = () =>
            page.evaluate(() => globalThis.__shadowDraws - 1);
          let casts = await shadowDraws();
          for (
            const start = Date.now();
            casts < 1 && Date.now() - start < 10000;
          ) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            casts = await shadowDraws();
          }
          shadowProbe[layer] = casts;
          frame = await frameHash();
        }
        console.log(
          "shadow probe (draws in shadow pass)",
          JSON.stringify(shadowProbe),
        );
        assertEquals(
          shadowProbe,
          { cartoon: 1, tube: 1, sticks: 1, spacefill: 0, surface: 0 },
          "cartoon, opted-in tube and bond sticks cast; atom billboards and transparent surfaces do not",
        );
        await page.getByLabel("Figure mode").uncheck();
        await dataIs("figure", "");
      }
      if (id === "select") {
        // Select starts with sulfur atoms coloured by element.
        assertStrictEquals(
          await page.getByLabel("Selection query").inputValue(),
          "sulfur",
        );
        assertStrictEquals(
          await page.getByLabel("Color field").inputValue(),
          "element",
        );
        const sulfur = Array.from(crambin.topology.atoms.element).filter((e) =>
          e === 16
        ).length;
        await dataIs("selectedCount", String(sulfur));
        const before = sulfur;
        await page.getByLabel("Selection query").selectOption("site");
        await page.waitForFunction(
          (count) =>
            Number(
              document.querySelector("#molecule-canvas")?.dataset.selectedCount,
            ) !== count,
          before,
        );
        assert(
          Number(await host.getAttribute("data-selected-count")) > 0,
          "the neighbourhood query resolves real CYS residues",
        );
        await page.getByLabel("Color field").selectOption("charge");
        assertStrictEquals(
          await host.getAttribute("data-charge-provenance"),
          "imported:pqr",
        );
        // Crambin is neutral; applyPqr's hydrogen folding keeps the total.
        const net = Number(await host.getAttribute("data-net-charge"));
        assert(Math.abs(net) < 1e-3, `net charge ${net}`);

        // Example structures (0z3.3): each has its own site preset, and those
        // without shipped charges fall back to element colour.
        await page.getByLabel("Selection query").selectOption("site");
        for (
          const [structure, atoms] of [
            ["1tqn", "3999"],
            ["1a4y", "8939"],
            ["1c3w", "2073"],
          ]
        ) {
          await page.getByLabel("Example structure").selectOption(structure);
          await dataIs("fixture", structure);
          await dataIs("atomCount", atoms);
          assert(
            Number(await host.getAttribute("data-selected-count")) > 0,
            `${structure} site preset selects atoms`,
          );
          if (structure === "1c3w") {
            // The membrane preset holds every lipid and squalene atom.
            const { atoms: rows, residues } = bacteriorhodopsin.topology;
            let lipid = 0;
            for (let i = 0; i < rows.count; i++) {
              if (["LI1", "SQU"].includes(residues.comp[rows.residue[i]])) {
                lipid++;
              }
            }
            const selected = Number(
              await host.getAttribute("data-selected-count"),
            );
            assert(
              lipid > 100 && selected > lipid,
              `1C3W preset covers its ${lipid} lipid atoms and the retinal pocket (${selected})`,
            );
          }
          assertStrictEquals(
            await page.getByLabel("Color field").inputValue(),
            "element",
            `${structure} has no shipped charges`,
          );
          assertStrictEquals(await host.getAttribute("data-net-charge"), "");
          await waitForWebGpu(page);
          // Loading text clears only once the new structure has mounted.
          await page.waitForFunction(
            () =>
              document.querySelector("[data-webgpu-error]")?.textContent === "",
            null,
            { timeout: 30000 },
          );
        }
        await page.getByLabel("Example structure").selectOption("1crn");
        await dataIs("fixture", "1crn");
        await dataIs("chargeProvenance", "imported:pqr");

        // Click-to-focus: picking an atom eases the orbit target and radius
        // to its residue through a camera curve, uploading nothing.
        await page.getByLabel("Click to focus").check();
        await waitForVisibleCanvas(page);
        const wideRadius = Number(await host.getAttribute("data-focus-radius"));
        await page.evaluate(async (url) => {
          const counters = await import(url);
          counters.enableInstrumentation();
          counters.resetCounters();
          globalThis.__focusCounters = counters;
        }, `/@fs${instrumentationPath}`);
        const atomPoint = await page.evaluate(async () => {
          const canvas = document.querySelector("#molecule-canvas canvas");
          const bitmap = await createImageBitmap(
            await new Promise((resolve) => canvas.toBlob(resolve)),
          );
          const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context = snapshot.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const { data, width, height } = context.getImageData(
            0,
            0,
            bitmap.width,
            bitmap.height,
          );
          bitmap.close();
          const rect = canvas.getBoundingClientRect();
          // The brightest pixel near the centre is a highlighted atom.
          let best = null, brightest = 0;
          for (let y = Math.floor(height * 0.3); y < height * 0.7; y += 2) {
            for (let x = Math.floor(width * 0.3); x < width * 0.7; x += 2) {
              const i = 4 * (y * width + x);
              const sum = data[i] + data[i + 1] + data[i + 2];
              if (sum > brightest) [best, brightest] = [[x, y], sum];
            }
          }
          return [
            rect.left + best[0] * rect.width / width,
            rect.top + best[1] * rect.height / height,
          ];
        });
        await page.mouse.click(atomPoint[0], atomPoint[1]);
        await page.waitForFunction(
          () => document.querySelector("#molecule-canvas")?.dataset.focusRow,
          null,
          { timeout: 30000 },
        );
        await dataIs("focusDone", "true");
        const row = Number(await host.getAttribute("data-focus-row"));
        const residue = crambin.topology.atoms.residue[row];
        const focusRadius = Number(
          await host.getAttribute("data-focus-radius"),
        );
        const target = (await host.getAttribute("data-focus-target"))
          .split(",").map(Number);
        // The residue's atom bounding box, from the fixture independently.
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        crambin.topology.atoms.residue.forEach((r, i) => {
          if (r !== residue) return;
          for (let k = 0; k < 3; k++) {
            const v = crambin.positions[3 * i + k];
            lo[k] = Math.min(lo[k], v);
            hi[k] = Math.max(hi[k], v);
          }
        });
        const offset = Math.hypot(
          ...target.map((v, k) => v - (lo[k] + hi[k]) / 2),
        );
        console.log(
          "focus",
          row,
          residue,
          wideRadius,
          "->",
          focusRadius,
          offset,
        );
        assert(
          focusRadius < wideRadius * 0.8 && offset < 1.5,
          `the camera centres residue ${residue} (radius ${wideRadius} -> ${focusRadius}, target ${offset} Å off)`,
        );
        const focusWork = await page.evaluate(() => {
          const counters = globalThis.__focusCounters;
          const s = counters.snapshotCounters();
          counters.disableInstrumentation();
          return {
            geometryBuilds: s.geometryBuilds,
            gathers: s.gathers,
            allocations: s.allocations,
            uploadBytes: s.uploadBytes,
          };
        });
        assertEquals(
          focusWork,
          { geometryBuilds: 0, gathers: 0, allocations: 0, uploadBytes: 0 },
          "a focus move is camera-only",
        );
        await page.getByLabel("Click to focus").uncheck();
        await dataIs("focusRow", "");
      }
      if (id === "surface") {
        assertStrictEquals(
          await page.getByLabel("Surface style").inputValue(),
          "opaque",
        );
        // The opaque neutral surface hides every atom; clipping its near
        // half reveals element-coloured ball-and-stick (red oxygens).
        const redPixels = () =>
          page.evaluate(async () => {
            const canvas = document.querySelector("#molecule-canvas canvas");
            const bitmap = await createImageBitmap(
              await new Promise((resolve) => canvas.toBlob(resolve)),
            );
            const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = snapshot.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            const { data } = context.getImageData(
              0,
              0,
              bitmap.width,
              bitmap.height,
            );
            bitmap.close();
            let red = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (
                data[i] > 120 && data[i] > 2 * data[i + 1] &&
                data[i] > 2 * data[i + 2]
              ) red++;
            }
            return red;
          });
        // The default is the solvent-accessible surface.
        assertStrictEquals(
          await host.getAttribute("data-surface-kind"),
          "accessible",
        );
        await waitForVisibleCanvas(page);
        await page.waitForFunction(() => globalThis.__surfaceDraws > 0);
        // A neutral opaque surface must actually cover the molecule before
        // taking the baseline; red atom pixels alone do not establish readiness.
        await page.evaluate(() => globalThis.__surfaceDrain());
        const before = await redPixels();
        await page.evaluate(async (url) => {
          const counters = await import(url);
          counters.enableInstrumentation();
          counters.resetCounters();
          globalThis.__surfaceCounters = counters;
        }, `/@fs${instrumentationPath}`);
        const initialDraws = await page.evaluate(() =>
          globalThis.__surfaceDraws
        );
        await page.getByLabel("Clip front").fill("0.55");
        await dataIs("clip", "0.55,1");
        await page.waitForFunction(
          (draws) => globalThis.__surfaceDraws > draws,
          initialDraws,
        );
        await page.evaluate(() => globalThis.__surfaceDrain());
        // Poll decoded pixels from the runner using the same capture path
        // for the baseline and clipped views.
        let after = before;
        for (const start = Date.now(); Date.now() - start < 30000;) {
          after = await redPixels();
          if (after > before + 20) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        console.log("clip red pixels", before, after);
        assert(
          after > before + 20,
          `clipping reveals the atoms inside (${before} -> ${after})`,
        );
        const firstClipWork = await page.evaluate(() => {
          const { detail } = globalThis.__surfaceCounters.snapshotCounters();
          return {
            meshBuilds: detail["geometryBuilds:surface:mesh"] ?? 0,
            coordinateBytes: detail["uploadBytes:structure:positions"] ?? 0,
          };
        });
        console.log("first clip work", firstClipWork);
        assertEquals(
          firstClipWork,
          { meshBuilds: 0, coordinateBytes: 0 },
          "the first cut retains the surface mesh and root coordinates",
        );
        // The back handle cuts the far side on the same slider: through a thin
        // slab the background shows where the far half of the surface was.
        const backgroundPixels = () =>
          page.evaluate(async () => {
            const canvas = document.querySelector("#molecule-canvas canvas");
            const bitmap = await createImageBitmap(
              await new Promise((resolve) => canvas.toBlob(resolve)),
            );
            const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = snapshot.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            const { data } = context.getImageData(
              0,
              0,
              bitmap.width,
              bitmap.height,
            );
            bitmap.close();
            const [r, g, b] = data;
            let background = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (
                Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) +
                    Math.abs(data[i + 2] - b) <= 6
              ) background++;
            }
            return background;
          });
        assert(
          await page.evaluate(() => globalThis.__surfaceDraws) > initialDraws,
          "front clipping reached a surface draw",
        );
        const open = await backgroundPixels();
        await page.evaluate(async (url) => {
          const counters = await import(url);
          counters.enableInstrumentation();
          counters.resetCounters();
          globalThis.__surfaceCounters = counters;
        }, `/@fs${instrumentationPath}`);
        const frontDraws = await page.evaluate(() => globalThis.__surfaceDraws);
        await page.getByLabel("Clip back").fill("0.6");
        await dataIs("clip", "0.55,0.6");
        await page.waitForFunction(
          (draws) => globalThis.__surfaceDraws > draws,
          frontDraws,
        );
        await page.evaluate(() => globalThis.__surfaceDrain());
        let slab = open;
        for (const start = Date.now(); Date.now() - start < 30000;) {
          slab = await backgroundPixels();
          if (slab > open + 1000) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        console.log("clip slab background pixels", open, slab);
        const clipWork = await page.evaluate(() => {
          const s = globalThis.__surfaceCounters.snapshotCounters();
          return {
            geometryBuilds: s.geometryBuilds,
            uploadBytes: s.uploadBytes,
          };
        });
        assertEquals(
          clipWork,
          { geometryBuilds: 0, uploadBytes: 0 },
          "moving an existing slab rebuilds no mesh and uploads no coordinates",
        );
        await page.evaluate(() =>
          globalThis.__surfaceCounters.disableInstrumentation()
        );
        assert(
          slab > open + 1000,
          `the back cut removes the far side (${open} -> ${slab})`,
        );
        await page.getByLabel("Clip front").fill("0");
        await page.getByLabel("Clip back").fill("1");
        await dataIs("clip", "0,1");
        await page.getByLabel("Surface type").selectOption("excluded");
        await dataIs("surfaceKind", "excluded");
        await page.getByLabel("Surface type").selectOption("accessible");
        await dataIs("surfaceKind", "accessible");
        await page.getByLabel("Surface color field").selectOption("element");
        await page.getByLabel("Material model").selectOption("normal");
        assertStrictEquals(
          await page.getByLabel("Material model").inputValue(),
          "normal",
        );
        // Look controls are uniform or shader changes: the viewer's dev
        // counters (the same module instance the page runs) must show no SES
        // rebuild, gather, allocation or upload while they change.
        await page.evaluate(async (url) => {
          const counters = await import(url);
          counters.enableInstrumentation();
          counters.resetCounters();
          globalThis.__surfaceCounters = counters;
        }, `/@fs${instrumentationPath}`);
        // Pumice is a new mesh (finer grid, smaller probe). Its vertex
        // buffers upload together once the geometry job lands; wait for that
        // before counting, so the rebuild is not attributed to a look change.
        const meshUploaded = () =>
          page.waitForFunction(
            () => {
              const { detail } = globalThis.__surfaceCounters
                .snapshotCounters();
              return detail["geometryBuilds:surface:mesh"] >= 1 &&
                detail["allocations:indices"] >= 1;
            },
            null,
            { timeout: 30000, polling: 50 },
          );
        await page.getByLabel("Surface style").selectOption("pumice");
        assertStrictEquals(
          await page.getByLabel("Surface style").inputValue(),
          "pumice",
        );
        await dataIs("roughness", "1");
        await dataIs("bump", "0.6,1.2");
        await meshUploaded();
        await page.evaluate(() => globalThis.__surfaceCounters.resetCounters());
        const surfaceWork = () =>
          page.evaluate(() => {
            const s = globalThis.__surfaceCounters.snapshotCounters();
            return {
              geometryBuilds: s.geometryBuilds,
              gathers: s.gathers,
              allocations: s.allocations,
              uploadBytes: s.uploadBytes,
            };
          });
        const look = [
          ["Pumice bump amplitude", "1.2", "bump", "1.2,1.2"],
          ["Pumice bump scale", "2.2", "bump", "1.2,2.2"],
          ["Surface roughness", "0.6", "roughness", "0.6"],
          ["Environment preset", "park", "environment", "park"],
          ["Tone mapping", "aces", "tonemap", "aces"],
        ];
        for (const [label, value, key, expected] of look) {
          const control = page.getByLabel(label);
          if (await control.evaluate((el) => el.tagName === "SELECT")) {
            await control.selectOption(value);
          } else await control.fill(value);
          await dataIs(key, expected);
        }
        await waitForVisibleCanvas(page);
        assertEquals(
          await surfaceWork(),
          { geometryBuilds: 0, gathers: 0, allocations: 0, uploadBytes: 0 },
          "pumice bump, roughness, environment and tone map rebuild nothing",
        );
        await page.getByLabel("Surface style").selectOption("glass");
        await page.getByLabel("Material model").selectOption("matte");
        await dataIs("fresnel", "true");
        await meshUploaded();
        await page.evaluate(() => globalThis.__surfaceCounters.resetCounters());
        await page.getByLabel("Fresnel glass").uncheck();
        await dataIs("fresnel", "false");
        await page.getByLabel("Environment preset").selectOption("road");
        await dataIs("environment", "road");
        await page.getByLabel("Fresnel glass").check();
        await dataIs("fresnel", "true");
        await waitForVisibleCanvas(page);
        const work = await surfaceWork();
        await page.evaluate(() =>
          globalThis.__surfaceCounters.disableInstrumentation()
        );
        assertEquals(
          work,
          { geometryBuilds: 0, gathers: 0, allocations: 0, uploadBytes: 0 },
          "glass Fresnel and environment toggles rebuild nothing",
        );
      }
      if (id === "motion") {
        const snapshotBudget = async (representation) => {
          await page.evaluate(async (url) => {
            const counters = await import(url);
            counters.enableInstrumentation();
            counters.resetCounters();
            globalThis.__snapshotCounters = counters;
          }, `/@fs${instrumentationPath}`);
          await page.getByLabel("Play looping playback").click();
          // Measure work over continuous animation; this interval is a rate
          // budget, not an assumption that a dispatch or readback completed.
          const elapsed = await page.evaluate(async () => {
            const start = performance.now();
            while (performance.now() - start < 1600) {
              await new Promise(requestAnimationFrame);
            }
            return performance.now() - start;
          });
          await page.getByLabel("Pause looping playback").click();
          // A slower GPU can still be mapping the final copy when playback
          // pauses. Observe publication and consumption instead of assuming
          // that pausing completes asynchronous GPU work.
          await page.waitForFunction(
            (representation) => {
              const { detail } = globalThis.__snapshotCounters
                .snapshotCounters();
              return (detail["gathers:coords:snapshot:publish"] ?? 0) > 0 &&
                (detail[`geometryBuilds:${representation}:trace`] ?? 0) > 0;
            },
            representation,
            { timeout: 15_000 },
          );
          const work = await page.evaluate(() => {
            const counters = globalThis.__snapshotCounters;
            const { detail } = counters.snapshotCounters();
            counters.disableInstrumentation();
            return detail;
          });
          const limit = Math.ceil(elapsed / 1000 * 4) + 2;
          const builds = work[`geometryBuilds:${representation}:trace`] ?? 0;
          const copies = work["gathers:coords:snapshot:dispatch"] ?? 0;
          assert(builds > 0, `${representation} follows moving snapshots`);
          assert(
            builds <= limit && copies <= limit,
            `${representation} respects 4 Hz: ${
              JSON.stringify({ elapsed, builds, copies, limit })
            }`,
          );
          assertEquals(
            work["allocations:coords:snapshot"] ?? 0,
            0,
            "new coordinate generations reuse the readback staging buffers",
          );
          console.log(
            "snapshot playback budget",
            representation,
            JSON.stringify({ elapsed, builds, copies, limit }),
          );
        };
        assertStrictEquals(
          await host.getAttribute("data-motion"),
          "trajectory",
        );
        assertStrictEquals(
          await page.getByLabel("Trajectory representation").inputValue(),
          "tube",
        );
        // <Ramachandran> inset: 1CRN's 44 residues with both torsions, drawn
        // only in the bottom-right corner of the canvas.
        await dataIs("ramaCount", "44");
        const insetFirst = await host.getAttribute("data-rama-first");
        const cornerLight = () =>
          page.evaluate(async () => {
            const canvas = document.querySelector("#molecule-canvas canvas");
            const bitmap = await createImageBitmap(
              await new Promise((resolve) => canvas.toBlob(resolve)),
            );
            const snapshot = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = snapshot.getContext("2d");
            context.drawImage(bitmap, 0, 0);
            const scale = bitmap.width / canvas.getBoundingClientRect().width;
            const box = Math.round(216 * scale), gap = Math.round(16 * scale);
            const lit = (x0, y0) => {
              const { data } = context.getImageData(
                x0,
                y0,
                box - gap,
                box - gap,
              );
              let count = 0;
              for (let i = 0; i < data.length; i += 4) {
                if (data[i] + data[i + 1] + data[i + 2] > 300) count++;
              }
              return count;
            };
            const result = {
              inset: lit(bitmap.width - box, bitmap.height - box),
              opposite: lit(gap, gap),
            };
            bitmap.close();
            return result;
          });
        const corners = await cornerLight();
        console.log("ramachandran inset", JSON.stringify(corners));
        assert(
          corners.inset > 200 && corners.opposite === 0,
          `the inset draws in its corner only: ${JSON.stringify(corners)}`,
        );
        // The inset is a toggle.
        await page.getByLabel("Ramachandran plot").uncheck();
        await dataIs("rama", "false");
        let hidden = corners;
        for (const start = Date.now(); Date.now() - start < 30000;) {
          hidden = await cornerLight();
          if (hidden.inset < corners.inset * 0.3) break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        assert(
          hidden.inset < corners.inset * 0.3,
          `turning the plot off removes the inset: ${JSON.stringify(hidden)}`,
        );
        await page.getByLabel("Ramachandran plot").check();
        await dataIs("rama", "true");
        // Scrubbing seeks: frames stream in and the displayed frame follows
        // the looping curve: 59 frame steps over 4 s (2 s → frame 29.5).
        for (
          const [seconds, frame] of [[2, 29.5], [3.5, 51.625], [0.5, 7.375]]
        ) {
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
        // The inset is live: trajectory frames move its points.
        await page.waitForFunction(
          (first) =>
            document.querySelector("#molecule-canvas")?.dataset.ramaFirst !==
              first,
          insetFirst,
          { timeout: 15000 },
        );
        await snapshotBudget("tube");
        await scrubTo(0.5);
        await page.getByLabel("Trajectory representation").selectOption(
          "ball-and-stick",
        );
        assertStrictEquals(
          await page.getByLabel("Timeline time in seconds").inputValue(),
          "0.5",
          "switching representation preserves trajectory time",
        );
        // Flicker regression (molgpu-sept-icj.7): each new trajectory frame
        // must keep live consumers drawn. Per-generation readiness hid them
        // for a render, so ball-and-stick dropped its bonds and re-created
        // their buffers on every frame.
        await waitForVisibleCanvas(page);
        await page.evaluate(async (url) => {
          const counters = await import(url);
          counters.enableInstrumentation();
          counters.resetCounters();
          globalThis.__playCounters = counters;
        }, `/@fs${instrumentationPath}`);
        for (
          const [seconds, frame] of [[1, 14.75], [1.25, 18.438], [1.5, 22.125]]
        ) {
          await scrubTo(seconds);
          await page.waitForFunction(
            (want) =>
              Math.abs(
                Number(
                  document.querySelector("#molecule-canvas")?.dataset.frame,
                ) - want,
              ) < 1e-2,
            frame,
            { timeout: 15000 },
          );
        }
        const playWork = await page.evaluate(() => {
          const counters = globalThis.__playCounters;
          const { detail } = counters.snapshotCounters();
          counters.disableInstrumentation();
          return {
            endpoints: detail["allocations:endpoints"] ?? 0,
            segments: detail["allocations:segments"] ?? 0,
            positions: detail["allocations:positions"] ?? 0,
          };
        });
        assertEquals(
          playWork,
          { endpoints: 0, segments: 0, positions: 0 },
          "new trajectory frames keep ball-and-stick drawn (no bond or atom rebuild)",
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
        await snapshotBudget("ribbon");

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
