/**
 * WebGPU acceptance for <ElasticNetwork> (Phase 17): the first generation is
 * not ready, output is upstream plus node displacement, pause does no work,
 * style edits upload nothing, a backward step replays bitwise, a ribbon's
 * snapshot follows a pause, 1e5 steps stay bounded without rigid drift,
 * per-node RMSF matches the analytic ANM fluctuations, and replacement and
 * unmount release every buffer without WebGPU errors.
 */
import { assert, assertEquals } from "@std/assert";
import { extname, fromFileUrl, normalize } from "@std/path";
import { build } from "vite";
import { structureFromBcif } from "@molgpu/io";
import {
  buildElasticNetwork,
  caGuideRows,
  fitKabsch,
  solveElasticModes,
} from "@molgpu/dynamics";
import { launchWebGpuBrowser } from "./harness.mjs";

const KT = 0.0019872041 * 300;

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}

/** Per-node sqrt(diag(kT H+)) from `count` lowest ANM modes. */
async function anmRmsf(root, id, count, method) {
  const data = await structureFromBcif(
    await Deno.readFile(`${root}packages/io/test/fixtures/${id}.bcif`),
  );
  const rows = caGuideRows(data.topology);
  const network = buildElasticNetwork(data.positions, rows, 15);
  const modes = solveElasticModes(network, "anm", count, { method });
  const variance = new Float64Array(rows.length);
  for (const mode of modes) {
    for (let i = 0; i < mode.vector.length; i++) {
      variance[Math.floor(i / 3)] += KT * mode.vector[i] ** 2 /
        mode.eigenvalue;
    }
  }
  return Array.from(variance, Math.sqrt);
}

function rmsd(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / (a.length / 3));
}

Deno.test("elastic network", async (t) => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const fixture = `${root}packages/viewer/test/elastic`;
  const PORT = 5198;
  await build({ configFile: `${fixture}/vite.config.mjs`, logLevel: "warn" });
  for (const id of ["1crn", "1tqn", "4c7r"]) {
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
      try {
        if (!(await Deno.stat(path)).isFile) throw new Error("not a file");
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
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
      deviceScaleFactor: 1,
    });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/status of 404/.test(m.text())) {
        pageErrors.push(m.text());
      }
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => globalThis.__elastic?.mounted, null, {
      timeout: 30000,
    });
    const frames = (n = 4) =>
      page.evaluate(async (n) => {
        for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
      }, n);
    const update = (patch) =>
      page.evaluate((p) => globalThis.__elastic.update(p), patch);
    const reach = (step) =>
      page.evaluate((s) => globalThis.__elastic.reach(s), step);
    const call = (name, ...args) =>
      page.evaluate(
        ([name, args]) => globalThis.__elastic[name](...args),
        [name, args],
      );
    const counters = () =>
      page.evaluate(() => ({
        ...globalThis.__elastic.testing,
        last: null,
        counters: globalThis.__elastic.counters(),
      }));
    const healthy = async () => {
      const state = await page.evaluate(() => ({
        errors: globalThis.__elastic.errors,
        failure: globalThis.__elastic.failure,
      }));
      assertEquals(state.errors, [], "uncaptured WebGPU errors");
      assertEquals(state.failure, null);
      assertEquals(pageErrors, []);
    };

    const crambin = await call("load", "1crn");
    const upstream = await structureFromBcif(
      await Deno.readFile(`${root}packages/io/test/fixtures/1crn.bcif`),
    );
    const baseline = (await counters()).counters.ownedBuffers.live;

    await t.step(
      "first generation is not ready; step 0 is upstream",
      async () => {
        await update({ mode: "spacefill", id: "1crn", step: 0 });
        await reach(0);
        await frames(4);
        assertEquals(
          await page.evaluate(() => globalThis.__elastic.firstReady),
          false,
        );
        // Upstream reaches the kernel through the Structure's own source, which
        // is not bit-identical to the CPU array (as in run-trajectory: 1e-5).
        const out = await call("readCoordinates");
        assertEquals(out.length, upstream.positions.length);
        const worst = out.reduce(
          (m, v, i) => Math.max(m, Math.abs(v - upstream.positions[i])),
          0,
        );
        assert(worst <= 1e-5, `step 0 differs from upstream by ${worst}`);
        await healthy();
      },
    );

    await t.step("output is upstream plus node displacement", async () => {
      await update({ step: 2000 });
      const lagged = await page.evaluate(() =>
        globalThis.__elastic.status.lagging
      );
      await reach(2000);
      assert(lagged, "the 20-step budget should lag a 2000-step target");
      const nodes = await call("readNodes");
      const out = await call("readCoordinates");
      const map = new Map();
      crambin.guideRows.forEach((row, node) => map.set(row, node));
      const residueNode = new Map();
      const { atoms } = upstream.topology;
      crambin.guideRows.forEach((row, node) =>
        residueNode.set(atoms.residue[row], node)
      );
      let worst = 0, moved = 0;
      for (let i = 0; i < atoms.count; i++) {
        const node = residueNode.get(atoms.residue[i]);
        for (let c = 0; c < 3; c++) {
          const want = upstream.positions[3 * i + c] +
            (node === undefined
              ? 0
              : nodes[3 * node + c] - crambin.reference[3 * node + c]);
          worst = Math.max(worst, Math.abs(out[3 * i + c] - want));
          moved = Math.max(
            moved,
            Math.abs(out[3 * i + c] - upstream.positions[3 * i + c]),
          );
        }
      }
      assert(worst < 1e-4, `displacement mismatch ${worst}`);
      assert(moved > 0.1, "the network moved");
      await healthy();
    });

    await t.step(
      "pause dispatches nothing and requests no repaint",
      async () => {
        const before = await counters();
        await frames(30);
        const after = await counters();
        assertEquals(after.batches, before.batches);
        assertEquals(after.repaints, before.repaints);
      },
    );

    await t.step("style edits upload nothing", async () => {
      const before = await counters();
      await update({ color: [0.2, 0.4, 1, 1] });
      await frames(6);
      const after = await counters();
      assertEquals(after.batches, before.batches);
      assertEquals(
        after.counters.uploadBytes,
        before.counters.uploadBytes,
        "style edit uploaded bytes",
      );
      assertEquals(
        after.counters.geometryBuilds,
        before.counters.geometryBuilds,
      );
    });

    await t.step("a backward step replays bitwise", async () => {
      const at2000 = await call("readNodes");
      await update({ step: 2600, maxStepsPerFrame: 500 });
      await reach(2600);
      const before = await counters();
      await update({ step: 2000 });
      await reach(2000);
      const after = await counters();
      assertEquals(after.steps - before.steps, 2000, "replayed from step 0");
      assertEquals(await call("readNodes"), at2000);
      await healthy();
    });

    await t.step("a ribbon's snapshot follows a pause", async () => {
      await update({ mode: "ribbon", step: 2200 });
      await reach(2200);
      let done = false;
      for (let i = 0; i < 100 && !done; i++) {
        await frames(2);
        done = await page.evaluate(() => {
          const p = globalThis.__elastic;
          return p.snapshot?.generation === p.coordinates?.generation;
        });
      }
      assert(done, "snapshot never reached the paused generation");
      const snapshot = await page.evaluate(() =>
        globalThis.__elastic.snapshot.positions
      );
      assertEquals(snapshot, await call("readCoordinates"));
      await healthy();
    });

    for (const id of ["1crn", "4c7r"]) {
      await t.step(
        `${id}: 1e5 steps stay bounded without rigid drift`,
        async () => {
          const info = await call("load", id);
          await update({
            mode: "spacefill",
            id,
            step: 100_000,
            maxStepsPerFrame: 5000,
          });
          const started = Date.now();
          await reach(100_000);
          const seconds = (Date.now() - started) / 1000;
          const nodes = Float32Array.from(await call("readNodes"));
          assert(nodes.every(Number.isFinite));
          const reference = Float32Array.from(info.reference);
          const fit = fitKabsch(nodes, reference);
          const raw = rmsd(nodes, reference);
          console.log(
            `${id}: ${info.nodes} nodes, 1e5 steps in ${
              seconds.toFixed(1)
            } s; RMSD fitted ${fit.rmsd.toFixed(3)} Å, unfitted ${
              raw.toFixed(3)
            } Å`,
          );
          assert(fit.rmsd < 5, `fitted RMSD ${fit.rmsd}`);
          assert(raw - fit.rmsd < 0.5, `rigid drift ${raw - fit.rmsd}`);
          await healthy();
        },
      );
    }

    for (
      const [id, count, method] of [
        ["1crn", 132, "dense"],
        ["1tqn", 100, "lanczos"],
      ]
    ) {
      await t.step(`${id}: RMSF matches kT H+ (Pearson >= 0.9)`, async () => {
        await call("load", id);
        await update({
          mode: "spacefill",
          id,
          step: 2000,
          maxStepsPerFrame: 5000,
        });
        await reach(2000);
        const samples = 500, every = 100;
        const { sum, sum2 } = await call("sample", every, samples);
        const rmsf = [];
        for (let i = 0; i < sum.length / 3; i++) {
          let v = 0;
          for (let c = 0; c < 3; c++) {
            const mean = sum[3 * i + c] / samples;
            v += sum2[3 * i + c] / samples - mean * mean;
          }
          rmsf.push(Math.sqrt(Math.max(0, v)));
        }
        const oracle = await anmRmsf(root, id, count, method);
        const r = pearson(rmsf, oracle);
        console.log(
          `${id}: RMSF Pearson ${r.toFixed(3)} over ${samples * every} steps`,
        );
        assert(r >= 0.9, `${id} Pearson ${r}`);
        await healthy();
      });
    }

    await t.step(
      "checkpoint seeks are bitwise and integrate < every",
      async () => {
        await update({
          mode: "spacefill",
          id: "1crn",
          version: 10,
          step: 0,
          maxStepsPerFrame: 200,
          record: { every: 10 },
          tug: undefined,
        });
        await reach(0);
        const continuous = {};
        for (const step of [755, 905, 1000]) {
          await update({ step });
          await reach(step);
          continuous[step] = await call("readNodes");
        }
        for (const step of [755, 905, 755]) {
          const before = await counters();
          await update({ step });
          await reach(step);
          const after = await counters();
          assertEquals(after.restores - before.restores, 1, `${step} restored`);
          assert(
            after.steps - before.steps < 10,
            `${step} integrated too much`,
          );
          assertEquals(
            await call("readNodes"),
            continuous[step],
            `seek ${step}`,
          );
        }
        const status = await page.evaluate(() => globalThis.__elastic.status);
        assertEquals([status.firstStep, status.lastStep], [10, 1000]);
        await healthy();
      },
    );

    await t.step(
      "a recorded tug replays as recorded; a new tug branches",
      async () => {
        const node = 0;
        const pull = (dx) => ({
          node,
          target: [
            crambin.reference[0] + dx,
            crambin.reference[1],
            crambin.reference[2],
          ],
          k: 1,
        });
        await update({ tug: pull(3), step: 1100 });
        await reach(1100);
        const tugged = await call("readNodes");
        await update({ step: 1200 });
        await reach(1200);
        await update({ tug: undefined, step: 1400 });
        await reach(1400);
        let status = await page.evaluate(() => globalThis.__elastic.status);
        assert(status.perturbed);
        assertEquals(status.lastStep, 1400);
        await update({ step: 1100 });
        await reach(1100);
        assertEquals(await call("readNodes"), tugged, "recorded tug replay");
        status = await page.evaluate(() => globalThis.__elastic.status);
        assert(status.perturbed, "the restored history was tugged");
        // A different pull from here branches: later checkpoints are dropped.
        await update({ tug: pull(-3), step: 1150 });
        await reach(1150);
        status = await page.evaluate(() => globalThis.__elastic.status);
        assertEquals(status.lastStep, 1150);
        await healthy();
      },
    );

    await t.step(
      "before a perturbed run's retained range: clamp and report",
      async () => {
        const node = 0;
        await update({
          version: 11,
          step: 0,
          record: { every: 10, checkpoints: 5 },
          tug: {
            node,
            target: [
              crambin.reference[0] + 2,
              crambin.reference[1],
              crambin.reference[2],
            ],
            k: 1,
          },
        });
        await reach(0);
        await update({ step: 200 });
        await reach(200);
        await update({ step: 50 });
        await frames(4);
        const status = await page.evaluate(() => globalThis.__elastic.status);
        assertEquals(
          [status.evicted, status.step, status.firstStep, status.lagging],
          [true, 160, 160, false],
        );
        // Unperturbed: the same seek replays from step 0 instead.
        await update({ version: 12, step: 0, tug: undefined });
        await reach(0);
        await update({ step: 200 });
        await reach(200);
        await update({ step: 50 });
        await reach(50);
        const replayed = await page.evaluate(() => globalThis.__elastic.status);
        assertEquals([replayed.evicted, replayed.step], [false, 50]);
        await update({ record: undefined });
        await healthy();
      },
    );

    await t.step("replacement and unmount release every buffer", async () => {
      await update({
        mode: "spacefill",
        id: "1crn",
        step: 0,
        maxStepsPerFrame: 20,
      });
      await reach(0);
      await update({ step: 50_000 });
      await frames(5);
      await update({ version: 2 });
      await frames(5);
      await update({ version: 3 });
      await frames(2);
      await update({ mode: "none" });
      await frames(10);
      await page.evaluate(() =>
        globalThis.__elastic.device.queue.onSubmittedWorkDone()
      );
      await frames(5);
      const after = (await counters()).counters.ownedBuffers.live;
      assertEquals(after, baseline, "owned buffers after unmount");
      await healthy();
    });
  } finally {
    await browser?.close();
    await server.shutdown();
  }
});
