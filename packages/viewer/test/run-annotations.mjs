// hj0.4 acceptance: a centroid-anchored <Label> and a <Distance> between two
// selections' centroids render in a real WebGPU scene with a FontLoader and no
// WebGPU errors; the centroid/distance the components anchor to match the pure
// helper; the label's glyphs actually paint (hj0.6: they once drew entirely
// off-screen with zero errors, so "no errors + an atlas exists" is not enough);
// and re-anchoring the label to a different selection moves the painted text.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";

Deno.test("viewer annotations", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port: 5214, strictPort: true },
    optimizeDeps: {
      entries: ["packages/viewer/test/annotations.html"],
      // @use-gpu/glyph loads a Rust/wasm text shaper; pre-bundling it breaks the
      // wasm init, so leave it unbundled and let vite serve the wasm.
      exclude: [
        "@molgpu/fields",
        "@molgpu/table",
        "@molgpu/io",
        "@molgpu/geo",
        "@molgpu/select",
        "@molgpu/timeline",
        "@molgpu/viewer",
        "@use-gpu/glyph",
      ],
      include: [
        "@use-gpu/live",
        "@use-gpu/workbench",
        "@use-gpu/webgpu",
        "@use-gpu/core",
        "@use-gpu/shader",
        "@use-gpu/shader/wgsl",
        "@use-gpu/wgsl",
      ],
    },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: webgpuBrowserArgs,
    });
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(
      "http://127.0.0.1:5214/packages/viewer/test/annotations.html",
    );
    await page.waitForFunction(
      () => globalThis.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Annotations mount failed: ${errors.join("; ") || error.message}`,
        );
      });

    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 24; i++) await new Promise(requestAnimationFrame);
      });
    // The label is pure yellow on black, next to grey carbon spheres: yellow
    // canvas pixels are glyph coverage. Returns their count and mean x (0..1).
    const yellow = async () =>
      page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const image = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        image.close();
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0, sumX = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 150 && pixels[i + 1] > 150 && pixels[i + 2] < 80) {
            count++;
            sumX += (i / 4) % canvas.width;
          }
        }
        return { count, meanX: count ? sumX / count / canvas.width : null };
      }, (await page.locator("canvas").screenshot()).toString("base64"));
    const snap = () =>
      page.evaluate(() => ({
        storage: globalThis.__probe.storage,
        textures: globalThis.__probe.textures,
        pipelines: globalThis.__probe.pipelines,
        centroidA: globalThis.__probe.centroidA,
        distance: globalThis.__probe.distance,
        errors: [...globalThis.__probe.errors],
      }));

    await settle();
    await settle();
    const s = await snap();
    assertEquals(s.errors, [], "annotations scene produced WebGPU errors");
    // The pure anchor the components use: centroid of rows 0,1 = (-3,1,0), 6 A apart from rows 2,3.
    assertEquals(
      s.centroidA,
      [-3, 1, 0],
      `centroid anchor wrong: ${JSON.stringify(s.centroidA)}`,
    );
    assertStrictEquals(s.distance, 6, `distance anchor wrong: ${s.distance}`);
    assert(
      s.pipelines > 0,
      "expected render pipelines for the labels + line",
    );
    // The label text needs a font atlas: a texture beyond the render targets means
    // the glyph path actually engaged.
    assert(
      s.textures > 0,
      "expected a font-atlas / render texture to be allocated",
    );
    // The glyphs must actually reach the canvas, left of centre (centroid A, x=-3).
    const textA = await yellow();
    assert(
      textA.count > 40,
      `label glyphs did not paint: ${JSON.stringify(textA)}`,
    );
    assert(
      textA.meanX < 0.5,
      `label A should sit left of centre: ${JSON.stringify(textA)}`,
    );

    // Re-anchor the label to the other selection: no errors, still rendering.
    await page.evaluate(() => globalThis.__probe.setLabel("b"));
    await settle();
    await settle();
    const moved = await snap();
    assertEquals(
      moved.errors,
      [],
      "re-anchoring the label produced WebGPU errors",
    );
    const textB = await yellow();
    assert(
      textB.count > 40,
      `re-anchored label glyphs did not paint: ${JSON.stringify(textB)}`,
    );
    assert(
      textB.meanX > 0.5,
      `label should follow selection B (x=+3) right of centre: ${
        JSON.stringify(textB)
      }`,
    );

    assertEquals(errors, [], "page errors");
    console.log(
      JSON.stringify({
        status: "passed",
        centroidA: s.centroidA,
        distance: s.distance,
        textA,
        textB,
        textures: s.textures,
        pipelines: s.pipelines,
        browser: browser.version(),
      }),
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});
