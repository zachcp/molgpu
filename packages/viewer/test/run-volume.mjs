/**
 * WebGPU acceptance for Phase 11's viewer components: <Volume> uploads once per
 * identity and tears down, a volumeSample field binds the shared copy with no
 * per-row colour upload, <Isosurface> remeshes on level but not on style, and
 * <VolumeSlice> moves by uniforms only and composes with depth. Part of
 * `deno task test:components`.
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
import { writeCcp4 } from "../../io/test/ccp4-fixture.ts";

Deno.test("volume components", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const fixture = `${root}packages/viewer/test/volume`;
  const out = `${root}packages/viewer/test/results`;
  const PORT = 5193;
  await Deno.mkdir(out, { recursive: true });
  await build({ configFile: `${fixture}/vite.config.mjs`, logLevel: "warn" });
  // A small EM-style map served as a file, for the `src` path.
  await Deno.writeFile(
    `${fixture}/dist/map.mrc`,
    writeCcp4({
      extent: [8, 6, 5],
      cell: [8, 6, 5],
      origin: [-4, -3, -2.5],
      f: (x, y, z) => x + y + z,
    }),
  );

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
      args: [...webgpuBrowserArgs, "--enable-automation"],
    });
    const browserCdp = await browser.newBrowserCDPSession();
    const commandLine = await browserCdp.send("Browser.getBrowserCommandLine");
    const profile = commandLine.arguments.find((arg) =>
      arg.startsWith("--user-data-dir=")
    )?.slice("--user-data-dir=".length);
    assert(profile, "Chrome profile is required for process RSS attribution");
    const browserRssKb = async () => {
      const output = await new Deno.Command("ps", {
        args: ["-eo", "pid=,ppid=,rss=,command="],
      }).output();
      assertEquals(output.code, 0, "ps failed while measuring Chrome RSS");
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
      assert(root, "cannot identify the dedicated Chrome browser process");
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
    await page.waitForFunction(() => globalThis.__volume?.mounted, null, {
      timeout: 30000,
    }).catch((failure) => {
      throw new Error(`not mounted: ${JSON.stringify(errors)}`, {
        cause: failure,
      });
    });

    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
      });
    const update = async (patch) => {
      await page.evaluate((p) => globalThis.__volume.update(p), patch);
      await settle();
    };
    const counters = () => page.evaluate(() => globalThis.__volume.counters());
    const shot = () => page.locator("canvas").screenshot();
    // A frame that equals its successor, so transient work has finished.
    // `drawn` also waits for a non-black frame, so two identical frames from
    // before the first draw do not count as settled.
    const settled = async (name, drawn = true) => {
      await settle();
      let previous = await shot();
      for (let attempt = 0; attempt < 30; attempt++) {
        await settle();
        const current = await page.locator("canvas").screenshot(
          name ? { path: `${out}/volume-${name}.png` } : {},
        );
        if (
          current.equals(previous) &&
          (!drawn || (await classify(current)).lit > 0)
        ) return current;
        previous = current;
      }
      throw new Error(`${name} never settled`);
    };
    // Pixel classes and red connected components.
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
        const w = bmp.width, n = w * bmp.height;
        let red = 0, blue = 0, purple = 0, green = 0, lit = 0;
        const redMask = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
          if (r + g + b > 90) lit++;
          if (r > 120 && g < 70 && b < 70) {
            red++;
            redMask[i] = 1;
          }
          if (b > 120 && r < 70 && g < 70) blue++;
          if (r > 70 && b > 70 && g < 60 && Math.abs(r - b) < 60) purple++;
          if (g > 150 && r < 100 && b < 100) green++;
        }
        const blobs = [];
        for (let i = 0; i < n; i++) {
          if (!redMask[i]) continue;
          const queue = [i];
          redMask[i] = 0;
          let size = 0, sx = 0, sy = 0, top = Infinity;
          for (let q = 0; q < queue.length; q++) {
            const k = queue[q];
            size++;
            sx += k % w;
            sy += Math.floor(k / w);
            top = Math.min(top, Math.floor(k / w));
            for (const j of [k - w, k + w, k - 1, k + 1]) {
              if (j >= 0 && j < n && redMask[j]) {
                redMask[j] = 0;
                queue.push(j);
              }
            }
          }
          if (size > 30) {
            blobs.push({
              size,
              x: Math.round(sx / size),
              y: Math.round(sy / size),
              top,
            });
          }
        }
        return { red, blue, purple, green, lit, redBlobs: blobs };
      }, png.toString("base64"));
    const delta = (after, before, key) =>
      (after.detail[key] ?? 0) - (before.detail[key] ?? 0);

    const baseline = await counters();
    const volumeBytes = await page.evaluate(() =>
      globalThis.__volume.values("gradient").length * 4
    );

    // 1. <Volume data> uploads once to a buffer holding exactly its values.
    await update({ mode: "volume" });
    await page.waitForFunction(() => globalThis.__volume.phase === "ready");
    const readback = await page.evaluate(async () => {
      const { source, device } = globalThis.__volume;
      const size = source.length * 4;
      const staging = device.createBuffer({
        size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(source.buffer, 0, staging, 0, size);
      device.queue.submit([encoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const values = Array.from(new Float32Array(staging.getMappedRange()));
      staging.unmap();
      staging.destroy();
      return values;
    });
    assertEquals(
      readback,
      await page.evaluate(() => globalThis.__volume.values("gradient")),
      "the GPU buffer holds the volume's values",
    );
    let now = await counters();
    assertStrictEquals(delta(now, baseline, "allocations:volume:values"), 1);
    assertStrictEquals(
      delta(now, baseline, "uploadBytes:volume:values"),
      volumeBytes,
    );
    assertStrictEquals(now.ownedBuffers.bytes["volume:values"], volumeBytes);

    // 2. Unmounting releases the buffer.
    await update({ mode: "none" });
    now = await counters();
    assertStrictEquals(
      now.ownedBuffers.bytes["volume:values"],
      0,
      "volume released",
    );
    assertStrictEquals(now.ownedBuffers.live, baseline.ownedBuffers.live);

    // 3. <Volume> and a volumeSample field share one copy; the field colours
    //    atoms by the sampled value without uploading a colour column.
    let before = await counters();
    await update({ mode: "shared" });
    const shared = await classify(await settled("shared"));
    now = await counters();
    assertStrictEquals(
      delta(now, before, "allocations:volume:values"),
      1,
      "one GPU copy for <Volume> and the field",
    );
    assertStrictEquals(
      delta(now, before, "uploadBytes:volume:values"),
      volumeBytes,
    );
    const uploads = Object.keys(now.detail).filter((key) =>
      key.startsWith("uploadBytes:") && delta(now, before, key) > 0
    ).sort();
    assertEquals(uploads, [
      "uploadBytes:structure:positions",
      "uploadBytes:structure:radii",
      "uploadBytes:volume:values",
    ], "no per-atom colour upload");
    assert(
      shared.blue > 200,
      `x = -8 samples blue: ${JSON.stringify(shared)}`,
    );
    assert(shared.red > 200, `x = 8 samples red: ${JSON.stringify(shared)}`);
    assert(
      shared.purple > 200,
      `outside samples 0 → mid: ${JSON.stringify(shared)}`,
    );
    report.states.shared = shared;
    await update({ mode: "none" });
    assertStrictEquals(
      (await counters()).ownedBuffers.bytes["volume:values"],
      0,
    );

    // 4. <Isosurface>: level remeshes; colour and opacity do not.
    before = await counters();
    await update({ mode: "iso", level: 5 });
    const iso = await settled("iso");
    const isoPixels = await classify(iso);
    assert(isoPixels.lit > 2000, "the isosurface draws");
    const afterMesh = await counters();
    assertStrictEquals(
      delta(afterMesh, before, "geometryBuilds:isosurface:mesh"),
      1,
    );
    await update({ color: [0.95, 0.2, 0.2, 1] });
    const recoloured = await settled("iso-recoloured");
    await update({ opacity: 0.6 });
    await settled("iso-faded");
    now = await counters();
    assert(!recoloured.equals(iso), "colour change reaches the draw");
    assertStrictEquals(
      delta(now, afterMesh, "geometryBuilds:isosurface:mesh"),
      0,
      "colour/opacity never remesh",
    );
    assertStrictEquals(
      now.uploadBytes,
      afterMesh.uploadBytes,
      "no style upload",
    );
    await update({ level: { sigma: 1.5 }, opacity: 1 });
    const relevelled = await settled("iso-sigma");
    now = await counters();
    assertStrictEquals(
      delta(now, afterMesh, "geometryBuilds:isosurface:mesh"),
      1,
    );
    assert(!relevelled.equals(recoloured), "a new level redraws");
    report.states.iso = { pixels: isoPixels };
    await update({ mode: "none" });

    // 5. <VolumeSlice>: moving the plane changes the draw with no upload, no
    //    remesh of the isosurface, and no new volume buffer.
    // Seen obliquely: an x-plane is edge-on to a camera looking down z.
    await update({ mode: "slice", index: 6, bearing: 0.9 });
    const sliceA = await settled("slice-a");
    const beforeMove = await counters();
    await update({ index: 16 });
    const sliceB = await settled("slice-b");
    now = await counters();
    assert(
      !sliceB.equals(sliceA),
      `moving the plane changes the draw ${
        JSON.stringify(await page.evaluate(() => globalThis.__volume.errors))
      } ${JSON.stringify(errors)}`,
    );
    assertStrictEquals(
      now.uploadBytes,
      beforeMove.uploadBytes,
      "no upload on move",
    );
    assertStrictEquals(
      now.geometryBuilds,
      beforeMove.geometryBuilds,
      "no remesh on move",
    );
    assertStrictEquals(
      now.allocations,
      beforeMove.allocations,
      "no new buffers on move",
    );
    const [a, b] = [await classify(sliceA), await classify(sliceB)];
    // Index 6 is x ≈ -4 (bluish); index 16 is x ≈ 6 (reddish).
    assert(
      a.blue + a.purple > a.red,
      `low plane is blue-ish: ${JSON.stringify(a)}`,
    );
    assert(b.red > a.red, `high plane is redder: ${JSON.stringify(b)}`);
    report.states.slice = { a, b };
    await update({ mode: "none", bearing: 0 });

    // 6. Depth: the slice hides the atom behind it, not the one in front.
    await update({ mode: "depth" });
    const depth = await classify(await settled("depth"));
    assert(depth.green > 5000, "the slice draws");
    assertStrictEquals(
      depth.redBlobs.length,
      1,
      `one atom visible: ${JSON.stringify(depth)}`,
    );
    report.states.depth = depth;
    await update({ mode: "none" });

    // 7. A 256³ map (the plan's default ceiling) holds exactly one 64 MiB
    //    GPU copy and releases it. Four mount/unmount cycles must not grow
    //    dedicated Chrome process RSS by another full map each time.
    const rssAfterUnmountKb = [];
    await update({ mode: "big" });
    await page.waitForFunction(
      () => globalThis.__volume.volume?.dims[0] === 256,
      null,
      { timeout: 30000 },
    );
    now = await counters();
    assertStrictEquals(now.ownedBuffers.bytes["volume:values"], 256 ** 3 * 4);
    await page.evaluate(() => {
      globalThis.__bigVolumeBuffer = new WeakRef(
        globalThis.__volume.source.buffer,
      );
    });
    await update({ mode: "none" });
    assertStrictEquals(
      (await counters()).ownedBuffers.bytes["volume:values"],
      0,
    );
    await page.evaluate(() => globalThis.__volume.source = null);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    await page.waitForTimeout(50);
    await cdp.send("HeapProfiler.collectGarbage");
    const bigWrapperAlive = await page.evaluate(() =>
      !!globalThis.__bigVolumeBuffer.deref()
    );
    assert(
      !bigWrapperAlive,
      "64 MiB volume GPUBuffer wrapper remained reachable",
    );
    report.states.bigVolume = {
      requestedBytes: 256 ** 3 * 4,
      wrapperAliveAfterGC: bigWrapperAlive,
    };
    rssAfterUnmountKb.push(await browserRssKb());
    for (let cycle = 1; cycle < 4; cycle++) {
      await update({ mode: "big" });
      assertStrictEquals(
        (await counters()).ownedBuffers.bytes["volume:values"],
        256 ** 3 * 4,
      );
      await update({ mode: "none" });
      await page.evaluate(() => globalThis.__volume.source = null);
      await cdp.send("HeapProfiler.collectGarbage");
      rssAfterUnmountKb.push(await browserRssKb());
    }
    assert(
      rssAfterUnmountKb.at(-1) - rssAfterUnmountKb[0] <= 128 * 1024,
      `64 MiB volume churn grew Chrome RSS beyond 128 MiB: ${rssAfterUnmountKb}`,
    );
    report.states.bigVolume.browserRssAfterUnmountKb = rssAfterUnmountKb;

    // 8. <Volume src> loads CCP4/MRC with loading → ready, and reports errors.
    await update({ mode: "src", src: "/map.mrc" });
    await page.waitForFunction(
      () => globalThis.__volume.phase === "ready",
      null,
      {
        timeout: 30000,
      },
    );
    const dims = await page.evaluate(
      () => [...globalThis.__volume.volume.dims],
    );
    assertEquals(dims, [8, 6, 5]);
    await update({ src: "/missing.mrc" });
    await page.waitForFunction(
      () => globalThis.__volume.phase === "error",
      null,
      {
        timeout: 30000,
      },
    );
    assertMatch(
      await page.evaluate(() => globalThis.__volume.failure),
      /volume 404/,
    );
    await update({ mode: "none" });

    // 8. Contextual fields: argument-free volumeSample() binds the nearest
    //    <Volume>, an annotation join binds its baked rows, and a lifted
    //    residue column reads through each atom's residue, for Spacefill,
    //    Bonds and Surface, over all atoms and over residue 2's subset rows.
    //    Residue 1 is blue (nearest, lifted) or green (annotation); residue 2
    //    is red under every style.
    const residueOne = { nearest: "blue", annotation: "green", lifted: "blue" };
    const minimum = { spacefill: 200, bonds: 20, surface: 200 };
    report.states.field = {};
    for (const target of ["spacefill", "bonds", "surface"]) {
      for (const subset of [false, true]) {
        let styled = false;
        for (const style of ["nearest", "annotation", "lifted"]) {
          const name = `field-${target}-${style}${subset ? "-subset" : ""}`;
          const start = await counters();
          const failures = errors.length;
          await update({ mode: "field", target, style, subset });
          const pixels = await classify(
            await settled(name).catch((failure) => {
              throw new Error(`${name}: ${JSON.stringify(errors)}`, {
                cause: failure,
              });
            }),
          );
          // A render that throws leaves the previous frame on screen.
          assertEquals(errors.slice(failures), [], `${name}: page errors`);
          report.states.field[name] = pixels;
          const first = residueOne[style];
          assert(
            pixels.red > minimum[target],
            `${name}: residue 2 is red ${JSON.stringify(pixels)}`,
          );
          if (subset) {
            assert(
              pixels[first] <= 5,
              `${name}: residue 1 is not drawn ${JSON.stringify(pixels)}`,
            );
          } else {
            assert(
              pixels[first] > minimum[target],
              `${name}: residue 1 is ${first} ${JSON.stringify(pixels)}`,
            );
          }
          // Restyling one mounted representation moves no molecular geometry:
          // no coordinate upload, geometry build or topology build. The first
          // use of a field's own rows (an annotation) may upload them once.
          const now = await counters();
          if (styled) {
            const moved = Object.keys(now.detail).filter((key) =>
              (key.startsWith("uploadBytes:structure:") ||
                key.startsWith("geometryBuilds:") ||
                key.startsWith("topologyBuilds:")) &&
              delta(now, start, key) !== 0
            );
            assertEquals(moved, [], `${name}: restyle moved geometry`);
          }
          styled = true;
        }
        await update({ mode: "none" });
      }
    }

    // 9. One default view: with no selection, Spacefill and Bonds draw model 1
    //    with its primary conformer (left, not above) like every other
    //    representation. A selection replaces the view exactly: model 2
    //    (right), every row (both models and the upper altloc B), or nothing.
    report.states.view = {};
    const left = (blob) => blob.x < 400, right = (blob) => blob.x > 400;
    // Model 1 atoms and bonds reach y ≈ 280; altloc B reaches y ≈ 190.
    const upper = (blob) => blob.top < 240;
    for (const target of ["spacefill", "bonds"]) {
      for (const view of ["default", "model2", "all", "empty"]) {
        const name = `view-${target}-${view}`;
        const failures = errors.length;
        await update({ mode: "view", target, view });
        const pixels = await classify(await settled(name, view !== "empty"));
        assertEquals(errors.slice(failures), [], `${name}: page errors`);
        report.states.view[name] = pixels;
        const blobs = pixels.redBlobs;
        const seen = JSON.stringify(blobs);
        if (view === "empty") {
          assertStrictEquals(pixels.red, 0, `${name}: draws nothing`);
        } else if (view === "default") {
          assert(blobs.length && blobs.every(left), `${name}: model 1 ${seen}`);
          assert(!blobs.some(upper), `${name}: altloc B hidden ${seen}`);
        } else if (view === "model2") {
          assert(
            blobs.length && blobs.every(right),
            `${name}: model 2 ${seen}`,
          );
        } else {
          assert(blobs.some(left) && blobs.some(right), `${name}: ${seen}`);
          assert(blobs.some(upper), `${name}: altloc B drawn ${seen}`);
        }
      }
      await update({ mode: "none" });
    }

    assertEquals(
      await page.evaluate(() => globalThis.__volume.errors),
      [],
      "no WebGPU errors",
    );
    assertEquals(errors, [], "no page errors");
    report.status = "passed";
    console.log(JSON.stringify(report));
  } finally {
    await Deno.writeTextFile(
      `${out}/volume.json`,
      JSON.stringify(report, null, 2),
    );
    await browser?.close();
    await server.shutdown();
  }
});
