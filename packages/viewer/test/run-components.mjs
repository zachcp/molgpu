/**
 * Acceptance runner for <Structure>/<Spacefill>.
 *
 * It typechecks the .tsx consumer, builds it with vite, serves the bundle, and
 * drives every state the components claim to support in a real Chrome WebGPU
 * tab: a preloaded dataset that must not fetch Mol*, a pinned BCIF protein,
 * sibling isolation, empty/loading/error states, replaced and unmounted
 * sources, and the uncaptured WebGPU error channel.
 */
import {
  assert,
  assertEquals,
  assertMatch,
  assertStrictEquals,
} from "@std/assert";
import { extname, fromFileUrl, normalize } from "@std/path";
import { build } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";

Deno.test("viewer components", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const fixture = `${root}packages/viewer/test/tsx`;
  const out = `${root}packages/viewer/test/results`;
  const PORT = 5187;
  const TYPES = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".wasm": "application/wasm",
    ".bcif": "application/octet-stream",
  };
  await Deno.mkdir(out, { recursive: true });

  const report = {
    date: new Date().toISOString(),
    status: "running",
    states: {},
  };
  await Deno.writeTextFile(`${out}/components.json`, JSON.stringify(report));

  const typecheck = new Deno.Command(Deno.execPath(), {
    args: ["check", `${fixture}/consumer.tsx`, `${fixture}/diagnostics.ts`],
    cwd: root,
  }).outputSync();
  if (!typecheck.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `Deno check failed:\n${decoder.decode(typecheck.stdout)}${
        decoder.decode(typecheck.stderr)
      }`,
    );
  }
  report.typecheck = "passed";
  await build({ configFile: `${fixture}/vite.config.mjs`, logLevel: "warn" });
  report.build = "passed";

  // Serve the built bundle plus the pinned corpus, so `src` fetches real bytes.
  const server = Deno.serve(
    { port: PORT, hostname: "127.0.0.1", onListen() {} },
    async (req) => {
      const url = new URL(req.url);
      const name = normalize(decodeURIComponent(url.pathname));
      const path = name.startsWith("/fixtures/")
        ? `${root}packages/io/test${name}`
        : name.startsWith("/site/assets/")
        ? `${root}${name}`
        : `${fixture}/dist${name === "/" ? "/index.html" : name}`;
      let info;
      try {
        info = await Deno.stat(path);
        if (!info.isFile) throw new Error("not a file");
      } catch {
        return new Response("not found", {
          status: 404,
          headers: { "content-type": "text/plain" },
        });
      }
      const file = await Deno.open(path, { read: true });
      return new Response(file.readable, {
        headers: {
          "content-type": TYPES[extname(path)] ?? "application/octet-stream",
        },
      });
    },
  );

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
    await page.waitForFunction(() => globalThis.__viewer?.mounted, null, {
      timeout: 30000,
    });
    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
      });
    const snapshot = () => page.evaluate(() => globalThis.__viewer.snapshot());
    const shot = () => page.locator("canvas").screenshot();
    const readCoordinates = () =>
      page.evaluate(async () => {
        const { coordinateSource: source, device } = globalThis.__viewer;
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
        const { bondSource: source, device } = globalThis.__viewer;
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
        if (!keep) globalThis.__viewer.reset();
        globalThis.__viewer.update(p);
      }, [patch, keepHistory]);
      await settle();
    };
    const until = (predicate, arg = null) =>
      page.waitForFunction(predicate, arg, { timeout: 30000 }).then(settle);

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
    assertStrictEquals(
      preloaded.length,
      1,
      "preloaded structure draws one cluster",
    );
    assertMatch(
      await page.evaluate(() => globalThis.__viewer.missingCoordinatesError),
      /Required context 'CoordinatesContext' was used without being provided/,
      "useCoordinates outside Structure reports a composition error",
    );
    assertStrictEquals(molstar(), 0, "a preloaded dataset must not load Mol*");
    assertEquals(
      await page.evaluate(() => globalThis.__viewer.rootPositionReads),
      { cpu: "ok", gpu: "ok" },
      "root-only trees may read root positions",
    );
    report.states.preloaded = { blobs: preloaded, molstarRequests: 0 };

    const ownedBefore = await page.evaluate(() =>
      globalThis.__viewer.counters().ownedBuffers.live
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
    assertEquals(
      positions,
      expectedCoordinates,
      "the two offsets compose exactly in the GPU buffer",
    );
    const guardedReads = await page.evaluate(() =>
      globalThis.__viewer.rootPositionReads
    );
    assertMatch(
      guardedReads.cpu,
      /useCoordinates\(\) or useCoordinateSnapshot\(\)/,
    );
    assertMatch(
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
    assertStrictEquals(
      offsetBlobs.length,
      1,
      "the provider chain draws Spacefill",
    );
    assert(
      offsetBlobs[0].x > preloaded[0].x + 20 &&
        offsetBlobs[0].x < preloaded[0].x + 45,
      "the chained offset moves the Spacefill draw",
    );
    const firstDispatches = await page.evaluate(() =>
      globalThis.__viewer.dispatches
    );
    assertStrictEquals(firstDispatches, 2, "one dispatch per offset provider");
    await settle();
    assertStrictEquals(
      await page.evaluate(() => globalThis.__viewer.dispatches),
      firstDispatches,
      "unchanged content does not redispatch",
    );
    const uploadsBefore = await page.evaluate(() =>
      globalThis.__viewer.counters().uploadBytes
    );
    await page.evaluate(() => globalThis.__viewer.update({ offsetX: 6 }));
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
    assert(
      visibilityFrame !== null,
      `updated coordinates reach the draw: before=${
        JSON.stringify(offsetBlobs)
      } observed=${JSON.stringify(observed)}`,
    );
    await settle();
    assertEquals(
      await readCoordinates(),
      [-12, 1, 0, -9, 1, 0, -6, 1, 0],
      "changing a parameter republishes both provider generations",
    );
    assertStrictEquals(
      await page.evaluate(() => globalThis.__viewer.dispatches),
      firstDispatches + 2,
      "each changed provider dispatches once",
    );
    assertStrictEquals(
      await page.evaluate(() => globalThis.__viewer.counters().uploadBytes),
      uploadsBefore,
      "coordinate updates do not upload topology or style data",
    );
    await update({ mode: "preloaded" });
    assertStrictEquals(
      await page.evaluate(() =>
        globalThis.__viewer.counters().ownedBuffers.live
      ),
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
    assertStrictEquals(bondVertices.length, expectedBondVertices.length);
    for (let i = 0; i < bondVertices.length; i++) {
      assert(
        Math.abs(bondVertices[i] - expectedBondVertices[i]) <= 1e-5,
        `bond vertex ${i} matches the CPU midpoint oracle`,
      );
    }
    const bondBuilds = await page.evaluate(() =>
      globalThis.__viewer.counters().detail["geometryBuilds:bonds:columns"] ?? 0
    );
    await update({ offsetX: 6 }, true);
    let movedBondVertices = [];
    for (let attempt = 0; attempt < 12; attempt++) {
      movedBondVertices = await readBondVertices();
      if (
        movedBondVertices.length === bondVertices.length &&
        movedBondVertices.every((value, i) =>
          Math.abs(value - bondVertices[i] - (i % 3 === 0 ? 1 : 0)) <= 1e-5
        )
      ) break;
      await settle();
    }
    for (let i = 0; i < bondVertices.length; i += 3) {
      assert(Math.abs(movedBondVertices[i] - bondVertices[i] - 1) <= 1e-5);
      assert(
        Math.abs(movedBondVertices[i + 1] - bondVertices[i + 1]) <= 1e-5,
      );
      assert(
        Math.abs(movedBondVertices[i + 2] - bondVertices[i + 2]) <= 1e-5,
      );
    }
    assertStrictEquals(
      await page.evaluate(() =>
        globalThis.__viewer.counters().detail["geometryBuilds:bonds:columns"] ??
          0
      ),
      bondBuilds,
      "moving coordinates does not rebuild CPU bond columns",
    );
    assert(
      !(await shot()).equals(bondBefore),
      "live bonds move in the draw",
    );
    report.states.bonds = { vertices: bondVertices, movedBy: 1 };
    await update({ mode: "preloaded" });

    await update({ mode: "attributes" });
    const attributeBytes = await page.evaluate(() =>
      globalThis.__viewer.counters().detail["uploadBytes:attr:atomChain"] ?? 0
    );
    assertStrictEquals(
      attributeBytes,
      12,
      "Spacefill and Bonds share one three-row attribute upload",
    );
    await update({ offsetX: 7 });
    assertStrictEquals(
      await page.evaluate(() =>
        globalThis.__viewer.counters().detail["uploadBytes:attr:atomChain"] ?? 0
      ),
      attributeBytes,
      "a style-neutral rerender does not re-upload the column",
    );
    await update({ mode: "preloaded" });

    await update({ mode: "attribute-revision", offsetX: 0 });
    const unrelatedBytes = await page.evaluate(() =>
      globalThis.__viewer.counters().detail["uploadBytes:attr:user:a"] ?? 0
    );
    assertStrictEquals(unrelatedBytes, 12);
    await update({ offsetX: 1 });
    assertStrictEquals(
      await page.evaluate(() =>
        globalThis.__viewer.counters().detail["uploadBytes:attr:user:a"] ?? 0
      ),
      unrelatedBytes,
      "changing column B preserves column A's GPU upload",
    );
    await update({ mode: "preloaded" });

    await update({ mode: "attribute-producer", offsetX: 5 });
    await page.waitForFunction(
      () => globalThis.__viewer.attributeSnapshot?.values.join(",") === "5,6,7",
      null,
      { timeout: 10000 },
    ).catch(async (failure) => {
      console.log(
        "attribute diagnostics",
        JSON.stringify(
          await page.evaluate(() => ({
            snapshot: globalThis.__viewer.attributeSnapshot,
            errors: globalThis.__viewer.errors,
            dispatches: globalThis.__viewer.dispatches,
            pipelines: globalThis.__viewer.computePipelines,
            submissions: globalThis.__viewer.submissions,
            counters: globalThis.__viewer.counters(),
          })),
        ),
      );
      throw failure;
    });
    const firstAttribute = await page.evaluate(() =>
      globalThis.__viewer.attributeSnapshot
    );
    const attributeBefore = await shot();
    await update({ offsetX: 6 });
    await page.waitForFunction(
      () => globalThis.__viewer.attributeSnapshot?.values.join(",") === "6,7,8",
      null,
      { timeout: 10000 },
    );
    const nextAttribute = await page.evaluate(() =>
      globalThis.__viewer.attributeSnapshot
    );
    assert(nextAttribute.generation > firstAttribute.generation);
    assert(
      !(await shot()).equals(attributeBefore),
      "kernel-produced attribute changes Spacefill colour",
    );
    await update({ offsetX: 8 });
    await update({ offsetX: 9 });
    await page.waitForFunction(
      () =>
        globalThis.__viewer.attributeSnapshot?.values.join(",") === "9,10,11",
      null,
      { timeout: 10000 },
    );
    const finalAttribute = await page.evaluate(() =>
      globalThis.__viewer.attributeSnapshot
    );
    assert(finalAttribute.generation > nextAttribute.generation);
    const attributeOwned = await page.evaluate(() =>
      globalThis.__viewer.counters().ownedBuffers.bytes
    );
    assertStrictEquals(attributeOwned["attr:producer:gpu:test"], 12);
    assertStrictEquals(attributeOwned["attr:snapshot:gpu:test"], 24);
    const projectedAttributeMB = (
      attributeOwned["attr:producer:gpu:test"] +
      attributeOwned["attr:snapshot:gpu:test"] +
      finalAttribute.values.length * 4
    ) / finalAttribute.values.length;
    assertStrictEquals(
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

    for (
      const [name, phase, expected, type] of [
        ["ssCode", 3, "3", "Uint8Array"],
        ["formalCharge", -1, "-1,0,1", "Int8Array"],
        ["partialCharge", 0.25, "0.25,1.25,2.25", "Float32Array"],
        ["gpu:test", 2, "2,3,4", "Float32Array"],
      ]
    ) {
      await update({
        mode: "attribute-roundtrip",
        attributeName: name,
        offsetX: phase,
      });
      await page.waitForFunction(
        ({ expected, type }) => {
          const snapshot = globalThis.__viewer.attributeSnapshot;
          return snapshot?.values.join(",") === expected &&
            snapshot?.type === type;
        },
        { expected, type },
        { timeout: 10000 },
      );
      await update({ mode: "preloaded" });
    }

    await update({ mode: "snapshot", offsetX: 5 });
    await page.waitForFunction(
      () => globalThis.__viewer.coordinateSnapshot?.positions[0] === -13,
      null,
      { timeout: 10000 },
    ).catch(async (failure) => {
      console.log(
        "snapshot diagnostics",
        JSON.stringify(
          await page.evaluate(() => ({
            snapshot: globalThis.__viewer.coordinateSnapshot,
            errors: globalThis.__viewer.errors,
            counters: globalThis.__viewer.counters(),
          })),
        ),
      );
      throw failure;
    });
    const firstSnapshot = await page.evaluate(() =>
      globalThis.__viewer.coordinateSnapshot
    );
    await page.waitForFunction(
      () => globalThis.__viewer.coordinateBounds?.centroid[0] === -10,
      null,
      { timeout: 10000 },
    );
    const firstBounds = await page.evaluate(() =>
      globalThis.__viewer.coordinateBounds
    );
    assertEquals(firstBounds.min, [-13, 1, 0]);
    assertEquals(firstBounds.max, [-7, 1, 0]);
    assertStrictEquals(firstBounds.count, 3);
    // Memory budget (contract section 4): root, two providers and snapshot
    // staging at 1M atoms, plus the 12 B/atom CPU copy, stay within 92 MB.
    const ownedBytes = await page.evaluate(() =>
      globalThis.__viewer.counters().ownedBuffers.bytes
    );
    const atoms = 3;
    assertStrictEquals(
      ownedBytes["coords:provider"],
      2 * atoms * 12,
      "two providers hold one packed vec3 buffer each",
    );
    assertStrictEquals(
      ownedBytes["coords:snapshot"],
      2 * atoms * 12,
      "snapshot readback holds two packed staging buffers",
    );
    assert(ownedBytes["structure:positions"] > 0, "root positions tracked");
    const perAtom = (ownedBytes["structure:positions"] +
      ownedBytes["coords:provider"] + ownedBytes["coords:snapshot"]) / atoms;
    const projected = (perAtom + 12) * 1e6;
    assert(
      projected <= 92e6,
      `coords budget at 1M atoms: ${projected / 1e6} MB <= 92 MB`,
    );
    report.states.budget = { ownedBytes, projectedMBAt1M: projected / 1e6 };
    await page.waitForFunction(
      () => globalThis.__viewer.selectedBounds?.centroid[0] === -11.5,
      null,
      { timeout: 10000 },
    );
    const selectedBounds = await page.evaluate(() =>
      globalThis.__viewer.selectedBounds
    );
    assertEquals(selectedBounds.min, [-13, 1, 0]);
    assertEquals(selectedBounds.max, [-10, 1, 0]);
    assertStrictEquals(selectedBounds.count, 2);
    assertStrictEquals(
      await page.evaluate(() => globalThis.__viewer.emptyBounds),
      null,
    );
    await page.waitForFunction(
      () => globalThis.__viewer.coordinateFocus?.target[0] === -10,
      null,
      { timeout: 10000 },
    );
    assertEquals(firstSnapshot.positions, [-13, 1, 0, -10, 1, 0, -7, 1, 0]);
    await update({ offsetX: 6 }, true);
    await page.waitForFunction(
      () => globalThis.__viewer.coordinateSnapshot?.positions[0] === -12,
      null,
      { timeout: 10000 },
    );
    const secondSnapshot = await page.evaluate(() =>
      globalThis.__viewer.coordinateSnapshot
    );
    await page.waitForFunction(
      () => globalThis.__viewer.coordinateBounds?.centroid[0] === -9,
      null,
      { timeout: 10000 },
    );
    await page.waitForFunction(
      () => globalThis.__viewer.coordinateFocus?.target[0] === -9,
      null,
      { timeout: 10000 },
    );
    assert(secondSnapshot.revision > firstSnapshot.revision);
    report.states.snapshot = { first: firstSnapshot, second: secondSnapshot };
    await update({ mode: "preloaded" });

    // 2. The runtime rejects the same prop combinations the types reject.
    const invalid = await page.evaluate(() => globalThis.__viewer.invalid());
    assertMatch(invalid[0], /either data or src, not both/);
    assertMatch(invalid[1], /requires data or src/);
    assertMatch(invalid[2], /src must be a string/);
    assertMatch(invalid[3], /loader must be a function/);
    report.states.invalidProps = invalid;

    // 3. An empty structure owns no GPU source and draws nothing.
    await update({ mode: "empty" });
    assertEquals(
      await blobs("empty", "components-empty"),
      [],
      "an empty structure draws nothing",
    );
    report.states.empty = { blobs: [] };

    // 4. Sibling structures keep separate contexts: each Spacefill must read its
    //    own nearest Structure, which here means its own radii.
    await update({ mode: "siblings" });
    const siblings = await blobs("siblings", "components-siblings");
    assertStrictEquals(
      siblings.length,
      2,
      "two sibling structures draw two clusters",
    );
    const [wide, narrow] = siblings;
    assert(
      wide.size > narrow.size * 1.5,
      `each sibling keeps its own radii: ${JSON.stringify(siblings)}`,
    );
    assert(
      Math.min(wide.x, narrow.x) < 400 && Math.max(wide.x, narrow.x) > 400,
      `each sibling keeps its own coordinates: ${JSON.stringify(siblings)}`,
    );
    report.states.siblings = { blobs: siblings };

    // 5. A replaced source cannot mount a stale result.
    await update({ mode: "controlled", src: "/first" });
    await until(() => globalThis.__viewer.snapshot().pending === 1);
    assertStrictEquals(
      (await snapshot()).phase,
      "loading",
      "an in-flight load shows the loading prop",
    );
    await update({ src: "/second" }, true);
    await until(() => globalThis.__viewer.snapshot().pending === 2);
    const staleCancelled = await page.evaluate(() =>
      globalThis.__viewer.settle(0, "left")
    );
    await settle();
    assertStrictEquals(
      staleCancelled,
      true,
      "replacing src cancels the outstanding request",
    );
    assertStrictEquals(
      (await snapshot()).phase,
      "loading",
      "a stale result must not mount",
    );
    assertEquals(
      await blobs("stale", "components-stale"),
      [],
      "a stale result must not draw",
    );
    await page.evaluate(() => globalThis.__viewer.settle(1, "right"));
    await until(() => globalThis.__viewer.snapshot().phase === "ready");
    const replaced = await snapshot();
    assertEquals(
      replaced.history,
      ["loading", "ready"],
      "the replacement never showed a stale mount",
    );
    assertStrictEquals(
      (await blobs("replaced", "components-replaced")).length,
      1,
      "the current source mounts",
    );
    report.states.replaced = { staleCancelled, history: replaced.history };

    // 6. A failing source reaches the error prop, not a permanent loading state.
    await update({ mode: "missing", src: "/fixtures/absent.bcif" });
    await until(() => globalThis.__viewer.snapshot().phase === "error");
    const failed = await snapshot();
    assertEquals(
      failed.history,
      ["loading", "error"],
      "a failing source shows loading, then the error prop",
    );
    assertMatch(
      failed.failure,
      /404/,
      "the error prop receives the transport failure",
    );
    assertEquals(
      await blobs("error", "components-error"),
      [],
      "a failed source draws nothing",
    );
    report.states.error = { failure: failed.failure, history: failed.history };

    // 7. The pinned BCIF protein: loading, then 327 atoms through the lazy parser.
    await update({ mode: "remote", src: "/fixtures/1crn.bcif" });
    await until(() => globalThis.__viewer.snapshot().phase === "ready");
    const loaded = await snapshot();
    assertEquals(
      loaded.history,
      ["loading", "ready"],
      "a BCIF source shows loading, then its structure",
    );
    assertStrictEquals(
      loaded.atoms,
      327,
      "useStructureResource() reads the loaded structure",
    );
    const protein = await blobs("protein", "components-1crn");
    assert(
      protein.length >= 1 && protein[0].size > 20000,
      `1CRN renders as a protein-sized body: ${JSON.stringify(protein)}`,
    );
    assert(molstar() > 0, "a BCIF source does load the lazy parser");
    report.states.protein = {
      blobs: protein,
      history: loaded.history,
      molstarRequests: molstar(),
    };

    // 7b. Source presentation lifecycle (molgpu-sept-s5o.2): failure is sticky
    //     until a deliberate retry, and one Structure instance moves between
    //     src and data without showing a stale dataset.
    const base = (await snapshot()).pending;
    await update({
      mode: "lifecycle",
      source: "src",
      src: "/lifecycle",
      attempt: 0,
    });
    await until((n) => globalThis.__viewer.snapshot().pending === n + 1, base);
    await page.evaluate((i) => globalThis.__viewer.settle(i, "fail"), base);
    await until(() => globalThis.__viewer.snapshot().phase === "error");
    const lifecycleFailed = await snapshot();
    assertEquals(
      lifecycleFailed.history,
      ["loading", "error"],
      "a rejected loader shows loading, then the error prop",
    );
    assertMatch(lifecycleFailed.failure, /controlled failure: \/lifecycle/);
    // An unrelated re-render with unchanged src and loader issues no request.
    await update({ offsetX: 6 }, true);
    assertStrictEquals(
      (await snapshot()).pending,
      base + 1,
      "a re-render does not silently retry a failed source",
    );
    assertStrictEquals((await snapshot()).phase, "error", "failure is kept");
    // A new key is the public retry: a fresh request, never the old failure.
    await update({ attempt: 1 });
    await until((n) => globalThis.__viewer.snapshot().pending === n + 2, base);
    assertStrictEquals((await snapshot()).phase, "loading", "retry is pending");
    await page.evaluate(
      (i) => globalThis.__viewer.settle(i + 1, "right"),
      base,
    );
    await until(() => globalThis.__viewer.snapshot().phase === "ready");
    const retried = await snapshot();
    assertEquals(retried.history, ["loading", "ready"], "retry then ready");
    assertStrictEquals(retried.dataset, "right", "retry mounts its result");
    // src -> data on the same instance mounts the data without a loading state.
    await update({ source: "data" });
    await until(() => globalThis.__viewer.snapshot().dataset === "left");
    // The phase was already ready, so a direct switch records no transition.
    assertEquals((await snapshot()).history, [], "src to data never loads");
    // data -> src shows loading, never the previous data, until it settles.
    await update({ source: "src", src: "/lifecycle-next" });
    await until((n) => globalThis.__viewer.snapshot().pending === n + 3, base);
    const reopening = await snapshot();
    assertStrictEquals(reopening.phase, "loading", "data to src is pending");
    assertStrictEquals(reopening.dataset, null, "no stale dataset while open");
    assertEquals(
      await blobs("lifecycle-pending", "components-lifecycle-pending"),
      [],
      "a pending source draws nothing",
    );
    // src -> data while pending cancels the request; a late result is ignored.
    await update({ source: "data" }, true);
    await until(() => globalThis.__viewer.snapshot().dataset === "left");
    const lateCancelled = await page.evaluate(
      (i) => globalThis.__viewer.settle(i + 2, "right"),
      base,
    );
    await settle();
    assertStrictEquals(lateCancelled, true, "switching to data cancels src");
    const switched = await snapshot();
    assertEquals(switched.history, ["loading", "ready"], "no stale mount");
    assertStrictEquals(switched.dataset, "left", "data wins over a late src");
    assertStrictEquals(
      (await blobs("lifecycle-data", "components-lifecycle-data")).length,
      1,
      "the data source draws",
    );
    report.states.lifecycle = {
      failed: lifecycleFailed.history,
      retried: retried.history,
      switched: switched.history,
      lateCancelled,
    };

    // 8. Unmounting releases the subtree without leaving stale geometry.
    await update({ mounted: false });
    assertEquals(
      await blobs("unmounted", "components-unmounted"),
      [],
      "unmounting removes the structure",
    );
    await update({ mounted: true, mode: "preloaded" });
    assertStrictEquals(
      (await blobs("remounted", "components-remounted")).length,
      1,
      "remounting redraws",
    );

    await settle();
    assertEquals(errors, [], "Browser errors");
    assertStrictEquals(
      notFound.length,
      1,
      "only the deliberate absent structure may 404",
    );
    assertEquals((await snapshot()).errors, [], "WebGPU errors");

    // A semantically invalid code must not count as a published generation.
    const beforeInvalid = await page.evaluate(() =>
      globalThis.__viewer.counters().detail
    );
    await update({
      mode: "attribute-roundtrip",
      attributeName: "ssCode",
      offsetX: 9,
    });
    await page.waitForFunction(() =>
      (globalThis.__viewer.counters().detail[
        "gathers:attr:snapshot:ssCode:error"
      ] ?? 0) > 0
    );
    const afterInvalid = await page.evaluate(() =>
      globalThis.__viewer.counters().detail
    );
    assertStrictEquals(
      afterInvalid["gathers:attr:snapshot:ssCode:publish"],
      beforeInvalid["gathers:attr:snapshot:ssCode:publish"],
      "invalid ssCode generation was not published",
    );
    await page.waitForFunction(() =>
      globalThis.__viewer.attributeSnapshot === null
    );
    assert(
      errors.some((message) =>
        message.includes("Attribute snapshot ssCode failed")
      ),
      `invalid ssCode failure is surfaced: ${JSON.stringify(errors)}`,
    );
    report.status = "passed";
    report.browser = browser.version();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.status = "failed";
    report.error = String(error);
    throw error;
  } finally {
    await Deno.writeTextFile(
      `${out}/components.json`,
      JSON.stringify(report, null, 2) + "\n",
    );
    await browser?.close();
    await server.shutdown();
  }
});
