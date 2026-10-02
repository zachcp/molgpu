import { fromFileUrl } from "@std/path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";

// Screenshots are review evidence, not a cross-platform pixel oracle.
const out = Deno.env.get("CARTOON_COMPARE_OUT") ?? "/tmp";
const root = fromFileUrl(new URL("../../../", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: workspaceAliases() },
  server: { host: "127.0.0.1", port: 5210, strictPort: true },
  optimizeDeps: {
    entries: ["packages/viewer/test/cartoon-compare.html"],
    include: [
      "@use-gpu/live",
      "@use-gpu/workbench",
      "@use-gpu/webgpu",
      "@use-gpu/core",
      // @molgpu/timeline imports this pinned easing module. Prebundle it before
      // navigation so Vite does not reload live modules with an Outdated
      // Optimize Dep response during the test.
      "@use-gpu/core/mjs/ease.mjs",
      "@use-gpu/shader",
      "@use-gpu/shader/wgsl",
      "@use-gpu/wgsl",
      "molstar/lib/apps/viewer/app.js",
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
  const ids = Deno.args.length ? Deno.args : ["1crn", "2k39", "1bna", "1tqn"];
  for (const [id, view] of ids.flatMap((id) => [[id, "front"], [id, "side"]])) {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error(id, message.text());
    });
    page.on("pageerror", (error) => console.error(id, error));
    await page.goto(
      `http://127.0.0.1:5210/packages/viewer/test/cartoon-compare.html?id=${id}&view=${view}`,
    );
    await page.waitForFunction(() => globalThis.__cartoonCompare?.ready, null, {
      timeout: 60000,
    });
    await page.waitForTimeout(2000);
    const result = await page.evaluate(() => globalThis.__cartoonCompare);
    if (
      !result.molstarRepresentations?.some((repr) => repr.type === "cartoon")
    ) {
      throw new Error(
        `${id}: Mol* reference did not create a cartoon representation`,
      );
    }
    if (result.errors.length) {
      throw new Error(`${id}: viewer errors: ${result.errors.join("; ")}`);
    }
    console.log(id, view, result);
    await page.screenshot({ path: `${out}/${id}-${view}.png` });
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
