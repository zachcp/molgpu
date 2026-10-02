// hj0.2 acceptance: a use.gpu <Pass lights> draws a transparent molgpu
// molecular surface with no WebGPU errors, and enabling ssao + outline + oit
// compiles the extra full-screen render pipelines and allocates the extra
// offscreen targets those passes need, with molgpu layers in the pass. OIT is
// the transparent-surface pass.
import { assert, assertEquals } from "@std/assert";
import {
  captureErrors,
  launchWebGpuBrowser,
  startDevServer,
} from "./harness.mjs";

Deno.test("viewer postprocess", async () => {
  const cacheDir = await Deno.makeTempDir({
    prefix: "molgpu-postprocess-vite-",
  });
  const server = await startDevServer({
    port: 5212,
    entries: ["packages/viewer/test/postprocess.html"],
    cacheDir,
    noDiscovery: true,
  });
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    const errors = captureErrors(page);
    await page.goto(
      "http://127.0.0.1:5212/packages/viewer/test/postprocess.html",
    );
    await page.waitForFunction(
      () => globalThis.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Postprocess mount failed: ${errors.join("; ") || error.message}`,
        );
      });
    // The surface geometry is built asynchronously; wait for it to draw.
    await page.waitForFunction(
      () => globalThis.__probe.storage.length > 0,
      null,
      {
        timeout: 30000,
      },
    )
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
        pipelines: globalThis.__probe.pipelines,
        textures: globalThis.__probe.textures,
        errors: [...globalThis.__probe.errors],
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
    await page.evaluate(() => globalThis.__probe.setMode("post"));
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
    await Deno.remove(cacheDir, { recursive: true });
  }
});
