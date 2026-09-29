// Fault injection and policy comparisons only; never changes production modules.
import { createServer } from "vite";
import { chromium } from "playwright";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";
import { webgpuBrowserArgs } from "../../../packages/viewer/test/webgpu-browser-args.mjs";
import { assert } from "@std/assert";

const server = await createServer({
  root: new URL("../../../", import.meta.url).pathname,
  configFile: false,
  resolve: { alias: workspaceAliases() },
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: {
    entries: ["test/spikes/gpu-retirement/index.html"],
    esbuildOptions: {
      plugins: [{
        name: "research-raw-quads-guard",
        setup(build) {
          build.onLoad({ filter: /raw-quads\.mjs$/ }, async (args) => {
            const code = await Deno.readTextFile(args.path);
            const needle = "        mode\n    });";
            assert(code.includes(needle), "pinned RawQuads hook changed");
            return {
              contents: code.replace(
                needle,
                "        mode,\n        shouldDispatch: globalThis.__retirement?.guardFor?.()\n    });",
              ),
              loader: "js",
            };
          });
        },
      }],
    },
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
  const results = { browser: browser.version(), scenarios: [] };
  for (
    const policy of Deno.args.includes("--column")
      ? ["column"]
      : Deno.args.includes("--efield")
      ? ["efield"]
      : Deno.args.includes("--dynamic")
      ? ["dynamic"]
      : Deno.args.includes("--volume")
      ? ["volume"]
      : [
        "current",
        "two-frames",
        "reachability",
        "unguarded",
        "guarded",
        "point-guarded",
      ]
  ) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript((policy) => {
      const events = [];
      const buffers = new WeakMap();
      const records = [];
      const groups = new WeakMap();
      const encoders = new WeakMap();
      const passes = new WeakMap();
      const commands = new WeakMap();
      const devices = new WeakMap();
      const held = [];
      let armed = false;
      let guardEpoch = 0;
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
        devices.set(buffer, this);
        return buffer;
      };
      const destroy = GPUBuffer.prototype.destroy;
      GPUBuffer.prototype.destroy = function () {
        const r = info(this);
        if (!r || !r.label.startsWith("molgpu:")) return destroy.call(this);
        log("release", { id: r.id, label: r.label });
        const finish = () => {
          log("destroy", { id: r.id });
          destroy.call(this);
        };
        if (
          [
            "current",
            "column",
            "dynamic",
            "volume",
            "efield",
            "unguarded",
            "guarded",
            "point-guarded",
          ]
            .includes(policy)
        ) finish();
        if (policy === "two-frames") {
          const device = devices.get(this);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              setTimeout(() => {
                log("fence-request", { id: r.id });
                void device.queue.onSubmittedWorkDone().then(finish);
              }, 0);
            })
          );
        }
        // reachability deliberately suppresses explicit destruction in this page.
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
        passes.set(pass, { used, slots: new Map() });
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
            log("draw", { ids: [...pass.used] });
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
        if (!armed) return result;
        log("compile-held");
        return new Promise((resolve, reject) => {
          held.push(() => result.then(resolve, reject));
        });
      };
      globalThis.__retirement = {
        mark: (name) => log("mark", { name }),
        guardFor: policy === "point-guarded"
          ? () => {
            const ownEpoch = guardEpoch;
            return () => {
              const valid = ownEpoch === guardEpoch;
              log("point-guard", { ownEpoch, valid });
              return valid;
            };
          }
          : undefined,
        arm: () => {
          armed = true;
          guardEpoch++;
          log("armed");
        },
        release: () => {
          armed = false;
          log("compile-release");
          held.splice(0).forEach((release) => release());
        },
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
    }, policy);
    await page.goto(
      `${server.resolvedUrls.local[0]}test/spikes/gpu-retirement/index.html${
        ["guarded", "unguarded"].includes(policy)
          ? `?guarded&${policy}`
          : policy === "dynamic"
          ? "?dynamic"
          : policy === "volume"
          ? "?volume"
          : policy === "efield"
          ? "?efield"
          : policy === "column"
          ? "?column"
          : ""
      }`,
    );
    await page.waitForFunction(
      () => {
        const s = globalThis.__retirement.snapshot();
        const ids = s.buffers.filter((b) =>
          b.label ===
            (new URLSearchParams(location.search).has("guarded")
              ? "molgpu:guarded-face:3"
              : new URLSearchParams(location.search).has("efield")
              ? "molgpu:efield:phi"
              : new URLSearchParams(location.search).has("column")
              ? "molgpu:positions"
              : new URLSearchParams(location.search).has("volume")
              ? "molgpu:volume:values"
              : new URLSearchParams(location.search).has("dynamic")
              ? "molgpu:coords:provider"
              : "molgpu:attribute:element")
        ).map((b) => b.id);
        return s.events.some((e) =>
          (new URLSearchParams(location.search).has("efield")
            ? e.type === "draw"
            : e.type === "submit") && e.ids.some((id) => ids.includes(id))
        );
      },
      null,
      { timeout: 30000 },
    );
    await page.evaluate(() => {
      globalThis.__retirement.arm();
      globalThis.__scene.palette(1);
    });
    await page.waitForFunction(() => globalThis.__retirement.held() > 0);
    if (policy === "dynamic" || policy === "efield" || policy === "column") {
      await page.evaluate(() => globalThis.__scene.epoch(1));
    }
    if (["guarded", "unguarded"].includes(policy)) {
      await page.evaluate(() => globalThis.__scene.invalidate());
      await page.waitForFunction(() =>
        globalThis.__retirement.snapshot().events.some((e) =>
          e.type === "destroy" &&
          e.id ===
            globalThis.__retirement.snapshot().buffers.find((b) =>
              b.label === "molgpu:guarded-face:3"
            )?.id
        )
      );
    }
    // Explicitly held promise, not a timer used to infer readiness or withdrawal.
    for (let tick = 1; tick <= 8; tick++) {
      await page.evaluate((n) => globalThis.__scene.tick(n), tick);
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await page.evaluate(async () => {
      await globalThis.__scene.fence();
      globalThis.__retirement.mark("completed-fence-while-held");
    });
    await page.evaluate(() => globalThis.__scene.tick(9));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const held = await page.evaluate(() => globalThis.__retirement.snapshot());
    // Unmount molecular subtree while replacement is still unresolved.
    await page.evaluate(() => {
      globalThis.__retirement.mark("hide");
      globalThis.__scene.visible(false);
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await page.evaluate(() => globalThis.__retirement.release());
    await page.waitForTimeout(100);
    await page.evaluate(() => globalThis.__scene.tick(10));
    await page.evaluate(() => new Promise(requestAnimationFrame));
    const hidden = await page.evaluate(() =>
      globalThis.__retirement.snapshot()
    );
    if (policy === "reachability") {
      // Compare wrapper reachability across whole-Structure replacements. This
      // is NOT a measurement of native GPU memory or a production GC guarantee.
      for (let epoch = 1; epoch <= 12; epoch++) {
        await page.evaluate(() => globalThis.__scene.visible(false));
        await page.evaluate(() => new Promise(requestAnimationFrame));
        await page.evaluate((n) => {
          globalThis.__scene.epoch(n);
          globalThis.__scene.visible(true);
          globalThis.__scene.palette(n % 2);
          globalThis.__scene.tick(n + 10);
        }, epoch);
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await page.evaluate(() => globalThis.__scene.fence());
    }
    await page.evaluate(() => {
      globalThis.__retirement.mark("root-unmount");
      globalThis.__scene.unmount();
    });
    await page.waitForTimeout(100);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    const after = await page.evaluate(() => globalThis.__retirement.snapshot());
    results.scenarios.push({ policy, held, hidden, after, errors });
    await page.close();
  }
  for (const s of results.scenarios) {
    const destroyed = new Set();
    const postDestroy = [];
    for (const e of s.after.events) {
      if (e.type === "destroy") destroyed.add(e.id);
      if (e.type === "submit" && e.ids.some((id) => destroyed.has(id))) {
        postDestroy.push(e.seq);
      }
    }
    const element = s.held.buffers.find((b) =>
      b.label === (["guarded", "unguarded"].includes(s.policy)
        ? "molgpu:guarded-face:3"
        : s.policy === "efield"
        ? "molgpu:efield:phi"
        : s.policy === "column"
        ? "molgpu:positions"
        : s.policy === "volume"
        ? "molgpu:volume:values"
        : s.policy === "dynamic"
        ? "molgpu:coords:provider"
        : "molgpu:attribute:element")
    ).id;
    const fence = s.held.events.find((e) =>
      e.name === "completed-fence-while-held"
    ).seq;
    const hide = s.hidden.events.find((e) =>
      e.name === "hide"
    ).seq;
    const original = new Set(
      s.held.buffers.filter((b) => b.label.startsWith("molgpu:")).map((b) =>
        b.id
      ),
    );
    const molecular = s.after.buffers.filter((b) =>
      b.label.startsWith("molgpu:")
    );
    s.checks = {
      heldBeyondTwoFrames:
        s.held.events.at(-1).frame - s.held.events.find((e) =>
              e.type === "compile-held"
            ).frame > 2,
      oldDrawAfterCompletedFence: s.held.events.some((e) =>
        e.seq > fence && e.type === "submit" && e.ids.includes(element)
      ),
      noOldDrawAfterHide: !s.hidden.events.some((e) =>
        e.seq > hide && e.type === "submit" &&
        e.ids.some((id) => original.has(id))
      ),
      noPageErrors: s.errors.length === 0,
      oldGuardRejected: s.held.events.some((e) => e.name === "guard:3:false"),
      oldPointGuardRejected: s.held.events.some((e) =>
        e.type === "point-guard" && !e.valid
      ),
    };
    s.summary = {
      policy: s.policy,
      postDestroy,
      gpuErrors: s.after.events.filter((e) => e.type === "gpu-error").length,
      molecularAllocations: molecular.length,
      totalRequestedMolecularBytes: molecular.reduce(
        (sum, b) => sum + b.size,
        0,
      ),
      wrappersAliveAfterForcedGC: molecular.filter((b) =>
        b.wrapperAlive
      ).length,
    };
    console.log(JSON.stringify({ ...s.summary, checks: s.checks }));
  }
  await Deno.writeTextFile(
    new URL(
      Deno.args.includes("--dynamic")
        ? "../../../docs/findings/evidence/2026-09-29-dynamic-retirement.json"
        : Deno.args.includes("--column")
        ? "../../../docs/findings/evidence/2026-09-29-column-retirement.json"
        : Deno.args.includes("--efield")
        ? "../../../docs/findings/evidence/2026-09-29-efield-retirement.json"
        : Deno.args.includes("--volume")
        ? "../../../docs/findings/evidence/2026-09-29-volume-retirement.json"
        : "../../../docs/findings/evidence/2026-09-28-gpu-retirement.json",
      import.meta.url,
    ),
    JSON.stringify(
      {
        browser: results.browser,
        scenarios: results.scenarios.map((
          { policy, checks, summary, after, errors },
        ) => ({
          policy,
          checks,
          summary,
          events: after.events,
          buffers: after.buffers,
          errors,
        })),
      },
      null,
      2,
    ) + "\n",
  );
  for (const s of results.scenarios) {
    assert(
      s.checks.heldBeyondTwoFrames && s.checks.noOldDrawAfterHide &&
        s.checks.noPageErrors,
      "research preconditions/withdrawal observation failed",
    );
    if (s.policy === "efield") {
      assert(
        s.checks.oldDrawAfterCompletedFence,
        "EField replacement must retain an old phi consumer past the fence",
      );
    }
    if (s.policy === "point-guarded") {
      assert(s.checks.oldPointGuardRejected);
      assert(s.summary.gpuErrors === 0 && s.summary.postDestroy.length === 0);
    } else if (s.policy === "guarded") {
      assert(s.checks.oldGuardRejected);
      assert(s.summary.gpuErrors === 0 && s.summary.postDestroy.length === 0);
    } else if (s.policy === "unguarded") {
      assert(s.checks.oldGuardRejected);
      assert(s.summary.gpuErrors > 0 && s.summary.postDestroy.length > 0);
    } else if (s.policy === "reachability") {
      assert(s.summary.gpuErrors === 0 && s.summary.postDestroy.length === 0);
      assert(
        s.summary.molecularAllocations === 40,
        "churn must allocate fresh molecular buffers",
      );
      // GC reachability is reported, not a deterministic cleanup assertion.
    } else {
      assert(
        s.summary.gpuErrors === 0 && s.summary.postDestroy.length === 0,
        `production retirement still submits a destroyed buffer: ${s.policy}`,
      );
    }
  }
  if (Deno.args.includes("--acceptance")) {
    const current = results.scenarios.find((s) =>
      s.policy === (Deno.args.includes("--efield")
        ? "efield"
        : Deno.args.includes("--column")
        ? "column"
        : Deno.args.includes("--dynamic")
        ? "dynamic"
        : Deno.args.includes("--volume")
        ? "volume"
        : "current")
    );
    assert(
      current.summary.gpuErrors === 0 &&
        current.summary.postDestroy.length === 0,
      "Production retirement acceptance fails on unchanged code; see saved trace",
    );
  }
} finally {
  await browser?.close();
  await server.close();
}
