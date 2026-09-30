// crj.11 --browser: render the consumer's bundle in WebGPU Chrome. A preloaded
// structure must draw without fetching a Mol* chunk; a BCIF `src` must fetch
// one and draw. Records lit pixels, fetched chunks and page errors.
import { extname, join } from "@std/path";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "../../../packages/viewer/test/webgpu-browser-args.mjs";

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#000}#root{position:absolute;inset:0}</style>
</head><body><div id="root"></div>
<script>globalThis.__errors = [];</script>
<script type="module" src="./scene.js"></script></body></html>`;

const MOLSTAR =
  /^(mmcif|cif|ccp4|parser|mol-task|molecular-surface|boundary|ordered-set|grid|symbols|symbol-table|all|chem_comp|struct_conn|secondary-structure|util)-/;

export async function renderScene(dist: string, bcif: string) {
  const server = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen() {} },
    async (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/") {
        return new Response(HTML, { headers: { "content-type": "text/html" } });
      }
      if (path === "/structure.bcif") {
        return new Response(await Deno.readFile(bcif));
      }
      try {
        const bytes = await Deno.readFile(join(dist, path.slice(1)));
        return new Response(bytes, {
          headers: {
            "content-type": extname(path) === ".js"
              ? "text/javascript"
              : "application/octet-stream",
          },
        });
      } catch {
        return new Response("not found", { status: 404 });
      }
    },
  );
  const base = `http://127.0.0.1:${server.addr.port}/`;
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: webgpuBrowserArgs,
  });
  const visit = async (query: string) => {
    const page = await browser.newPage({
      viewport: { width: 480, height: 360 },
    });
    const errors: string[] = [];
    const chunks: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|status of 404/.test(m.text())) {
        errors.push(m.text());
      }
    });
    page.on("response", (r) => {
      if (r.status() >= 400 && !r.url().endsWith("/favicon.ico")) {
        errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
      }
    });
    page.on("request", (r) => {
      const name = new URL(r.url()).pathname.slice(1);
      if (name.endsWith(".js")) chunks.push(name);
    });
    await page.goto(base + query);
    // Wait for a lit frame (the structure has drawn) or give up after 30 s.
    let lit = 0;
    for (let i = 0; i < 60 && !lit; i++) {
      await page.waitForTimeout(500);
      const canvas = page.locator("canvas");
      if (!await canvas.count()) continue;
      // A WebGPU canvas is read through a screenshot, as the viewer suites do.
      const png = (await canvas.screenshot()).toString("base64");
      lit = await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const off = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = off.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        let n = 0;
        for (let p = 0; p < data.length; p += 4) {
          if (data[p] + data[p + 1] + data[p + 2] > 60) n++;
        }
        return n;
      }, png);
    }
    errors.push(
      ...await page.evaluate(() =>
        (globalThis as { __errors?: string[] }).__errors ?? []
      ),
    );
    await page.close();
    return {
      litPixels: lit,
      errors,
      molstarChunksFetched: chunks.filter((c) => MOLSTAR.test(c)).sort(),
      chunksFetched: chunks.length,
    };
  };
  try {
    return {
      preloaded: await visit(""),
      bcif: await visit("?src=/structure.bcif"),
    };
  } finally {
    await browser.close();
    await server.shutdown();
  }
}
