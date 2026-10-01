import { assert, assertEquals } from "@std/assert";
import { chromium } from "playwright";
import { createServer } from "vite";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";
import { webgpuBrowserArgs } from "../../../packages/viewer/test/webgpu-browser-args.mjs";
const server = await createServer({
  root: new URL("../../../", import.meta.url).pathname,
  configFile: false,
  resolve: { alias: workspaceAliases() },
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: { entries: ["test/spikes/gpu-retirement/readbacks.html"] },
});
let browser;
const results = [];
try {
  await server.listen();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: webgpuBrowserArgs,
  });
  for (const phase of ["before-map", "mapped-completion", "rejected-map"]) {
    for (const kind of ["status", "bounds", "snapshot"]) {
      for (const action of ["replace", "unmount"]) {
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.addInitScript((phase) => {
          const held = [];
          const events = [];
          const map = GPUBuffer.prototype.mapAsync;
          const destroy = GPUBuffer.prototype.destroy;
          const ids = new WeakMap();
          let next = 0;
          const id = (b) => {
            if (!ids.has(b)) ids.set(b, next++);
            return ids.get(b);
          };
          GPUBuffer.prototype.mapAsync = function (...args) {
            if (
              !["molgpu:readback-probe", "molgpu:coords:bounds:staging"]
                .includes(this.label)
            ) return map.apply(this, args);
            const own = id(this);
            events.push({ type: "map", id: own, label: this.label });
            if (phase === "before-map" || phase === "rejected-map") {
              return new Promise((resolve, reject) =>
                held.push(() => {
                  events.push({ type: "release", id: own });
                  if (phase === "rejected-map") {
                    reject(
                      new DOMException("Injected map failure", "AbortError"),
                    );
                  } else map.apply(this, args).then(resolve, reject);
                })
              );
            }
            return map.apply(this, args).then(() =>
              new Promise((resolve) => {
                events.push({ type: "native-mapped", id: own });
                held.push(() => {
                  events.push({ type: "release", id: own });
                  resolve();
                });
              })
            );
          };
          GPUBuffer.prototype.destroy = function () {
            events.push({ type: "destroy", id: id(this), label: this.label });
            return destroy.call(this);
          };
          const request = GPUAdapter.prototype.requestDevice;
          GPUAdapter.prototype.requestDevice = async function (...args) {
            const device = await request.apply(this, args);
            device.addEventListener(
              "uncapturederror",
              (e) =>
                events.push({ type: "gpu-error", message: e.error.message }),
            );
            return device;
          };
          globalThis.__maps = {
            events,
            held,
            releaseOne: () => held.shift()?.(),
            release: () => held.splice(0).forEach((f) => f()),
          };
        }, phase);
        await page.goto(
          `${
            server.resolvedUrls.local[0]
          }test/spikes/gpu-retirement/readbacks.html?kind=${kind}`,
        );
        await page.waitForFunction(() => globalThis.__maps.held.length === 1);
        await page.evaluate((action) => {
          globalThis.__maps.events.push({ type: "retire" });
          if (action === "replace") globalThis.__readbacks.epoch(1);
          else globalThis.__readbacks.visible(false);
        }, action);
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const pending = await page.evaluate(() => ({
          events: [...globalThis.__maps.events],
          published: globalThis.__readbacks.published,
        }));
        const mapped = pending.events.find((e) => e.type === "map").id;
        const destroyedWhilePending = pending.events.some((e) =>
          e.type === "destroy" && e.id === mapped
        );
        await page.evaluate(() => globalThis.__maps.releaseOne());
        await page.waitForFunction(
          (id) =>
            globalThis.__maps.events.some((e) =>
              e.type === "destroy" && e.id === id
            ),
          mapped,
        );
        if (action === "replace") {
          await page.waitForFunction(() => globalThis.__maps.held.length === 1);
          await page.evaluate(() => globalThis.__readbacks.visible(false));
          await page.evaluate(() => new Promise(requestAnimationFrame));
          await page.evaluate(() => globalThis.__maps.release());
        }
        await page.evaluate(() => globalThis.__readbacks.fence());
        const after = await page.evaluate(() => ({
          events: [...globalThis.__maps.events],
          published: globalThis.__readbacks.published,
        }));
        results.push({
          phase,
          kind,
          action,
          destroyedWhilePending,
          pending,
          after,
          errors,
        });
        console.log(
          JSON.stringify({
            phase,
            kind,
            action,
            destroyedWhilePending,
            published: after.published,
            errors,
          }),
        );
        await page.close();
      }
    }
  }
  await Deno.writeTextFile(
    new URL(
      "../../../docs/findings/evidence/2026-10-01-readback-retirement.json",
      import.meta.url,
    ),
    JSON.stringify({ browser: browser.version(), results }, null, 2) + "\n",
  );
  for (const r of results) {
    assert(
      !r.destroyedWhilePending,
      `${r.kind}/${r.action}: destroyed pending staging`,
    );
    assertEquals(r.after.published, 0, "retired map must not publish");
    assertEquals(r.errors, []);
    assertEquals(r.after.events.filter((e) => e.type === "gpu-error"), []);
  }
} finally {
  await browser?.close();
  await server.close();
}
