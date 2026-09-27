// hj0.2 acceptance: the @molgpu/viewer <Pass> wrapper draws a transparent
// molecular surface under the viewer light wrappers with no WebGPU errors, and
// enabling ssao + outline + oit compiles the extra full-screen render pipelines
// and allocates the extra offscreen targets those passes need — proving the
// postprocessing flags wire through the wrapper. OIT is the transparent-surface
// pass.
import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";

Deno.test("viewer postprocess", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const server = await createServer({
    root,
    configFile: false,
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port: 5212, strictPort: true },
    optimizeDeps: {
      entries: ["packages/viewer/test/postprocess.html"],
      exclude: [
        "@molgpu/fields",
        "@molgpu/table",
        "@molgpu/io",
        "@molgpu/geo",
        "@molgpu/select",
        "@molgpu/viewer",
      ],
      include: [
        "@use-gpu/live",
        "@use-gpu/workbench",
        "@use-gpu/webgpu",
        "@use-gpu/core",
        "@use-gpu/shader",
        "@use-gpu/shader/wgsl",
        "@use-gpu/wgsl",
        "lodash",
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
      "http://127.0.0.1:5212/packages/viewer/test/postprocess.html",
    );
    await page.waitForFunction(
      () => window.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Postprocess mount failed: ${errors.join("; ") || error.message}`,
        );
      });
    // The surface geometry is built asynchronously; wait for it to draw.
    await page.waitForFunction(() => window.__probe.storage.length > 0, null, {
      timeout: 30000,
    })
      .catch((error) => {
        throw new Error(
          `Surface geometry never appeared: ${
            errors.join("; ") || error.message
          }`,
        );
      });

    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
      });
    const snap = () =>
      page.evaluate(() => ({
        pipelines: window.__probe.pipelines,
        textures: window.__probe.textures,
        errors: [...window.__probe.errors],
      }));

    // Plain pass (lights only): the transparent surface + spacefill draw cleanly.
    await settle();
    await settle();
    const plain = await snap();
    assertEquals(plain.errors, [], "plain pass produced WebGPU errors");
    assert(
      plain.pipelines > 0,
      "expected the plain scene to compile render pipelines",
    );

    // Switch to the postprocessed scene: a DISTINCT component, so a fresh <Pass>
    // is constructed with ssao + outline + oit from the start (no live-toggle of
    // an already-compiled pass). Each effect is its own full-screen pass with its
    // own offscreen target(s), so the mount must add render pipelines and
    // textures over the plain baseline — and must draw the transparent surface
    // with no WebGPU errors.
    await page.evaluate(() => window.__probe.setMode("post"));
    await settle();
    await settle();
    await settle();
    const post = await snap();
    assertEquals(
      post.errors,
      [],
      "postprocessed pass produced WebGPU errors",
    );
    assert(
      post.pipelines > plain.pipelines,
      `ssao/outline/oit must compile extra render pipelines (plain ${plain.pipelines}, post ${post.pipelines})`,
    );
    assert(
      post.textures > plain.textures,
      `ssao/outline/oit must allocate extra offscreen targets (plain ${plain.textures}, post ${post.textures})`,
    );

    assertEquals(errors, [], "page errors");

    console.log(JSON.stringify({
      status: "passed",
      plainPipelines: plain.pipelines,
      postPipelines: post.pipelines,
      plainTextures: plain.textures,
      postTextures: post.textures,
      browser: browser.version(),
    }));
  } finally {
    await browser?.close();
    await server.close();
  }
});
