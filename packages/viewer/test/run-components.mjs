/**
 * Acceptance runner for <Molecule>/<Structure>/<Spacefill>.
 *
 * It typechecks the .tsx consumer, builds it with vite, serves the bundle, and
 * drives every state the components claim to support in a real Chrome WebGPU
 * tab: a preloaded dataset that must not fetch Mol*, a pinned BCIF protein,
 * sibling isolation, empty/loading/error states, replaced and unmounted
 * sources, and the uncaptured WebGPU error channel.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";

Deno.test("viewer components", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const fixture = `${root}packages/viewer/test/tsx`;
  const out = `${root}packages/viewer/test/results`;
  const PORT = 5187;
  const TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".wasm": "application/wasm",
    ".bcif": "application/octet-stream",
  };
  await mkdir(out, { recursive: true });

  const report = {
    date: new Date().toISOString(),
    status: "running",
    states: {},
  };
  await writeFile(`${out}/components.json`, JSON.stringify(report));

  const typecheck = spawnSync(Deno.execPath(), [
    "check",
    `${fixture}/consumer.tsx`,
    `${fixture}/diagnostics.ts`,
  ], { cwd: root, encoding: "utf8" });
  if (typecheck.status !== 0) {
    throw new Error(
      `Deno check failed:\n${typecheck.stdout}${typecheck.stderr}`,
    );
  }
  report.typecheck = "passed";
  await build({ configFile: `${fixture}/vite.config.mjs`, logLevel: "warn" });
  report.build = "passed";

  // Serve the built bundle plus the pinned corpus, so `src` fetches real bytes.
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const name = normalize(decodeURIComponent(url.pathname));
    const path = name.startsWith("/fixtures/")
      ? `${root}packages/io/test${name}`
      : name.startsWith("/site/assets/")
      ? `${root}${name}`
      : `${fixture}/dist${name === "/" ? "/index.html" : name}`;
    try {
      if (!(await stat(path)).isFile()) throw new Error("not a file");
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] ?? "application/octet-stream",
    });
    createReadStream(path).pipe(res);
  });

  let browser;
  try {
    await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
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
    // The error-state check deliberately requests an absent structure, so its
    // transport failure is counted rather than silenced.
    const notFound = [];
    const requests = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      (/status of 404/.test(m.text()) ? notFound : errors).push(m.text());
    });
    page.on("request", (r) => requests.push(r.url()));
    const molstar = () =>
      requests.filter((url) => url.includes("/molstar-")).length;

    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => window.__viewer?.mounted, null, {
      timeout: 30000,
    });
    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
      });
    const snapshot = () => page.evaluate(() => window.__viewer.snapshot());
    const shot = () => page.locator("canvas").screenshot();
    const readCoordinates = () =>
      page.evaluate(async () => {
        const { coordinateSource: source, device } = window.__viewer;
        if (!source || !device) throw new Error("missing coordinate source");
        const staging = device.createBuffer({
          size: source.length * 12,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(
          source.buffer,
          0,
          staging,
          0,
          source.length * 12,
        );
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const values = Array.from(
          new Float32Array(staging.getMappedRange().slice(0)),
        );
        staging.unmap();
        staging.destroy();
        return values;
      });
    const readBondVertices = () =>
      page.evaluate(async () => {
        const { bondSource: source, device } = window.__viewer;
        if (!source || !device) throw new Error("missing bond vertex source");
        const bytes = source.length * 4;
        const staging = device.createBuffer({
          size: bytes,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(source.buffer, 0, staging, 0, bytes);
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const values = Array.from(
          new Float32Array(staging.getMappedRange().slice(0)),
        );
        staging.unmap();
        staging.destroy();
        return values;
      });
    const update = async (patch, keepHistory = false) => {
      await page.evaluate(([p, keep]) => {
        if (!keep) window.__viewer.reset();
        window.__viewer.update(p);
      }, [patch, keepHistory]);
      await settle();
    };
    const until = async (predicate) =>
      page.waitForFunction(predicate, null, { timeout: 30000 }).then(settle);

    // Count lit blobs on the canvas itself; PNG bytes and DOM state prove nothing.
    // Two identical consecutive frames are required first, so a state is measured
    // after its transient resource work has reached a fixed point.
    const analyze = (png) =>
      page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bmp.width, bmp.height),
          ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const w = canvas.width, mask = new Uint8Array(w * canvas.height);
        for (let i = 0; i < mask.length; i++) {
          mask[i] = data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] > 90
            ? 1
            : 0;
        }
        const blobs = [];
        for (let i = 0; i < mask.length; i++) {
          if (mask[i]) {
            const queue = [i];
            mask[i] = 0;
            let size = 0, sx = 0;
            for (let q = 0; q < queue.length; q++) {
              const k = queue[q];
              size++;
              sx += k % w;
              for (
                const j of [
                  k - w,
                  k + w,
                  ...(k % w ? [k - 1] : []),
                  ...(k % w < w - 1 ? [k + 1] : []),
                ]
              ) {
                if (j >= 0 && j < mask.length && mask[j]) {
                  mask[j] = 0;
                  queue.push(j);
                }
              }
            }
            if (size > 50) blobs.push({ size, x: Math.round(sx / size) });
          }
        }
        return blobs.sort((a, b) => b.size - a.size);
      }, png.toString("base64"));

    const blobs = async (label, name) => {
      const shot = (path) =>
        page.locator("canvas").screenshot(path ? { path } : {});
      await settle();
      let previous = await shot();
      for (let attempt = 0; attempt < 12; attempt++) {
        await settle();
        const current = await shot(name ? `${out}/${name}.png` : undefined);
        if (current.equals(previous)) return analyze(current);
        previous = current;
      }
      throw new Error(`${label} never reached a settled frame`);
    };

    // 1. Preloaded StructureData draws, and never reaches for the BCIF parser.
    const preloaded = await blobs("preloaded", "components-preloaded");
    assert.equal(preloaded.length, 1, "preloaded structure draws one cluster");
    assert.match(
      await page.evaluate(() => window.__viewer.missingCoordinatesError),
      /Required context 'CoordinatesContext' was used without being provided/,
      "useCoordinates outside Structure reports a composition error",
    );
    assert.equal(molstar(), 0, "a preloaded dataset must not load Mol*");
    assert.deepEqual(
      await page.evaluate(() => window.__viewer.rootPositionReads),
      { cpu: "ok", gpu: "ok" },
      "root-only trees may read root positions",
    );
    report.states.preloaded = { blobs: preloaded, molstarRequests: 0 };

    const ownedBefore = await page.evaluate(() =>
      window.__viewer.counters().ownedBuffers.live
    );
    await update({ mode: "offset" });
    let positions = [];
    const expectedCoordinates = [-13, 1, 0, -10, 1, 0, -7, 1, 0];
    for (let attempt = 0; attempt < 12; attempt++) {
      positions = await readCoordinates();
      if (positions.every((value, i) => value === expectedCoordinates[i])) {
        break;
      }
      await settle();
    }
    assert.deepEqual(
      positions,
      expectedCoordinates,
      "the two offsets compose exactly in the GPU buffer",
    );
    const guardedReads = await page.evaluate(() =>
      window.__viewer.rootPositionReads
    );
    assert.match(
      guardedReads.cpu,
      /useCoordinates\(\) or useCoordinateSnapshot\(\)/,
    );
    assert.match(
      guardedReads.gpu,
      /useCoordinates\(\) or useCoordinateSnapshot\(\)/,
    );
    let offsetBlobs = await blobs("offset", "components-offset");
    for (let attempt = 0; attempt < 12; attempt++) {
      if (
        offsetBlobs.length === 1 &&
        offsetBlobs[0].x > preloaded[0].x + 20 &&
        offsetBlobs[0].x < preloaded[0].x + 45
      ) break;
      await settle();
      offsetBlobs = await blobs("offset", "components-offset");
    }
    assert.equal(offsetBlobs.length, 1, "the provider chain draws Spacefill");
    assert.ok(
      offsetBlobs[0].x > preloaded[0].x + 20 &&
        offsetBlobs[0].x < preloaded[0].x + 45,
      "the chained offset moves the Spacefill draw",
    );
    const firstDispatches = await page.evaluate(() =>
      window.__viewer.dispatches
    );
    assert.equal(firstDispatches, 2, "one dispatch per offset provider");
    await settle();
    assert.equal(
      await page.evaluate(() => window.__viewer.dispatches),
      firstDispatches,
      "unchanged content does not redispatch",
    );
    const uploadsBefore = await page.evaluate(() =>
      window.__viewer.counters().uploadBytes
    );
    await page.evaluate(() => window.__viewer.update({ offsetX: 6 }));
    let visibilityFrame = null;
    const observed = [];
    for (let frame = 1; frame <= 10; frame++) {
      await page.evaluate(() => new Promise(requestAnimationFrame));
      const drawn = await analyze(await page.locator("canvas").screenshot());
      observed.push(drawn);
      if (drawn.length === 1 && drawn[0].x > offsetBlobs[0].x + 5) {
        visibilityFrame = frame;
        break;
      }
    }
    assert.ok(
      visibilityFrame !== null,
      `updated coordinates reach the draw: before=${
        JSON.stringify(offsetBlobs)
      } observed=${JSON.stringify(observed)}`,
    );
    await settle();
    assert.deepEqual(
      await readCoordinates(),
      [-12, 1, 0, -9, 1, 0, -6, 1, 0],
      "changing a parameter republishes both provider generations",
    );
    assert.equal(
      await page.evaluate(() => window.__viewer.dispatches),
      firstDispatches + 2,
      "each changed provider dispatches once",
    );
    assert.equal(
      await page.evaluate(() => window.__viewer.counters().uploadBytes),
      uploadsBefore,
      "coordinate updates do not upload topology or style data",
    );
    await update({ mode: "preloaded" });
    assert.equal(
      await page.evaluate(() => window.__viewer.counters().ownedBuffers.live),
      ownedBefore,
      "provider teardown returns owned GPU buffers to baseline",
    );
    report.states.offset = {
      positions,
      blobs: offsetBlobs,
      dispatches: 4,
      firstObservedFrame: visibilityFrame,
    };

    await update({ mode: "bonds", offsetX: 5 });
    let bondVertices = [];
    const expectedBondVertices = [
      -13,
      1,
      0,
      -11.5,
      1,
      0,
      -11.5,
      1,
      0,
      -10,
      1,
      0,
      -10,
      1,
      0,
      -8.5,
      1,
      0,
      -8.5,
      1,
      0,
      -7,
      1,
      0,
    ];
    for (let attempt = 0; attempt < 12; attempt++) {
      bondVertices = await readBondVertices();
      if (
        bondVertices.length === expectedBondVertices.length &&
        bondVertices.every((value, i) =>
          Math.abs(value - expectedBondVertices[i]) <= 1e-5
        )
      ) break;
      await settle();
    }
    const bondBefore = await shot();
    assert.equal(bondVertices.length, expectedBondVertices.length);
    for (let i = 0; i < bondVertices.length; i++) {
      assert.ok(
        Math.abs(bondVertices[i] - expectedBondVertices[i]) <= 1e-5,
        `bond vertex ${i} matches the CPU midpoint oracle`,
      );
    }
    const bondBuilds = await page.evaluate(() =>
      window.__viewer.counters().detail["geometryBuilds:bonds:columns"] ?? 0
    );
    await update({ offsetX: 6 }, true);
    const movedBondVertices = await readBondVertices();
    for (let i = 0; i < bondVertices.length; i += 3) {
      assert.ok(Math.abs(movedBondVertices[i] - bondVertices[i] - 1) <= 1e-5);
      assert.ok(
        Math.abs(movedBondVertices[i + 1] - bondVertices[i + 1]) <= 1e-5,
      );
      assert.ok(
        Math.abs(movedBondVertices[i + 2] - bondVertices[i + 2]) <= 1e-5,
      );
    }
    assert.equal(
      await page.evaluate(() =>
        window.__viewer.counters().detail["geometryBuilds:bonds:columns"] ?? 0
      ),
      bondBuilds,
      "moving coordinates does not rebuild CPU bond columns",
    );
    assert.ok(
      !(await shot()).equals(bondBefore),
      "live bonds move in the draw",
    );
    report.states.bonds = { vertices: bondVertices, movedBy: 1 };
    await update({ mode: "preloaded" });

    await update({ mode: "attributes" });
    const attributeBytes = await page.evaluate(() =>
      window.__viewer.counters().detail["uploadBytes:attr:atomChain"] ?? 0
    );
    assert.equal(
      attributeBytes,
      12,
      "Spacefill and Bonds share one three-row attribute upload",
    );
    await update({ offsetX: 7 });
    assert.equal(
      await page.evaluate(() =>
        window.__viewer.counters().detail["uploadBytes:attr:atomChain"] ?? 0
      ),
      attributeBytes,
      "a style-neutral rerender does not re-upload the column",
    );
    await update({ mode: "preloaded" });

    await update({ mode: "attribute-revision", offsetX: 0 });
    const unrelatedBytes = await page.evaluate(() =>
      window.__viewer.counters().detail["uploadBytes:attr:user:a"] ?? 0
    );
    assert.equal(unrelatedBytes, 12);
    await update({ offsetX: 1 });
    assert.equal(
      await page.evaluate(() =>
        window.__viewer.counters().detail["uploadBytes:attr:user:a"] ?? 0
      ),
      unrelatedBytes,
      "changing column B preserves column A's GPU upload",
    );
    await update({ mode: "preloaded" });

    await update({ mode: "attribute-producer", offsetX: 5 });
    await page.waitForFunction(
      () => window.__viewer.attributeSnapshot?.values.join(",") === "5,6,7",
      null,
      { timeout: 10000 },
    ).catch(async (failure) => {
      console.log(
        "attribute diagnostics",
        JSON.stringify(
          await page.evaluate(() => ({
            snapshot: window.__viewer.attributeSnapshot,
            errors: window.__viewer.errors,
            dispatches: window.__viewer.dispatches,
            pipelines: window.__viewer.computePipelines,
            submissions: window.__viewer.submissions,
            counters: window.__viewer.counters(),
          })),
        ),
      );
      throw failure;
    });
    const firstAttribute = await page.evaluate(() =>
      window.__viewer.attributeSnapshot
    );
    const attributeBefore = await shot();
    await update({ offsetX: 6 });
    await page.waitForFunction(
      () => window.__viewer.attributeSnapshot?.values.join(",") === "6,7,8",
      null,
      { timeout: 10000 },
    );
    const nextAttribute = await page.evaluate(() =>
      window.__viewer.attributeSnapshot
    );
    assert.ok(nextAttribute.generation > firstAttribute.generation);
    assert.ok(
      !(await shot()).equals(attributeBefore),
      "kernel-produced attribute changes Spacefill colour",
    );
    await update({ offsetX: 8 });
    await update({ offsetX: 9 });
    await page.waitForFunction(
      () => window.__viewer.attributeSnapshot?.values.join(",") === "9,10,11",
      null,
      { timeout: 10000 },
    );
    const finalAttribute = await page.evaluate(() =>
      window.__viewer.attributeSnapshot
    );
    assert.ok(finalAttribute.generation > nextAttribute.generation);
    const attributeOwned = await page.evaluate(() =>
      window.__viewer.counters().ownedBuffers.bytes
    );
    assert.equal(attributeOwned["attr:producer:gpu:test"], 12);
    assert.equal(attributeOwned["attr:snapshot:gpu:test"], 24);
    const projectedAttributeMB = (
      attributeOwned["attr:producer:gpu:test"] +
      attributeOwned["attr:snapshot:gpu:test"] +
      finalAttribute.values.length * 4
    ) / finalAttribute.values.length;
    assert.equal(
      projectedAttributeMB,
      16,
      "producer, staging and CPU copy use 16 bytes per atom",
    );
    report.states.attributeProducer = {
      first: firstAttribute,
      second: nextAttribute,
      final: finalAttribute,
      projectedMBAt1M: projectedAttributeMB,
    };
    await update({ mode: "preloaded" });

    await update({ mode: "snapshot", offsetX: 5 });
    await page.waitForFunction(
      () => window.__viewer.coordinateSnapshot?.positions[0] === -13,
      null,
      { timeout: 10000 },
    ).catch(async (failure) => {
      console.log(
        "snapshot diagnostics",
        JSON.stringify(
          await page.evaluate(() => ({
            snapshot: window.__viewer.coordinateSnapshot,
            errors: window.__viewer.errors,
            counters: window.__viewer.counters(),
          })),
        ),
      );
      throw failure;
    });
    const firstSnapshot = await page.evaluate(() =>
      window.__viewer.coordinateSnapshot
    );
    await page.waitForFunction(
      () => window.__viewer.coordinateBounds?.centroid[0] === -10,
      null,
      { timeout: 10000 },
    );
    const firstBounds = await page.evaluate(() =>
      window.__viewer.coordinateBounds
    );
    assert.deepEqual(firstBounds.min, [-13, 1, 0]);
    assert.deepEqual(firstBounds.max, [-7, 1, 0]);
    assert.equal(firstBounds.count, 3);
    // Memory budget (contract section 4): root, two providers and snapshot
    // staging at 1M atoms, plus the 12 B/atom CPU copy, stay within 92 MB.
    const ownedBytes = await page.evaluate(() =>
      window.__viewer.counters().ownedBuffers.bytes
    );
    const atoms = 3;
    assert.equal(
      ownedBytes["coords:provider"],
      2 * atoms * 12,
      "two providers hold one packed vec3 buffer each",
    );
    assert.equal(
      ownedBytes["coords:snapshot"],
      2 * atoms * 12,
      "snapshot readback holds two packed staging buffers",
    );
    assert.ok(ownedBytes["structure:positions"] > 0, "root positions tracked");
    const perAtom = (ownedBytes["structure:positions"] +
      ownedBytes["coords:provider"] + ownedBytes["coords:snapshot"]) / atoms;
    const projected = (perAtom + 12) * 1e6;
    assert.ok(
      projected <= 92e6,
      `coords budget at 1M atoms: ${projected / 1e6} MB <= 92 MB`,
    );
    report.states.budget = { ownedBytes, projectedMBAt1M: projected / 1e6 };
    await page.waitForFunction(
      () => window.__viewer.selectedBounds?.centroid[0] === -11.5,
      null,
      { timeout: 10000 },
    );
    const selectedBounds = await page.evaluate(() =>
      window.__viewer.selectedBounds
    );
    assert.deepEqual(selectedBounds.min, [-13, 1, 0]);
    assert.deepEqual(selectedBounds.max, [-10, 1, 0]);
    assert.equal(selectedBounds.count, 2);
    assert.equal(await page.evaluate(() => window.__viewer.emptyBounds), null);
    await page.waitForFunction(
      () => window.__viewer.coordinateFocus?.target[0] === -10,
      null,
      { timeout: 10000 },
    );
    assert.deepEqual(firstSnapshot.positions, [-13, 1, 0, -10, 1, 0, -7, 1, 0]);
    await update({ offsetX: 6 }, true);
    await page.waitForFunction(
      () => window.__viewer.coordinateSnapshot?.positions[0] === -12,
      null,
      { timeout: 10000 },
    );
    const secondSnapshot = await page.evaluate(() =>
      window.__viewer.coordinateSnapshot
    );
    await page.waitForFunction(
      () => window.__viewer.coordinateBounds?.centroid[0] === -9,
      null,
      { timeout: 10000 },
    );
    await page.waitForFunction(
      () => window.__viewer.coordinateFocus?.target[0] === -9,
      null,
      { timeout: 10000 },
    );
    assert.ok(secondSnapshot.revision > firstSnapshot.revision);
    report.states.snapshot = { first: firstSnapshot, second: secondSnapshot };
    await update({ mode: "preloaded" });

    // 2. The runtime rejects the same prop combinations the types reject.
    const invalid = await page.evaluate(() => window.__viewer.invalid());
    assert.match(invalid[0], /either data or src, not both/);
    assert.match(invalid[1], /requires data or src/);
    assert.match(invalid[2], /src must be a string/);
    assert.match(invalid[3], /loader must be a function/);
    report.states.invalidProps = invalid;

    // 3. An empty structure owns no GPU source and draws nothing.
    await update({ mode: "empty" });
    assert.deepEqual(
      await blobs("empty", "components-empty"),
      [],
      "an empty structure draws nothing",
    );
    report.states.empty = { blobs: [] };

    // 4. Sibling structures keep separate contexts: each Spacefill must read its
    //    own nearest Structure, which here means its own radii.
    await update({ mode: "siblings" });
    const siblings = await blobs("siblings", "components-siblings");
    assert.equal(
      siblings.length,
      2,
      "two sibling structures draw two clusters",
    );
    const [wide, narrow] = siblings;
    assert.ok(
      wide.size > narrow.size * 1.5,
      `each sibling keeps its own radii: ${JSON.stringify(siblings)}`,
    );
    assert.ok(
      Math.min(wide.x, narrow.x) < 400 && Math.max(wide.x, narrow.x) > 400,
      `each sibling keeps its own coordinates: ${JSON.stringify(siblings)}`,
    );
    report.states.siblings = { blobs: siblings };

    // 5. A replaced source cannot mount a stale result.
    await update({ mode: "controlled", src: "/first" });
    await until(() => window.__viewer.snapshot().pending === 1);
    assert.equal(
      (await snapshot()).phase,
      "loading",
      "an in-flight load shows the loading prop",
    );
    await update({ src: "/second" }, true);
    await until(() => window.__viewer.snapshot().pending === 2);
    const staleCancelled = await page.evaluate(() =>
      window.__viewer.settle(0, "left")
    );
    await settle();
    assert.equal(
      staleCancelled,
      true,
      "replacing src cancels the outstanding request",
    );
    assert.equal(
      (await snapshot()).phase,
      "loading",
      "a stale result must not mount",
    );
    assert.deepEqual(
      await blobs("stale", "components-stale"),
      [],
      "a stale result must not draw",
    );
    await page.evaluate(() => window.__viewer.settle(1, "right"));
    await until(() => window.__viewer.snapshot().phase === "ready");
    const replaced = await snapshot();
    assert.deepEqual(
      replaced.history,
      ["loading", "ready"],
      "the replacement never showed a stale mount",
    );
    assert.equal(
      (await blobs("replaced", "components-replaced")).length,
      1,
      "the current source mounts",
    );
    report.states.replaced = { staleCancelled, history: replaced.history };

    // 6. A failing source reaches the error prop, not a permanent loading state.
    await update({ mode: "missing", src: "/fixtures/absent.bcif" });
    await until(() => window.__viewer.snapshot().phase === "error");
    const failed = await snapshot();
    assert.deepEqual(
      failed.history,
      ["loading", "error"],
      "a failing source shows loading, then the error prop",
    );
    assert.match(
      failed.failure,
      /404/,
      "the error prop receives the transport failure",
    );
    assert.deepEqual(
      await blobs("error", "components-error"),
      [],
      "a failed source draws nothing",
    );
    report.states.error = { failure: failed.failure, history: failed.history };

    // 7. The pinned BCIF protein: loading, then 327 atoms through the lazy parser.
    await update({ mode: "remote", src: "/fixtures/1crn.bcif" });
    await until(() => window.__viewer.snapshot().phase === "ready");
    const loaded = await snapshot();
    assert.deepEqual(
      loaded.history,
      ["loading", "ready"],
      "a BCIF source shows loading, then its structure",
    );
    assert.equal(
      loaded.atoms,
      327,
      "useStructureResource() reads the loaded structure",
    );
    const protein = await blobs("protein", "components-1crn");
    assert.ok(
      protein.length >= 1 && protein[0].size > 20000,
      `1CRN renders as a protein-sized body: ${JSON.stringify(protein)}`,
    );
    assert.ok(molstar() > 0, "a BCIF source does load the lazy parser");
    report.states.protein = {
      blobs: protein,
      history: loaded.history,
      molstarRequests: molstar(),
    };

    // 8. Unmounting releases the subtree without leaving stale geometry.
    await update({ mounted: false });
    assert.deepEqual(
      await blobs("unmounted", "components-unmounted"),
      [],
      "unmounting removes the structure",
    );
    await update({ mounted: true, mode: "preloaded" });
    assert.equal(
      (await blobs("remounted", "components-remounted")).length,
      1,
      "remounting redraws",
    );

    await settle();
    assert.deepEqual(errors, [], "Browser errors");
    assert.equal(
      notFound.length,
      1,
      "only the deliberate absent structure may 404",
    );
    assert.deepEqual((await snapshot()).errors, [], "WebGPU errors");
    report.status = "passed";
    report.browser = browser.version();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "failed";
    report.error = String(error);
    throw error;
  } finally {
    await writeFile(
      `${out}/components.json`,
      JSON.stringify(report, null, 2) + "\n",
    );
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
