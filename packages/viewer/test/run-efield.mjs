/**
 * WebGPU acceptance for Phase 16 electric fields: <EField> matches the f64
 * CPU Coulomb reference on the GPU for every dielectric model, follows a
 * coordinate provider and a trajectory with no CPU round trip, coalesces
 * bursts of generations, and feeds <Isosurface>, <VolumeSlice>,
 * surface colouring, <FieldLines> and <FieldArrows>. Part of
 * `deno task test:components`.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { extname, fromFileUrl, normalize } from "@std/path";
import { build } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";
import { coulombField } from "../../dynamics/src/electrostatics.ts";

/**
 * max |gpu − cpu| / max |cpu|: f32 tiles cannot hold pointwise relative error
 * where φ crosses zero (plan counter-review finding 5).
 */
function relativeError(gpu, cpu) {
  let peak = 0, worst = 0;
  for (let i = 0; i < cpu.length; i++) {
    peak = Math.max(peak, Math.abs(cpu[i]));
    worst = Math.max(worst, Math.abs(gpu[i] - cpu[i]));
  }
  return worst / peak;
}

Deno.test("electric fields", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const fixture = `${root}packages/viewer/test/efield`;
  const out = `${root}packages/viewer/test/results`;
  const PORT = 5197;
  await Deno.mkdir(out, { recursive: true });
  await build({ configFile: `${fixture}/vite.config.mjs`, logLevel: "warn" });
  for (const id of ["1crn", "1a4y"]) {
    await Deno.copyFile(
      `${root}packages/io/test/fixtures/${id}.bcif`,
      `${fixture}/dist/${id}.bcif`,
    );
  }

  const server = Deno.serve(
    { port: PORT, hostname: "127.0.0.1", onListen() {} },
    async (req) => {
      const name = normalize(decodeURIComponent(new URL(req.url).pathname));
      const path = `${fixture}/dist${name === "/" ? "/index.html" : name}`;
      let info;
      try {
        info = await Deno.stat(path);
        if (!info.isFile) throw new Error("not a file");
      } catch {
        return new Response("not found", { status: 404 });
      }
      const type = { ".html": "text/html", ".js": "text/javascript" }[
        extname(path)
      ] ?? "application/octet-stream";
      const file = await Deno.open(path, { read: true });
      return new Response(file.readable, {
        headers: { "content-type": type },
      });
    },
  );
  const report = { date: new Date().toISOString(), states: {} };
  let browser;
  try {
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: webgpuBrowserArgs,
    });
    const page = await browser.newPage({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/status of 404/.test(m.text())) {
        errors.push(m.text());
      }
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => window.__efield?.mounted, null, {
      timeout: 30000,
    }).catch((failure) => {
      throw new Error(`not mounted: ${JSON.stringify(errors)}`, {
        cause: failure,
      });
    });

    const frames = (n = 8) =>
      page.evaluate(async (n) => {
        for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
      }, n);
    const update = async (patch) => {
      await page.evaluate((p) => window.__efield.update(p), patch);
      await frames();
    };
    const ready = () =>
      page.waitForFunction(() => window.__efield.phase === "ready", null, {
        timeout: 30000,
      }).catch(async (failure) => {
        const state = await page.evaluate(() => ({
          phase: window.__efield.phase,
          failure: window.__efield.failure,
          errors: window.__efield.errors,
        }));
        throw new Error(`not ready: ${JSON.stringify(state)} ${errors}`, {
          cause: failure,
        });
      });
    // Wait until the potential stops changing between frames.
    const settledPotential = async () => {
      let previous = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        await frames(4);
        const values = await page.evaluate(() =>
          window.__efield.readPotential()
        );
        if (previous && values.every((v, i) => v === previous[i])) {
          return values;
        }
        previous = values;
      }
      throw new Error("potential never settled");
    };
    const counters = () => page.evaluate(() => window.__efield.counters());
    const classify = (png) =>
      page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bmp.width, bmp.height),
          ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
        let red = 0, blue = 0, lit = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (r + g + b > 90) lit++;
          if (r > b + 60 && r > g + 60) red++;
          if (b > r + 60 && b > g + 30) blue++;
        }
        return { red, blue, lit };
      }, png.toString("base64"));
    const delta = (after, before, key) =>
      (after.detail[key] ?? 0) - (before.detail[key] ?? 0);
    const parity = async (which, extra, tolerance = 1e-4) => {
      const gpu = await settledPotential();
      const cpu = await page.evaluate(
        ([w, e]) => window.__efield.cpuPotential(w, e),
        [which, extra],
      );
      assertStrictEquals(gpu.length, cpu.length);
      const error = relativeError(gpu, cpu);
      assert(error < tolerance, `${which} GPU vs CPU: ${error}`);
      return { error, peak: Math.max(...cpu.map(Math.abs)) };
    };

    // 1. Every dielectric model matches the f64 reference on a 300-atom
    //    cloud of alternating charges.
    report.states.models = {};
    for (
      const physics of [
        {},
        { model: "vacuum" },
        { model: "debye", ionicStrength: 0.1 },
        { model: "distance", unit: "kcal/mol/e", minDistance: 0.5 },
      ]
    ) {
      await update({ mode: "none" });
      await update({ mode: "random", physics });
      await ready();
      report.states.models[JSON.stringify(physics)] = await parity(
        "random",
        {},
      );
    }
    const grid = await page.evaluate(() => window.__efield.grid);
    report.states.grid = { dims: grid.dims, unit: grid.unit };
    assertStrictEquals(grid.unit, "kcal/mol/e");

    // A ready root buffer needs no timed settling recomputations.
    let before = await counters();
    await page.waitForTimeout(1150);
    let now = await counters();
    assertStrictEquals(delta(now, before, "gathers:efield:dispatch"), 0);

    // A distant neutral atom does not expand the automatic charge grid.
    await update({ mode: "none", physics: {} });
    await update({ mode: "sparse" });
    await ready();
    assertEquals(await page.evaluate(() => window.__efield.grid.dims), [
      17,
      17,
      17,
    ]);
    await parity("sparse", {});

    // 2. Altloc B copies are not summed (first model, primary conformer).
    await update({ mode: "none", physics: {} });
    await update({ mode: "altloc" });
    await ready();
    await parity("altloc", {});

    // 3. Under a coordinate provider the potential follows each generation on
    //    the GPU: no coordinate snapshot and no volume readback.
    await update({ mode: "none" });
    before = await counters();
    await update({ mode: "wobble", phase: 0 });
    await ready();
    await parity("wobble", { phase: 0 });
    const gridBefore = await page.evaluate(() => window.__efield.grid.dims);
    for (const phase of [0.7, 1.9]) {
      await update({ phase });
      await parity("wobble", { phase });
    }
    now = await counters();
    assertEquals(
      await page.evaluate(() => window.__efield.grid.dims),
      gridBefore,
      "the grid stays locked while coordinates move",
    );
    assert(delta(now, before, "gathers:efield:dispatch") >= 3);
    for (
      const key of [
        "gathers:coords:snapshot:dispatch",
        "gathers:efield:snapshot:dispatch",
      ]
    ) {
      assertStrictEquals(
        delta(now, before, key),
        0,
        `${key}: no CPU round trip`,
      );
    }

    // 4. One computation in flight: while it is held, new generations only
    //    mark it pending; on release the newest one is computed.
    before = await counters();
    await page.evaluate(() => window.__efield.hold());
    await update({ phase: 2.1 });
    for (const phase of [2.2, 2.3, 2.4]) await update({ phase });
    now = await counters();
    assertStrictEquals(
      delta(now, before, "gathers:efield:dispatch"),
      1,
      "held: later generations wait",
    );
    await page.evaluate(() => window.__efield.release());
    await parity("wobble", { phase: 2.4 });
    now = await counters();
    report.states.coalesce = {
      updates: 4,
      dispatches: delta(now, before, "gathers:efield:dispatch"),
    };
    assertStrictEquals(report.states.coalesce.dispatches, 2, "latest wins");

    // 4b. Many sample-range dispatches in one submission match one.
    await update({ mode: "none" });
    await page.evaluate(() => window.__efield.dispatchPairs(300 * 64 * 10));
    await update({ mode: "random", physics: { model: "vacuum" } });
    await ready();
    report.states.chunked = await parity("random", {});
    await page.evaluate(() => window.__efield.dispatchPairs(2 ** 28));
    await update({ physics: {} });

    // 5. Scrubbing a trajectory recomputes for the displayed frame.
    await update({ mode: "none" });
    await update({ mode: "trajectory", frame: 0 });
    await ready();
    for (const frame of [0, 2, 1]) {
      await update({ frame });
      await page.waitForTimeout(100);
      await parity("trajectory", { frame });
    }

    // 6. Isosurfaces are meshed from throttled snapshots, the only readback.
    await update({ mode: "none" });
    before = await counters();
    await update({ mode: "iso", phase: 0 });
    await ready();
    await frames(30);
    now = await counters();
    assert(delta(now, before, "gathers:efield:snapshot:publish") >= 1);
    assert(delta(now, before, "geometryBuilds:isosurface:mesh") >= 2);
    const shot = await page.locator("canvas").screenshot({
      path: `${out}/efield-iso.png`,
    });
    assert(shot.length > 0);

    // 7. A slice under <EField> draws live samples; moving it uploads nothing.
    await update({ mode: "none" });
    await update({ mode: "slice", planeIndex: 8 });
    await ready();
    // Past the settling recomputes after a new coordinate buffer.
    await page.waitForTimeout(1200);
    await frames(10);
    before = await counters();
    await update({ planeIndex: 10 });
    now = await counters();
    assertStrictEquals(
      now.uploadBytes,
      before.uploadBytes,
      "no upload on move",
    );
    assertStrictEquals(delta(now, before, "gathers:efield:dispatch"), 0);
    await page.locator("canvas").screenshot({
      path: `${out}/efield-slice.png`,
    });

    // 8. 1CRN with AMBER template charges, at the default 1 Å grid.
    await page.evaluate(() => window.__efield.load("/1crn.bcif"));
    await update({ mode: "none" });
    await update({ mode: "crambin", physics: {} });
    await ready();
    report.states.crambin = await parity("crambin", {});
    report.states.crambin.dims = await page.evaluate(() =>
      window.__efield.grid.dims
    );

    // 9. <Surface color={byPotential()}> colours 1CRN red and blue live.
    await update({ mode: "none" });
    const center = await page.evaluate(() => window.__efield.center);
    await update({ mode: "surface", target: center, radius: 55 });
    await ready();
    await frames(60);
    await page.waitForTimeout(1500);
    await frames(10);
    const surface = await classify(
      await page.locator("canvas").screenshot({
        path: `${out}/efield-surface.png`,
      }),
    );
    report.states.surface = surface;
    assert(surface.red > 200 && surface.blue > 200, JSON.stringify(surface));
    before = await counters();
    await update({ sampleOffset: 2 });
    now = await counters();
    assertStrictEquals(
      now.uploadBytes,
      before.uploadBytes,
      "offset is a uniform",
    );
    assertStrictEquals(now.geometryBuilds, before.geometryBuilds, "no remesh");

    // 10. 1A4Y: ribonuclease inhibitor (chain A) is negative and angiogenin
    //     (chain B) positive, each computed alone, as published.
    await page.evaluate(() => window.__efield.load("/1a4y.bcif"));
    await update({
      target: await page.evaluate(() => window.__efield.center),
      radius: 130,
    });
    report.states.complementarity = {};
    for (const [chain, sign, pinned] of [["A", -1, -9.3], ["B", 1, 5.6]]) {
      await update({ mode: "none" });
      await update({ mode: "select", chain, sampleOffset: 1.4 });
      await ready();
      await settledPotential();
      const stats = await page.evaluate(
        (c) => window.__efield.surfaceStats(c),
        chain,
      );
      report.states.complementarity[chain] = stats;
      assert(sign * stats.mean > 1, `${chain}: ${JSON.stringify(stats)}`);
      assert(
        Math.abs(stats.mean - pinned) < 1.5,
        `${chain} pinned ${pinned}: ${stats.mean}`,
      );
      await page.locator("canvas").screenshot({
        path: `${out}/efield-1a4y-${chain}.png`,
      });
    }

    // 11. Field lines of an ideal ± pair keep cos θ₊ − cos θ₋ constant.
    await update({ mode: "none", target: [0, 0, 0], radius: 40 });
    await update({ mode: "lines" });
    await ready();
    await page.waitForTimeout(1200);
    await settledPotential();
    await frames(4);
    const { vertices } = await page.evaluate(() => window.__efield.readLines());
    const span = 2 * 160 + 1;
    const drift = [];
    for (let l = 0; l < vertices.length / 4 / span; l++) {
      const values = [];
      for (let k = 0; k < span; k++) {
        const o = (l * span + k) * 4;
        if (vertices[o + 3] < 0) continue;
        const [x, y, z] = [vertices[o], vertices[o + 1], vertices[o + 2]];
        const rp = Math.hypot(x + 3, y, z), rm = Math.hypot(x - 3, y, z);
        if (rp < 1.5 || rm < 1.5) continue;
        values.push((x + 3) / rp - (x - 3) / rm);
      }
      assert(values.length > 20, `line ${l} traced: ${values.length}`);
      drift.push(Math.max(...values) - Math.min(...values));
    }
    report.states.lines = { drift };
    assert(Math.max(...drift) < 0.02, `dipole invariant: ${drift}`);
    before = await counters();
    await update({ lineRange: [0.5, 5] });
    now = await counters();
    assertStrictEquals(delta(now, before, "gathers:fieldLines:dispatch"), 0);
    assertStrictEquals(now.geometryBuilds, before.geometryBuilds);
    assertStrictEquals(
      now.uploadBytes,
      before.uploadBytes,
      "ramp range is a uniform",
    );
    await page.locator("canvas").screenshot({
      path: `${out}/efield-lines.png`,
    });

    // 12. Arrows point along E with length min(|E|·scale, cap); moving the
    //     plane writes uniforms only.
    await update({ mode: "none" });
    await update({ mode: "arrows", planeIndex: 12, arrowScale: 1 });
    await ready();
    await page.waitForTimeout(1200);
    await settledPotential();
    const { ends } = await page.evaluate(() =>
      window.__efield.arrowEnds(12, 2, 1, 1.8)
    );
    let checked = 0;
    for (let a = 0; a < ends.length / 8; a++) {
      const tail = ends.slice(a * 8, a * 8 + 3);
      const head = ends.slice(a * 8 + 4, a * 8 + 7);
      const r = Math.hypot(...tail);
      if (r < 1.5 || Math.max(...tail.map(Math.abs)) > 4.5) continue;
      const e = coulombField(tail, [0, 0, 0, 1], { model: "vacuum" });
      const m = Math.hypot(...e);
      const d = head.map((h, i) => h - tail[i]);
      const len = Math.hypot(...d);
      const expected = Math.min(m, 1.8);
      assert(
        Math.abs(len - expected) < 0.05 * expected,
        `arrow ${a}: ${len} vs ${expected}`,
      );
      const cos = (d[0] * e[0] + d[1] * e[1] + d[2] * e[2]) / (len * m);
      assert(cos > 0.995, `arrow ${a} direction ${cos}`);
      checked++;
    }
    report.states.arrows = { checked };
    assert(checked >= 4, `arrows checked: ${checked}`);
    await frames(10);
    before = await counters();
    await update({ planeIndex: 16, arrowScale: 2 });
    now = await counters();
    for (
      const key of [
        "uploadBytes",
        "allocations",
        "geometryBuilds",
        "shaderBuilds",
      ]
    ) {
      assertStrictEquals(now[key], before[key], `plane move: no ${key}`);
    }
    await page.locator("canvas").screenshot({
      path: `${out}/efield-arrows.png`,
    });

    // 13. Throughput at the plan's budget case: a 128³ grid (timed after
    //     the settling recomputes, so pipelines are warm). A software
    //     adapter (CI SwiftShader) sets MOLGPU_SKIP_TIMING: ~1e11 pairs there
    //     would take hours and measure nothing about real hardware.
    report.states.timing = [];
    const timingCases = Deno.env.get("MOLGPU_SKIP_TIMING") === "1" ? [] : [
      [5000, {}],
      [50000, {}],
      [50000, { model: "debye" }],
    ];
    for (const [atoms, physics] of timingCases) {
      await update({ mode: "none", target: [0, 0, 0], radius: 40 });
      await update({ mode: "perf", perfAtoms: atoms, physics, phase: 0 });
      await ready();
      await page.waitForTimeout(1500);
      await page.evaluate(() =>
        window.__efield.device.queue.onSubmittedWorkDone()
      );
      const ms = [];
      for (const phase of [0.3, 0.6, 0.9]) {
        ms.push(
          await page.evaluate((p) => window.__efield.timeRecompute(p), phase),
        );
      }
      const best = Math.min(...ms);
      const pairs = 128 ** 3 * atoms;
      report.states.timing.push({
        atoms,
        model: physics.model ?? "distance",
        samples: 128 ** 3,
        ms: best,
        pairsPerSecond: pairs / (best / 1000),
      });
    }
    await update({ mode: "none", physics: {} });

    assertEquals(
      await page.evaluate(() => window.__efield.errors),
      [],
      "no WebGPU errors",
    );
    report.status = "passed";
    console.log(JSON.stringify(report));
  } finally {
    await Deno.writeTextFile(
      `${out}/efield.json`,
      JSON.stringify(report, null, 2),
    );
    await browser?.close();
    await server.shutdown();
  }
});
