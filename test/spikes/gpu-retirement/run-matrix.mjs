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
const results = [];
try {
  await server.listen();
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: webgpuBrowserArgs,
  });
  for (
    const owner of Deno.args.filter((arg) => !arg.startsWith("--")).length
      ? Deno.args.filter((arg) => !arg.startsWith("--"))
      : [
        "root",
        "transform",
        "trajectory",
        "normal",
        "superpose",
        "unwrap",
        "dssp",
      ]
  ) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      const events = [];
      const buffers = new WeakMap();
      const records = [];
      const groups = new WeakMap();
      const encoders = new WeakMap();
      const passes = new WeakMap();
      const commands = new WeakMap();
      const held = [];
      const initialPicking = [];
      let pickingReleased = false;
      let armed = false;
      const mapped = [];
      let frame = 0;
      const advance = () => {
        frame++;
        requestAnimationFrame(advance);
      };
      requestAnimationFrame(advance);
      const log = (type, detail = {}) =>
        events.push({
          seq: events.length,
          frame,
          type,
          ...detail,
        });
      const info = (buffer) => {
        const r = records[buffers.get(buffer)];
        if (r) r.label = buffer.label;
        return r;
      };
      const make = GPUDevice.prototype.createBuffer;
      GPUDevice.prototype.createBuffer = function (desc) {
        const buffer = make.call(this, desc);
        const id = records.length;
        records.push({
          id,
          label: buffer.label,
          size: desc.size,
          ref: new WeakRef(buffer),
        });
        buffers.set(buffer, id);
        return buffer;
      };
      const destroy = GPUBuffer.prototype.destroy;
      GPUBuffer.prototype.destroy = function () {
        const r = info(this);
        if (!r) return destroy.call(this);
        log("release", { id: r.id, label: r.label });
        const finish = () => {
          log("destroy", { id: r.id });
          destroy.call(this);
        };
        finish();
      };
      const bind = GPUDevice.prototype.createBindGroup;
      GPUDevice.prototype.createBindGroup = function (desc) {
        const group = bind.call(this, desc);
        groups.set(
          group,
          desc.entries.flatMap(({ resource }) => {
            const r = resource.buffer && info(resource.buffer);
            return r ? [r.id] : [];
          }),
        );
        return group;
      };
      const begin = GPUCommandEncoder.prototype.beginRenderPass;
      GPUCommandEncoder.prototype.beginRenderPass = function (desc) {
        const pass = begin.call(this, desc);
        const used = encoders.get(this) ?? new Set();
        encoders.set(this, used);
        passes.set(pass, { used, slots: new Map(), label: desc.label });
        return pass;
      };
      const setGroup = GPURenderPassEncoder.prototype.setBindGroup;
      GPURenderPassEncoder.prototype.setBindGroup = function (
        slot,
        group,
        ...args
      ) {
        passes.get(this)?.slots.set(slot, groups.get(group) ?? []);
        return setGroup.call(this, slot, group, ...args);
      };
      for (
        const method of [
          "draw",
          "drawIndexed",
          "drawIndirect",
          "drawIndexedIndirect",
        ]
      ) {
        const original = GPURenderPassEncoder.prototype[method];
        GPURenderPassEncoder.prototype[method] = function (...args) {
          const pass = passes.get(this);
          if (pass) {
            for (const ids of pass.slots.values()) {
              for (const id of ids) pass.used.add(id);
            }
            log("draw", {
              ids: [...new Set([...pass.slots.values()].flat())],
              pass: pass.label,
            });
          }
          return original.apply(this, args);
        };
      }
      const beginCompute = GPUCommandEncoder.prototype.beginComputePass;
      GPUCommandEncoder.prototype.beginComputePass = function (...args) {
        const pass = beginCompute.apply(this, args);
        const used = encoders.get(this) ?? new Set();
        encoders.set(this, used);
        passes.set(pass, { used, slots: new Map() });
        return pass;
      };
      const setComputeGroup = GPUComputePassEncoder.prototype.setBindGroup;
      GPUComputePassEncoder.prototype.setBindGroup = function (
        slot,
        group,
        ...args
      ) {
        passes.get(this)?.slots.set(slot, groups.get(group) ?? []);
        return setComputeGroup.call(this, slot, group, ...args);
      };
      for (
        const method of ["dispatchWorkgroups", "dispatchWorkgroupsIndirect"]
      ) {
        const original = GPUComputePassEncoder.prototype[method];
        GPUComputePassEncoder.prototype[method] = function (...args) {
          const pass = passes.get(this);
          if (pass) {
            for (const ids of pass.slots.values()) {
              for (const id of ids) pass.used.add(id);
            }
          }
          return original.apply(this, args);
        };
      }
      const copy = GPUCommandEncoder.prototype.copyBufferToBuffer;
      GPUCommandEncoder.prototype.copyBufferToBuffer = function (
        source,
        sourceOffset,
        target,
        targetOffset,
        size,
      ) {
        const used = encoders.get(this) ?? new Set();
        encoders.set(this, used);
        for (const buffer of [source, target]) {
          const r = info(buffer);
          if (r) used.add(r.id);
        }
        log("copy", { source: info(source)?.id, target: info(target)?.id });
        return copy.call(
          this,
          source,
          sourceOffset,
          target,
          targetOffset,
          size,
        );
      };
      const finish = GPUCommandEncoder.prototype.finish;
      GPUCommandEncoder.prototype.finish = function (...args) {
        const command = finish.apply(this, args);
        commands.set(command, [...(encoders.get(this) ?? [])]);
        return command;
      };
      const submit = GPUQueue.prototype.submit;
      GPUQueue.prototype.submit = function (batch) {
        log("submit", { ids: batch.flatMap((c) => commands.get(c) ?? []) });
        return submit.call(this, batch);
      };
      const request = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function (...args) {
        const device = await request.apply(this, args);
        device.addEventListener(
          "uncapturederror",
          (e) => log("gpu-error", { message: e.error.message }),
        );
        return device;
      };
      const compile = GPUDevice.prototype.createRenderPipelineAsync;
      GPUDevice.prototype.createRenderPipelineAsync = function (desc) {
        const result = compile.call(this, desc);
        // The pinned workbench uses rg32uint for picking. Hold its first
        // compilation to exercise slow startup independently of color draws.
        if (
          !pickingReleased && location.search.includes("passes") &&
          desc.fragment?.targets.some((target) => target?.format === "rg32uint")
        ) {
          log("initial-picking-held");
          return new Promise((resolve, reject) => {
            initialPicking.push(() => result.then(resolve, reject));
          });
        }
        if (!armed) return result;
        log("compile-held");
        return new Promise((resolve, reject) => {
          held.push(() => result.then(resolve, reject));
        });
      };
      {
        const compileCompute = GPUDevice.prototype.createComputePipelineAsync;
        GPUDevice.prototype.createComputePipelineAsync = function (desc) {
          const result = compileCompute.call(this, desc);
          if (!armed) return result;
          log("compute-compile-held");
          return new Promise((resolve, reject) => {
            held.push(() => result.then(resolve, reject));
          });
        };
      }
      const map = GPUBuffer.prototype.mapAsync;
      GPUBuffer.prototype.mapAsync = function (...args) {
        const result = map.apply(this, args);
        if (
          !location.search.includes("inflight") ||
          this.label !== "molgpu:dssp:bounds-readback"
        ) return result;
        log("dssp-map-pending", { id: info(this)?.id });
        return result.then(() =>
          new Promise((resolve) =>
            mapped.push(() => {
              log("dssp-map-release");
              resolve();
            })
          )
        );
      };
      const molecularDrawn = (pass) =>
        events.some((event) =>
          event.type === "draw" && event.pass?.includes(pass) &&
          event.ids.some((id) =>
            records[id]?.ref.deref()?.label.startsWith("molgpu:")
          )
        );
      const ready = () =>
        globalThis.__scene?.snapshots > 0 &&
        globalThis.__scene?.bounds > 0 && molecularDrawn("ColorPass") &&
        (!location.search.includes("passes") ||
          ["PickingPass", "ShadowPass"].every(molecularDrawn));
      globalThis.__retirement = {
        ready,
        initialPicking: () => initialPicking.length,
        releaseInitialPicking: () => {
          pickingReleased = true;
          log("initial-picking-release");
          initialPicking.splice(0).forEach((release) => release());
        },
        mark: (name) => log("mark", { name }),
        arm: () => {
          if (!ready()) {
            throw new Error("Molecular passes must draw before replacement");
          }
          armed = true;
          log("armed");
        },
        release: () => {
          armed = false;
          log("compile-release");
          held.splice(0).forEach((release) => release());
        },
        mapped: () => mapped.length,
        releaseMaps: () => mapped.splice(0).forEach((f) => f()),
        held: () => held.length,
        snapshot: () => ({
          events: [...events],
          buffers: records.map(({ ref, ...r }) => {
            const buffer = ref.deref();
            return {
              ...r,
              label: buffer?.label ?? r.label,
              wrapperAlive: !!buffer,
            };
          }),
        }),
      };
    });
    await page.goto(
      `${
        server.resolvedUrls.local[0]
      }test/spikes/gpu-retirement/matrix.html?owner=${owner}${
        Deno.args.includes("--passes") ? "&passes" : ""
      }${Deno.args.includes("--same-size") ? "&same-size" : ""}${
        Deno.args.includes("--inflight") ? "&inflight" : ""
      }`,
    );
    if (Deno.args.includes("--inflight")) {
      await page.waitForFunction(() => globalThis.__retirement.mapped() === 1);
      await page.evaluate(() => {
        globalThis.__retirement.mark("hide");
        globalThis.__scene.visible(false);
      });
      await page.evaluate(() => new Promise(requestAnimationFrame));
      await page.evaluate(() => globalThis.__retirement.releaseMaps());
      await page.waitForFunction(() =>
        globalThis.__retirement.snapshot().events.some((e) =>
          e.type === "destroy" &&
          globalThis.__retirement.snapshot().buffers.find((b) => b.id === e.id)
              ?.label === "molgpu:dssp:bounds-readback"
        )
      );
      await page.evaluate(async () => {
        await globalThis.__scene.fence();
        globalThis.__scene.unmount();
      });
    } else {
      if (Deno.args.includes("--passes")) {
        await page.waitForFunction(() =>
          globalThis.__retirement.initialPicking() > 0 &&
          globalThis.__scene?.snapshots > 0 && globalThis.__scene?.bounds > 0 &&
          globalThis.__retirement.snapshot().events.some((event) =>
            event.type === "draw"
          )
        );
        assertEquals(
          await page.evaluate(() => globalThis.__retirement.ready()),
          false,
          "held picking compilation must prevent replacement readiness",
        );
        assertEquals(
          await page.evaluate(() => {
            try {
              globalThis.__retirement.arm();
              return true;
            } catch {
              return false;
            }
          }),
          false,
          "the old any-draw barrier must not permit replacement",
        );
        await page.evaluate(() =>
          globalThis.__retirement.releaseInitialPicking()
        );
      }
      await page.waitForFunction(() => globalThis.__retirement.ready());
      if (owner === "dssp") {
        await page.waitForFunction(() => globalThis.__scene.status > 0);
      }
      await page.evaluate(() => {
        globalThis.__retirement.arm();
        globalThis.__scene.palette(1);
      });
      await page.waitForFunction(() => globalThis.__retirement.held() > 0);
      await page.evaluate(() => globalThis.__scene.epoch(1));
      for (let tick = 1; tick <= 8; tick++) {
        await page.evaluate(async (n) => {
          globalThis.__scene.tick(n);
          await new Promise(requestAnimationFrame);
        }, tick);
      }
      await page.evaluate(async () => {
        await globalThis.__scene.fence();
        globalThis.__retirement.mark("replacement-fence");
      });
      await page.evaluate(() => {
        globalThis.__retirement.mark("hide");
        globalThis.__scene.visible(false);
      });
      for (let tick = 9; tick <= 14; tick++) {
        await page.evaluate(async (n) => {
          globalThis.__scene.tick(n);
          await new Promise(requestAnimationFrame);
        }, tick);
      }
      await page.evaluate(async () => {
        await globalThis.__scene.fence();
        globalThis.__retirement.mark("hidden-fence");
        globalThis.__retirement.release();
      });
      await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        globalThis.__scene.unmount();
      });
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    const trace = await page.evaluate(() => globalThis.__retirement.snapshot());
    const destroyed = new Set();
    const postDestroy = [];
    for (const event of trace.events) {
      if (event.type === "destroy") destroyed.add(event.id);
      if (
        event.type === "submit" && event.ids.some((id) => destroyed.has(id))
      ) postDestroy.push(event);
    }
    const gpuErrors = trace.events.filter((e) => e.type === "gpu-error");
    results.push({
      owner,
      postDestroy,
      gpuErrors,
      errors,
      trace,
      publishedStatus: await page.evaluate(() => globalThis.__scene.status),
    });
    console.log(
      JSON.stringify({
        owner,
        postDestroy: postDestroy.length,
        gpuErrors: gpuErrors.length,
        errors,
      }),
    );
    await page.close();
  }
  await Deno.writeTextFile(
    new URL(
      `../../../docs/findings/evidence/2026-10-01-owner-retirement${
        Deno.args.includes("--inflight")
          ? "-inflight"
          : Deno.args.includes("--same-size")
          ? "-same-size"
          : Deno.args.includes("--passes")
          ? "-passes"
          : ""
      }.json`,
      import.meta.url,
    ),
    JSON.stringify({ browser: browser.version(), results }, null, 2) + "\n",
  );
  for (const result of results) {
    assertEquals(result.errors, [], result.owner);
    assertEquals(
      result.postDestroy,
      [],
      `${result.owner}: submissions after destruction`,
    );
    assertEquals(result.gpuErrors, [], `${result.owner}: WebGPU errors`);
    if (Deno.args.includes("--inflight")) {
      assertEquals(
        result.publishedStatus,
        0,
        "retired DSSP run must not publish",
      );
    }
    if (!Deno.args.includes("--inflight")) {
      const firstHeld = result.trace.events.find((e) =>
        e.type === "compile-held"
      );
      const lastHeld = result.trace.events.find((e) =>
        e.name === "hidden-fence"
      );
      assert(
        lastHeld.frame - firstHeld.frame > 2,
        "compilation was not held beyond two frames",
      );
      assert(result.trace.events.some((e) => e.type === "compile-held"));
      const hide = result.trace.events.find((e) => e.name === "hide").seq;
      assert(
        !result.trace.events.some((e) =>
          e.type === "draw" && e.seq > hide &&
          e.ids.some((id) =>
            result.trace.buffers.find((b) => b.id === id)?.label.startsWith(
              "molgpu:",
            )
          )
        ),
        `${result.owner}: molecular draw survived hide`,
      );
      if (result.owner === "transform") {
        assert(
          result.trace.events.some((e) => e.type === "compute-compile-held"),
          "replacement compute compilation was not held",
        );
      }
      if (Deno.args.includes("--passes")) {
        for (const pass of ["PickingPass", "ShadowPass"]) {
          assert(
            result.trace.events.some((e) =>
              e.type === "draw" && e.pass?.includes(pass) &&
              e.ids.some((id) =>
                result.trace.buffers.find((b) => b.id === id)?.label.startsWith(
                  "molgpu:",
                )
              )
            ),
            `${result.owner}: ${pass} did not draw`,
          );
        }
      }
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
