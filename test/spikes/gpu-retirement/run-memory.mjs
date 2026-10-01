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
  optimizeDeps: { entries: ["test/spikes/gpu-retirement/index.html"] },
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

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    const phis = [];
    const gpuErrors = [];
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await request.apply(this, args);
      device.addEventListener(
        "uncapturederror",
        (e) => gpuErrors.push(e.error.message),
      );
      return device;
    };
    const create = GPUDevice.prototype.createBuffer;
    GPUDevice.prototype.createBuffer = function (descriptor) {
      const buffer = create.call(this, descriptor);
      if (descriptor.label === "molgpu:efield:phi") {
        phis.push({ size: descriptor.size, ref: new WeakRef(buffer) });
      }
      return buffer;
    };
    globalThis.__retirement = { mark: () => {} };
    globalThis.__memory = {
      gpuErrors,
      snapshot: () =>
        phis.map(({ size, ref }) => ({ size, wrapperAlive: !!ref.deref() })),
    };
  });
  await page.goto(
    `${
      server.resolvedUrls.local[0]
    }test/spikes/gpu-retirement/index.html?memory`,
  );
  const heap = await page.context().newCDPSession(page);
  const cycles = [];
  for (let cycle = 0; cycle < 7; cycle++) {
    if (cycle) await page.evaluate(() => globalThis.__scene.visible(true));
    await page.waitForFunction(
      (count) => globalThis.__memory.snapshot().length >= count,
      cycle + 1,
    );
    const mountedRssKb = await browserRssKb();
    await page.evaluate(async () => {
      for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
      await globalThis.__scene.fence();
      globalThis.__scene.visible(false);
      for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
      await globalThis.__scene.fence();
    });
    await heap.send("HeapProfiler.collectGarbage");
    const buffers = await page.evaluate(() => globalThis.__memory.snapshot());
    cycles.push({
      rssKb: await browserRssKb(),
      mountedRssKb,
      phiSize: buffers.at(-1).size,
      aliveIndices: buffers.flatMap((entry, index) =>
        entry.wrapperAlive ? [index] : []
      ),
    });
  }
  const gpuErrors = await page.evaluate(() => globalThis.__memory.gpuErrors);
  assertEquals(gpuErrors, [], "uncaptured WebGPU errors");
  assertEquals(errors, [], "browser page and WebGPU errors");
  assert(cycles.every((cycle) => cycle.phiSize >= 23 * 1024 * 1024));
  assert(
    cycles.every((cycle, index) =>
      cycle.aliveIndices.every((retained) => retained === index)
    ),
    "a superseded EField phi wrapper remained reachable",
  );
  assert(
    cycles.every((cycle) => cycle.rssKb - cycles[0].rssKb <= 128 * 1024),
    `Chrome RSS grew beyond 128 MiB after repeated release: ${
      cycles.map((c) => c.rssKb)
    }`,
  );
  assert(
    cycles.every((cycle) =>
      cycle.mountedRssKb - cycles[0].mountedRssKb <= 256 * 1024
    ),
    "mounted RSS grew beyond 256 MiB",
  );
  const report = {
    browser: browser.version(),
    postGcGrowthBoundMiB: 128,
    mountedGrowthBoundMiB: 256,
    cycles,
    errors,
    gpuErrors,
  };
  await Deno.writeTextFile(
    new URL(
      "../../../docs/findings/evidence/2026-10-01-field-memory-churn.json",
      import.meta.url,
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.close();
}
