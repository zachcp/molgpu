/**
 * WebGPU acceptance for Phase 11's viewer components: <Volume> uploads once per
 * identity and tears down, a volumeSample field binds the shared copy with no
 * per-row colour upload, <Isosurface> remeshes on level but not on style, and
 * <VolumeSlice> moves by uniforms only and composes with depth. Part of
 * `deno task test:components`.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";
import { writeCcp4 } from "../../io/test/ccp4-fixture.ts";

Deno.test("volume components", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const fixture = `${root}packages/viewer/test/volume`;
  const out = `${root}packages/viewer/test/results`;
  const PORT = 5193;
  await mkdir(out, { recursive: true });
  await build({ configFile: `${fixture}/vite.config.mjs`, logLevel: "warn" });
  // A small EM-style map served as a file, for the `src` path.
  await writeFile(
    `${fixture}/dist/map.mrc`,
    writeCcp4({
      extent: [8, 6, 5],
      cell: [8, 6, 5],
      origin: [-4, -3, -2.5],
      f: (x, y, z) => x + y + z,
    }),
  );

  const server = createServer(async (req, res) => {
    const name = normalize(
      decodeURIComponent(new URL(req.url, "http://x").pathname),
    );
    const path = `${fixture}/dist${name === "/" ? "/index.html" : name}`;
    try {
      if (!(await stat(path)).isFile()) throw new Error("not a file");
    } catch {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": { ".html": "text/html", ".js": "text/javascript" }[
        extname(path)
      ] ?? "application/octet-stream",
    });
    createReadStream(path).pipe(res);
  });
  const report = { date: new Date().toISOString(), states: {} };
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
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !/status of 404/.test(m.text())) {
        errors.push(m.text());
      }
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => window.__volume?.mounted, null, {
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
      await page.evaluate((p) => window.__volume.update(p), patch);
      await settle();
    };
    const counters = () => page.evaluate(() => window.__volume.counters());
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
          let size = 0, sx = 0;
          for (let q = 0; q < queue.length; q++) {
            const k = queue[q];
            size++;
            sx += k % w;
            for (const j of [k - w, k + w, k - 1, k + 1]) {
              if (j >= 0 && j < n && redMask[j]) {
                redMask[j] = 0;
                queue.push(j);
              }
            }
          }
          if (size > 30) blobs.push({ size, x: Math.round(sx / size) });
        }
        return { red, blue, purple, green, lit, redBlobs: blobs };
      }, png.toString("base64"));
    const delta = (after, before, key) =>
      (after.detail[key] ?? 0) - (before.detail[key] ?? 0);

    const baseline = await counters();
    const volumeBytes = await page.evaluate(() =>
      window.__volume.values("gradient").length * 4
    );

    // 1. <Volume data> uploads once to a buffer holding exactly its values.
    await update({ mode: "volume" });
    await page.waitForFunction(() => window.__volume.phase === "ready");
    const readback = await page.evaluate(async () => {
      const { source, device } = window.__volume;
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
    assert.deepEqual(
      readback,
      await page.evaluate(() => window.__volume.values("gradient")),
      "the GPU buffer holds the volume's values",
    );
    let now = await counters();
    assert.equal(delta(now, baseline, "allocations:volume:values"), 1);
    assert.equal(
      delta(now, baseline, "uploadBytes:volume:values"),
      volumeBytes,
    );
    assert.equal(now.ownedBuffers.bytes["volume:values"], volumeBytes);

    // 2. Unmounting releases the buffer.
    await update({ mode: "none" });
    now = await counters();
    assert.equal(now.ownedBuffers.bytes["volume:values"], 0, "volume released");
    assert.equal(now.ownedBuffers.live, baseline.ownedBuffers.live);

    // 3. <Volume> and a volumeSample field share one copy; the field colours
    //    atoms by the sampled value without uploading a colour column.
    let before = await counters();
    await update({ mode: "shared" });
    const shared = await classify(await settled("shared"));
    now = await counters();
    assert.equal(
      delta(now, before, "allocations:volume:values"),
      1,
      "one GPU copy for <Volume> and the field",
    );
    assert.equal(delta(now, before, "uploadBytes:volume:values"), volumeBytes);
    const uploads = Object.keys(now.detail).filter((key) =>
      key.startsWith("uploadBytes:") && delta(now, before, key) > 0
    ).sort();
    assert.deepEqual(uploads, [
      "uploadBytes:structure:positions",
      "uploadBytes:structure:radii",
      "uploadBytes:volume:values",
    ], "no per-atom colour upload");
    assert.ok(
      shared.blue > 200,
      `x = -8 samples blue: ${JSON.stringify(shared)}`,
    );
    assert.ok(shared.red > 200, `x = 8 samples red: ${JSON.stringify(shared)}`);
    assert.ok(
      shared.purple > 200,
      `outside samples 0 → mid: ${JSON.stringify(shared)}`,
    );
    report.states.shared = shared;
    await update({ mode: "none" });
    assert.equal((await counters()).ownedBuffers.bytes["volume:values"], 0);

    // 4. <Isosurface>: level remeshes; colour and opacity do not.
    before = await counters();
    await update({ mode: "iso", level: 5 });
    const iso = await settled("iso");
    const isoPixels = await classify(iso);
    assert.ok(isoPixels.lit > 2000, "the isosurface draws");
    const afterMesh = await counters();
    assert.equal(delta(afterMesh, before, "geometryBuilds:isosurface:mesh"), 1);
    await update({ color: [0.95, 0.2, 0.2, 1] });
    const recoloured = await settled("iso-recoloured");
    await update({ opacity: 0.6 });
    await settled("iso-faded");
    now = await counters();
    assert.ok(!recoloured.equals(iso), "colour change reaches the draw");
    assert.equal(
      delta(now, afterMesh, "geometryBuilds:isosurface:mesh"),
      0,
      "colour/opacity never remesh",
    );
    assert.equal(now.uploadBytes, afterMesh.uploadBytes, "no style upload");
    await update({ level: { sigma: 1.5 }, opacity: 1 });
    const relevelled = await settled("iso-sigma");
    now = await counters();
    assert.equal(delta(now, afterMesh, "geometryBuilds:isosurface:mesh"), 1);
    assert.ok(!relevelled.equals(recoloured), "a new level redraws");
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
    assert.ok(
      !sliceB.equals(sliceA),
      `moving the plane changes the draw ${
        JSON.stringify(await page.evaluate(() => window.__volume.errors))
      } ${JSON.stringify(errors)}`,
    );
    assert.equal(now.uploadBytes, beforeMove.uploadBytes, "no upload on move");
    assert.equal(
      now.geometryBuilds,
      beforeMove.geometryBuilds,
      "no remesh on move",
    );
    assert.equal(
      now.allocations,
      beforeMove.allocations,
      "no new buffers on move",
    );
    const [a, b] = [await classify(sliceA), await classify(sliceB)];
    // Index 6 is x ≈ -4 (bluish); index 16 is x ≈ 6 (reddish).
    assert.ok(
      a.blue + a.purple > a.red,
      `low plane is blue-ish: ${JSON.stringify(a)}`,
    );
    assert.ok(b.red > a.red, `high plane is redder: ${JSON.stringify(b)}`);
    report.states.slice = { a, b };
    await update({ mode: "none", bearing: 0 });

    // 6. Depth: the slice hides the atom behind it, not the one in front.
    await update({ mode: "depth" });
    const depth = await classify(await settled("depth"));
    assert.ok(depth.green > 5000, "the slice draws");
    assert.equal(
      depth.redBlobs.length,
      1,
      `one atom visible: ${JSON.stringify(depth)}`,
    );
    report.states.depth = depth;
    await update({ mode: "none" });

    // 7. A 256³ map (the plan's default ceiling) holds exactly one 64 MiB
    //    GPU copy and releases it.
    await update({ mode: "big" });
    await page.waitForFunction(
      () => window.__volume.volume?.dims[0] === 256,
      null,
      { timeout: 30000 },
    );
    now = await counters();
    assert.equal(now.ownedBuffers.bytes["volume:values"], 256 ** 3 * 4);
    await update({ mode: "none" });
    assert.equal((await counters()).ownedBuffers.bytes["volume:values"], 0);

    // 8. <Volume src> loads CCP4/MRC with loading → ready, and reports errors.
    await update({ mode: "src", src: "/map.mrc" });
    await page.waitForFunction(() => window.__volume.phase === "ready", null, {
      timeout: 30000,
    });
    const dims = await page.evaluate(() => [...window.__volume.volume.dims]);
    assert.deepEqual(dims, [8, 6, 5]);
    await update({ src: "/missing.mrc" });
    await page.waitForFunction(() => window.__volume.phase === "error", null, {
      timeout: 30000,
    });
    assert.match(
      await page.evaluate(() => window.__volume.failure),
      /volume 404/,
    );
    await update({ mode: "none" });

    assert.deepEqual(
      await page.evaluate(() => window.__volume.errors),
      [],
      "no WebGPU errors",
    );
    assert.deepEqual(errors, [], "no page errors");
    report.status = "passed";
    console.log(JSON.stringify(report));
  } finally {
    await writeFile(`${out}/volume.json`, JSON.stringify(report, null, 2));
    await browser?.close();
    server.close();
  }
});
