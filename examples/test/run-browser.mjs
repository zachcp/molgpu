import { assert, assertEquals } from "@std/assert";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "../../packages/viewer/test/webgpu-browser-args.mjs";

const results = [];

for (const protocol of ["http", "file"]) {
  const example = "hello";
  Deno.test({
    name:
      `${protocol} ${example}: standalone HTML renders published JSR molgpu with an import map`,
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      // Serve the file verbatim: no Vite, workspace aliases, or module transforms.
      const html = await Deno.readFile(
        new URL(`../${example}.html`, import.meta.url),
      );
      const server = Deno.serve(
        { hostname: "127.0.0.1", port: 0, onListen() {} },
        () => new Response(html, { headers: { "content-type": "text/html" } }),
      );
      let browser;
      try {
        browser = await chromium.launch({
          channel: "chrome",
          headless: true,
          args: webgpuBrowserArgs,
        });
        const page = await browser.newPage({
          viewport: { width: 1100, height: 800 },
        });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        const requests = [];
        page.on("request", (request) => requests.push(request.url()));
        page.on("response", (response) => {
          if (response.status() >= 400) {
            errors.push(`${response.status()} ${response.url()}`);
          }
        });
        const url = protocol === "file"
          ? new URL("../hello.html", import.meta.url).href
          : `http://127.0.0.1:${server.addr.port}`;
        const started = Date.now();
        await page.goto(url);
        await page.waitForFunction(
          () =>
            document.querySelector("#status")?.dataset.error ||
            document.querySelector("#status")?.textContent.includes(
              "Colored by element",
            ),
          null,
          { timeout: 120000 },
        );
        assertEquals(
          await page.locator("#status").getAttribute("data-error"),
          null,
          await page.locator("#status").textContent(),
        );
        const canvas = page.locator("#viewer canvas");
        await canvas.waitFor();
        // Check compositor screenshots. WebGPU canvas snapshots can be cleared
        // after presentation even while the compositor displays the molecule.
        const deadline = Date.now() + 60000;
        let pixels = 0;
        let initial;
        while (Date.now() < deadline && pixels < 200) {
          initial = await canvas.screenshot();
          pixels = await page.evaluate(async (bytes) => {
            const bitmap = await createImageBitmap(
              new Blob([new Uint8Array(bytes)], { type: "image/png" }),
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
              let count = 0;
              for (let i = 0; i < data.length; i += 4) {
                const x = (i / 4) % bitmap.width;
                const y = Math.floor(i / 4 / bitmap.width);
                if (
                  x < bitmap.width * 0.25 || x > bitmap.width * 0.75 ||
                  y < bitmap.height * 0.25 || y > bitmap.height * 0.75
                ) continue;
                if (data[i] + data[i + 1] + data[i + 2] > 150) count++;
              }
              return count;
            } finally {
              bitmap.close();
            }
          }, Array.from(initial));
        }
        assert(pixels > 200, "visible lit molecular pixels");
        const firstVisibleMs = Date.now() - started;
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width / 2 + 150,
          box.y + box.height / 2 + 40,
          { steps: 10 },
        );
        await page.mouse.up();
        await page.mouse.wheel(0, 150);
        const moved = await canvas.screenshot();
        assert(!initial.equals(moved), "drag and zoom change the view");
        await page.getByRole("button", { name: "Reset view" }).click();
        const reset = await canvas.screenshot();
        assert(!moved.equals(reset), "reset changes the view");
        const measurement = {
          protocol,
          firstVisibleMs,
          acceptanceMs: Date.now() - started,
          requests: requests.length,
          wasm: requests.filter((url) => url.includes(".wasm")),
          fonts: requests.filter((url) => /\.(woff|ttf|otf)/.test(url)),
        };
        console.log(JSON.stringify(measurement));
        await page.goto("about:blank"); // pagehide unmounts the Live root.
        assertEquals(
          errors,
          [],
          "no uncaptured WebGPU or browser errors, including unmount",
        );
        results.push({ ...measurement, browser: await browser.version() });
        await Deno.writeTextFile(
          new URL(
            "../../docs/findings/evidence/2026-10-10-standalone-html.json",
            import.meta.url,
          ),
          JSON.stringify(results, null, 2) + "\n",
        );
        console.log(
          `Rendered ${pixels} lit pixels from the published JSR module graph.`,
        );

        const unsupported = await browser.newPage();
        await unsupported.addInitScript(() =>
          Object.defineProperty(navigator, "gpu", { value: undefined })
        );
        await unsupported.goto(url);
        await unsupported.locator("#status[data-error]").waitFor();
        assert(
          (await unsupported.locator("#status").textContent()).includes(
            "WebGPU is unavailable",
          ),
        );
      } finally {
        await browser?.close();
        await server.shutdown();
      }
    },
  });
}
