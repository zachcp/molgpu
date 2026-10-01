// Native-memory proxy for repeated EField and FieldLines mount/unmount.
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
  optimizeDeps: { entries: ["test/spikes/gpu-retirement/matrix.html"] },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: [...webgpuBrowserArgs, "--enable-automation"],
  });
  const cdp = await browser.newBrowserCDPSession();
  const commandLine = await cdp.send("Browser.getBrowserCommandLine");
  const profile = commandLine.arguments.find((arg) =>
    arg.startsWith("--user-data-dir=")
  )?.slice("--user-data-dir=".length);
  assert(profile, "dedicated Chrome profile is required for RSS attribution");
  const browserRssKb = async () => {
    const output = await new Deno.Command("ps", {
      args: ["-eo", "pid=,ppid=,rss=,command="],
    }).output();
    assertEquals(output.code, 0, "ps failed");
    const rows = new TextDecoder().decode(output.stdout).split("\n")
      .map((line) => {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
        return match && {
          pid: Number(match[1]),
          parent: Number(match[2]),
          rssKb: Number(match[3]),
          command: match[4],
        };
      }).filter(Boolean);
    const root = rows.find((row) =>
      row.command.includes(profile) && !row.command.includes("--type=")
    );
    assert(root, "dedicated Chrome process was not found");
    const pids = new Set([root.pid]);
    for (let changed = true; changed;) {
      changed = false;
      for (const row of rows) {
        if (pids.has(row.parent) && !pids.has(row.pid)) {
          pids.add(row.pid);
          changed = true;
        }
      }
    }
    return rows.filter((row) => pids.has(row.pid))
      .reduce((sum, row) => sum + row.rssKb, 0);
  };

  const results = [];
  for (const atomCount of [25000, 100000]) {
    for (const owner of ["trajectory", "normal", "superpose", "unwrap"]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.addInitScript(() => {
        const buffers = [];
        let epoch = 0;
        const create = GPUDevice.prototype.createBuffer;
        GPUDevice.prototype.createBuffer = function (desc) {
          const b = create.call(this, desc);
          buffers.push({
            epoch,
            size: desc.size,
            label: desc.label ?? "",
            ref: new WeakRef(b),
          });
          return b;
        };
        const request = GPUAdapter.prototype.requestDevice;
        GPUAdapter.prototype.requestDevice = async function (...args) {
          const device = await request.apply(this, args);
          device.addEventListener(
            "uncapturederror",
            (e) => globalThis.__memory.errors.push(e.error.message),
          );
          return device;
        };
        globalThis.__memory = {
          errors: [],
          epoch: (n) => {
            epoch = n;
          },
          snapshot: () =>
            buffers.flatMap(({ ref, ...r }) => {
              const b = ref.deref();
              if (b) r.label = b.label;
              return r.label.startsWith("molgpu:") ||
                  r.label.startsWith("coords:normal-mode:")
                ? [{ ...r, alive: !!b }]
                : [];
            }),
        };
      });
      let sampledPeakRssKb = 0;
      let sample = Promise.resolve();
      const sampler = setInterval(() => {
        sample = sample.then(async () => {
          sampledPeakRssKb = Math.max(sampledPeakRssKb, await browserRssKb());
        });
      }, 100);
      try {
        await page.goto(
          `${
            server.resolvedUrls.local[0]
          }test/spikes/gpu-retirement/matrix.html?owner=${owner}&count=${atomCount}`,
        );
        const heap = await page.context().newCDPSession(page);
        const cycles = [];
        for (let cycle = 0; cycle < 7; cycle++) {
          if (cycle) {
            await page.evaluate((n) => {
              globalThis.__memory.epoch(n);
              globalThis.__scene.epoch(n);
              globalThis.__scene.visible(true);
            }, cycle);
          }
          await page.waitForFunction(
            (n) => globalThis.__scene.readyEpoch === n,
            cycle,
            { timeout: 60000 },
          );
          await page.evaluate(() => {
            globalThis.__memory.snapshot();
            return globalThis.__scene.fence();
          });
          const mountedRssKb = await browserRssKb();
          // Replacement occurs while mounted; then each second cycle fully hides.
          if (cycle % 2 === 0 || cycle === 6) {
            await page.evaluate(() => globalThis.__scene.visible(false));
            await page.evaluate(() => new Promise(requestAnimationFrame));
            await page.evaluate(() => globalThis.__scene.fence());
          }
          await heap.send("HeapProfiler.collectGarbage");
          const buffers = await page.evaluate(() =>
            globalThis.__memory.snapshot()
          );
          cycles.push({
            cycle,
            mountedRssKb,
            sampledPeakRssKb,
            postGcRssKb: await browserRssKb(),
            allocatedBytes: buffers.reduce((sum, b) => sum + b.size, 0),
            aliveBytes: buffers.filter((b) => b.alive).reduce(
              (sum, b) => sum + b.size,
              0,
            ),
            supersededAlive: buffers.filter((b) =>
              b.alive && b.epoch < cycle - 1
            ),
            labels: [...new Set(buffers.map((b) => b.label))],
          });
        }
        await page.evaluate(() => globalThis.__scene.unmount());
        await heap.send("HeapProfiler.collectGarbage");
        const finalBuffers = await page.evaluate(() =>
          globalThis.__memory.snapshot()
        );
        const gpuErrors = await page.evaluate(() => globalThis.__memory.errors);
        const report = {
          owner,
          atomCount,
          cycles,
          finalAliveBytes: finalBuffers.filter((b) => b.alive).reduce(
            (sum, b) => sum + b.size,
            0,
          ),
          finalAlive: finalBuffers.filter((b) => b.alive),
          errors,
          gpuErrors,
        };
        results.push(report);
        console.log(JSON.stringify({
          sampledPeakRssKb,
          owner,
          atomCount,
          postGcRssKb: cycles.map((c) => c.postGcRssKb),
          mountedRssKb: cycles.map((c) => c.mountedRssKb),
          aliveBytes: cycles.map((c) => c.aliveBytes),
          finalAlive: report.finalAlive,
          errors,
          gpuErrors,
        }));
      } finally {
        clearInterval(sampler);
        await sample;
        await page.close();
      }
    }
  }
  await Deno.writeTextFile(
    new URL(
      "../../../docs/findings/evidence/2026-10-01-coordinate-memory-churn.json",
      import.meta.url,
    ),
    JSON.stringify(
      {
        browser: browser.version(),
        postGcGrowthBoundMiB: 128,
        peakGrowthBoundMiB: 256,
        results,
      },
      null,
      2,
    ) + "\n",
  );
  for (const r of results) {
    assertEquals(r.errors, [], r.owner);
    assertEquals(r.gpuErrors, [], r.owner);
    assert(
      r.cycles.every((c) => c.supersededAlive.length === 0),
      `${r.owner}: wrappers older than the previous generation retained`,
    );
    assert(
      r.cycles.every((c) => c.aliveBytes <= r.atomCount * 256),
      `${r.owner}: reachable molecular buffers exceed 256 bytes per atom`,
    );
    assert(
      r.finalAliveBytes <= r.atomCount * 4 + 64,
      `${r.owner}: final wrappers exceed one immutable column`,
    );
    assert(
      r.finalAlive.every((b) => b.label === "molgpu:attribute:element"),
      `${r.owner}: a dynamic buffer survived root unmount`,
    );
    // Cycle 0 warms the renderer. Compare every later sample, not only endpoints.
    const warm = r.cycles[0];
    assert(
      r.cycles.every((c) => c.postGcRssKb - warm.postGcRssKb <= 128 * 1024),
      `${r.owner}: post-GC RSS exceeds 128 MiB growth`,
    );
    assert(
      r.cycles.every((c) =>
        c.sampledPeakRssKb - warm.sampledPeakRssKb <= 256 * 1024
      ),
      `${r.owner}: mounted RSS exceeds 256 MiB growth`,
    );
  }
} finally {
  await browser?.close();
  await server.close();
}
