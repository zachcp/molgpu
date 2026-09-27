import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "playwright";

Deno.test("GPU DSSP agrees with CPU on the pinned protein corpus", async () => {
  const fixture = fileURLToPath(new URL("./gpu-dssp/", import.meta.url));
  await build({ configFile: `${fixture}vite.config.mjs`, logLevel: "warn" });
  const server = createServer(async (req, res) => {
    const name = normalize(
      decodeURIComponent(new URL(req.url, "http://x").pathname),
    );
    const path = `${fixture}dist${name === "/" ? "/index.html" : name}`;
    try {
      if (!(await stat(path)).isFile()) throw new Error("not a file");
      const type = { ".html": "text/html", ".js": "text/javascript" }[
        extname(path)
      ] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type });
      res.end(await readFile(path));
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("HTTP address");
    }
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--enable-unsafe-webgpu"],
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(() => typeof window.runGpuDssp === "function");
    assert.deepEqual(
      await page.evaluate(() => window.runDsspOverflowPolicy()),
      ["static", "frame", "frame"],
      "component overflow defaults must distinguish a static root from live coordinates",
    );
    for (const id of ["1crn", "1ejg", "1tqn", "1a4y", "4c7r", "1bna"]) {
      const result = await page.evaluate(
        (entry) => window.runGpuDssp(entry),
        id,
      );
      console.log(
        `${id}: ${result.residues} residues, ${result.bridges} bridges, ${result.near} near threshold, ${
          result.milliseconds.toFixed(1)
        } ms`,
      );
      assert.deepEqual(result.mismatch, [], `${id} GPU/CPU mismatch`);
    }
    for (const model of [1, 58, 116]) {
      const result = await page.evaluate(
        (number) => window.runGpuDssp("2k39", number),
        model,
      );
      console.log(
        `2k39 model ${model}: ${result.residues} residues, ${result.near} near threshold`,
      );
      assert.deepEqual(result.mismatch, [], `2k39 model ${model} mismatch`);
    }
    const overflow = await page.evaluate(() => window.runDenseDsspOverflow());
    assert.deepEqual(overflow, { named: true, equal: true });
    if (Deno.env.get("MOLGPU_DSSP_BENCH") === "1") {
      for (const copies of [306, 3059]) {
        const result = await page.evaluate(
          (number) => window.benchmarkGpuDssp(number),
          copies,
        );
        console.log(`DSSP benchmark: ${JSON.stringify(result)}`);
        assert.equal(result.mismatch, 0);
        assert.equal(result.fallback, false);
      }
    }
    assert.deepEqual(errors, [], "browser errors");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
