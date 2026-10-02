import { assertEquals, assertStrictEquals } from "@std/assert";
import { extname, fromFileUrl, normalize } from "@std/path";
import { build } from "vite";
import { launchWebGpuBrowser } from "./harness.mjs";

Deno.test("GPU DSSP agrees with CPU on the pinned protein corpus", async () => {
  const fixture = fromFileUrl(new URL("./gpu-dssp/", import.meta.url));
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
    const address = server.addr;
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.waitForFunction(() =>
      typeof globalThis.runGpuDssp === "function"
    );
    assertEquals(
      await page.evaluate(() => globalThis.runDsspOverflowPolicy()),
      ["static", "frame", "frame"],
      "component overflow defaults must distinguish a static root from live coordinates",
    );
    for (const id of ["1crn", "1ejg", "1tqn", "1a4y", "4c7r", "1bna"]) {
      const result = await page.evaluate(
        (entry) => globalThis.runGpuDssp(entry),
        id,
      );
      console.log(
        `${id}: ${result.residues} residues, ${result.bridges} bridges, ${result.near} direct threshold centres, ${
          result.milliseconds.toFixed(1)
        } ms`,
      );
      assertEquals(result.mismatch, [], `${id} GPU/CPU mismatch`);
      if (id === "1crn") {
        assertStrictEquals(
          result.aborted,
          true,
          "superseded frame must stop before the next GPU pass",
        );
        assertStrictEquals(
          result.stableFrame,
          true,
          "a source write between submits must not mix coordinate frames",
        );
        assertStrictEquals(
          result.storageCopy,
          true,
          "a source without COPY_SRC is frozen by a storage copy",
        );
      }
    }
    for (const model of [1, 58, 116]) {
      const result = await page.evaluate(
        (number) => globalThis.runGpuDssp("2k39", number),
        model,
      );
      console.log(
        `2k39 model ${model}: ${result.residues} residues, ${result.near} direct threshold centres`,
      );
      assertEquals(result.mismatch, [], `2k39 model ${model} mismatch`);
    }
    const overflow = await page.evaluate(() =>
      globalThis.runDenseDsspOverflow()
    );
    assertEquals(overflow, {
      named: true,
      equal: true,
      sparseNamed: true,
      sparseReason: true,
      sparseEqual: true,
    });
    if (Deno.env.get("MOLGPU_DSSP_BENCH") === "1") {
      for (const id of ["1crn", "1tqn", "4c7r"]) {
        const playback = await page.evaluate(
          (entry) => globalThis.measureDsspPlayback(entry, 40),
          id,
        );
        console.log(`DSSP playback: ${JSON.stringify(playback)}`);
      }
      for (const copies of [306, 3059]) {
        const result = await page.evaluate(
          (number) => globalThis.benchmarkGpuDssp(number),
          copies,
        );
        console.log(`DSSP benchmark: ${JSON.stringify(result)}`);
        assertStrictEquals(result.mismatch, 0);
        assertStrictEquals(result.fallback, false);
      }
    }
    assertEquals(errors, [], "browser errors");
  } finally {
    await browser?.close();
    await server.shutdown();
  }
});
