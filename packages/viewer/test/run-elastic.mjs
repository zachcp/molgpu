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

/** Dense CA ANM modes of a corpus structure (k = 1). */
async function anmModes(root, id) {
  const data = await structureFromBcif(
    await Deno.readFile(`${root}packages/io/test/fixtures/${id}.bcif`),
  );
  const rows = caGuideRows(data.topology);
  const network = buildElasticNetwork(data.positions, rows, 15);
  return solveElasticModes(network, "anm", 3 * rows.length - 6, {
    method: "dense",
  });
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    }
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Mean displacement of the projected harmonic network under a tug of
 * stiffness k on node p toward reference + d: minimise
 * u'Hu/2 + k|u_p - d|^2/2 over the internal (non-rigid) subspace, spanned by
 * the nonzero ANM modes V: (Λ + k V_p'V_p) a = k V_p' d, u = V a.
 */
function linearResponse(modes, p, k, d) {
  const m = modes.length;
  const A = modes.map((mi, i) =>
    modes.map((mj, j) => {
      let s = 0;
      for (let c = 0; c < 3; c++) {
        s += mi.vector[3 * p + c] * mj.vector[3 * p + c];
      }
      return (i === j ? mi.eigenvalue : 0) + k * s;
    })
  );
  const b = modes.map((mi) => {
    let s = 0;
    for (let c = 0; c < 3; c++) s += mi.vector[3 * p + c] * d[c];
    return k * s;
  });
  const a = solve(A, b);
  const u = new Float64Array(modes[0].vector.length);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < u.length; j++) u[j] += a[i] * modes[i].vector[j];
  }
  return u;
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

    await t.step(
      "a constant tug matches linear response; release re-thermalises",
      async () => {
        const modes = await anmModes(root, "1crn");
        const p = 20, k = 10, ref = crambin.reference;
        const pull = (dx, temperature, version) => ({
          mode: "spacefill",
          id: "1crn",
          version,
          step: 0,
          temperature,
          maxStepsPerFrame: 5000,
          record: undefined,
          tug: {
            node: p,
            target: [ref[3 * p] + dx, ref[3 * p + 1], ref[3 * p + 2]],
            k,
          },
        });
        // Linear response holds for small deformations: at T = 0 the run relaxes
        // to its (nonlinear-spring) equilibrium, compared after a rigid fit
        // because the Eckart-style constraint fixes only linearised rotations.
        // Measured on the CPU reference: 1.4 % at 0.1 Å, 6.6 % at 0.5 Å and
        // 23 % at 2 Å, where the springs are well outside the linear regime.
        const d = [0.2, 0, 0];
        await update(pull(d[0], 0, 20));
        await reach(0);
        await update({ step: 40_000 });
        await reach(40_000);
        const relaxed = await call("readNodes");
        const expected = linearResponse(modes, p, k, d);
        const want = Float32Array.from(ref, (r, i) => r + expected[i]);
        const fit = fitKabsch(Float32Array.from(relaxed), want);
        const m = fit.matrix;
        let diff = 0, norm = 0;
        for (let i = 0; i < relaxed.length / 3; i++) {
          const [x, y, z] = relaxed.slice(3 * i, 3 * i + 3);
          for (let c = 0; c < 3; c++) {
            const fitted = m[c] * x + m[4 + c] * y + m[8 + c] * z + m[12 + c];
            diff += (fitted - want[3 * i + c]) ** 2;
            norm += expected[3 * i + c] ** 2;
          }
        }
        const relative = Math.sqrt(diff / norm);
        console.log(
          `tug k=${k}, 0.2 Å at T=0: node moved ${
            (relaxed[3 * p] - ref[3 * p]).toFixed(4)
          } Å (linear ${expected[3 * p].toFixed(4)}); fitted error ${
            (100 * relative).toFixed(1)
          } %`,
        );
        assert(relative <= 0.1, `linear response error ${relative}`);

        // At 300 K a 2 Å pull drags the node most of the way, spring-limited.
        await update({ ...pull(2, 300, 21), tug: pull(2, 300, 21).tug });
        await reach(0);
        await update({ step: 10_000 });
        await reach(10_000);
        const { sum } = await call("sample", 50, 200);
        const moved = sum[3 * p] / 200 - ref[3 * p];
        console.log(
          `tug k=${k}, 2 Å at 300 K: node mean moved ${moved.toFixed(3)} Å`,
        );
        assert(moved > 1 && moved < 2, `pulled node moved ${moved} Å`);
        let status = await page.evaluate(() => globalThis.__elastic.status);
        assert(status.perturbed, "a tugged run reports perturbed");

        // Release, wait 5e3 steps, then average the kinetic temperature over
        // 4e4 steps. One 5e3-step window of 1crn's 46 nodes scatters by 1.4 %
        // (CPU reference, 20 windows), too wide for a 3 % bound; 4e4 steps
        // bring it to about 0.5 %.
        await update({ tug: undefined, step: 25_000 });
        await reach(25_000);
        const n = crambin.nodes, vs = 800;
        const { sum2 } = await call("sample", 50, vs, true);
        let twiceKinetic = 0;
        for (const value of sum2) twiceKinetic += 110 * value / vs;
        const measured = twiceKinetic / 418.4 / (0.0019872041 * (3 * n - 6));
        let predicted = 0;
        for (const mode of modes) {
          const omega = Math.sqrt(418.4 * mode.eigenvalue / 110);
          predicted += 1 - (omega * 0.02) ** 2 / 4;
        }
        predicted *= 300 / modes.length;
        console.log(
          `after release: kinetic ${measured.toFixed(1)} K, BAOAB prediction ${
            predicted.toFixed(1)
          } K`,
        );
        assert(
          Math.abs(measured / predicted - 1) <= 0.03,
          `kinetic ${measured} K vs ${predicted} K`,
        );
        status = await page.evaluate(() => globalThis.__elastic.status);
        assert(status.perturbed);
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
