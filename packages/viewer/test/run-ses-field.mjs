/**
 * WebGPU acceptance for the GPU solvent-excluded-surface field: on the
 * protein corpus it samples the same grid as Mol*'s calcMolecularSurface, marks
 * the same samples visited, agrees on field values except where f32 flips a
 * boundary "is this point hidden" test, and its marching-cubes mesh matches
 * the CPU mesh's vertex count and area.
 */
import { assert, assertEquals } from "@std/assert";
import { extname, fromFileUrl, normalize } from "@std/path";
import { build } from "vite";
import { launchWebGpuBrowser } from "./harness.mjs";

Deno.test("GPU SES field matches Mol*'s field on the protein corpus", async () => {
  const fixture = fromFileUrl(new URL("./ses-field/", import.meta.url));
  await build({ configFile: `${fixture}vite.config.mjs`, logLevel: "warn" });
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen() {} },
    async (req) => {
      const name = normalize(decodeURIComponent(new URL(req.url).pathname));
      const path = `${fixture}dist${name === "/" ? "/index.html" : name}`;
      try {
        const info = await Deno.stat(path);
        if (!info.isFile) throw new Error("not a file");
        const type = { ".html": "text/html", ".js": "text/javascript" }[
          extname(path)
        ] ?? "application/octet-stream";
        return new Response(await Deno.readFile(path), {
          headers: { "content-type": type },
        });
      } catch {
        return new Response("not found", { status: 404 });
      }
    },
  );
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${server.addr.port}/`);
    await page.waitForFunction(() =>
      typeof globalThis.runSesField === "function"
    );
    // A software GPU (CI) checks the small and mid-sized proteins only.
    const corpus = Deno.env.get("MOLGPU_SKIP_TIMING") === "1"
      ? ["1crn", "1tqn"]
      : ["1crn", "1ejg", "1tqn", "1a4y", "4c7r"];
    for (const id of corpus) {
      const r = await page.evaluate(
        (entry) => globalThis.runSesField(entry),
        id,
      );
      console.log(JSON.stringify(r));
      assertEquals(r.errors, [], `${id} WebGPU errors`);
      assertEquals(r.dims, r.cpuDims, `${id} grid`);
      assert(r.transformDiff < 1e-4, `${id} grid placement`);
      // A boundary flip moves at most a few samples per thousand.
      assert(r.visitedMismatch <= r.samples * 1e-4, `${id} visited samples`);
      assert(r.differ <= r.samples * 1e-3, `${id} field values`);
      assert(
        Math.abs(r.gpuVertices - r.cpuVertices) <= r.cpuVertices * 1e-3,
        `${id} mesh vertices`,
      );
      assert(
        Math.abs(r.gpuArea - r.cpuArea) <= r.cpuArea * 1e-3,
        `${id} mesh area`,
      );
    }
    assertEquals(errors, [], "browser errors");
  } finally {
    await browser?.close();
    await server.shutdown();
  }
});
