/**
 * WebGPU acceptance for Phase 12's <Trajectory> and <UnitCell>: the provider
 * output equals frames and their lerp, re-displaying resident frames writes no
 * storage bytes, subset maps leave unmapped rows at upstream, minimum-image
 * interpolation keeps wrapped atoms near both endpoints, a timeline seeks
 * frames, the box follows frames, `src` streams an XTC over HTTP Range, and
 * unmount releases every buffer. Part of `deno task test:components`.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "playwright";
import { writeXtc } from "../../io/test/trajectory-fixture.ts";
import { interpolatePositions } from "../src/internal/frame-window.ts";

Deno.test("trajectory components", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const fixture = `${root}packages/viewer/test/trajectory`;
  const out = `${root}packages/viewer/test/results`;
  const PORT = 5194;
  await mkdir(out, { recursive: true });
  await build({ configFile: `${fixture}/vite.config.mjs`, logLevel: "warn" });
  // The page's four synthetic frames, written as XTC for the `src` path.
  const frames = [0, 1, 2, 3].map((k) =>
    Float32Array.from(
      { length: 9 },
      (_, j) => [4 * Math.floor(j / 3) - 4 + k, k + 1, -k][j % 3],
    )
  );
  await writeFile(
    `${fixture}/dist/run.xtc`,
    writeXtc(frames.map((positions, i) => ({ positions, time: i }))),
  );

  const ranges = [];
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
    const type = { ".html": "text/html", ".js": "text/javascript" }[
      extname(path)
    ] ?? "application/octet-stream";
    const body = await readFile(path);
    const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? "");
    if (range) {
      ranges.push(req.headers.range);
      const end = Math.min(Number(range[2]), body.length - 1);
      res.writeHead(206, {
        "content-type": type,
        "content-range": `bytes ${range[1]}-${end}/${body.length}`,
      });
      res.end(body.subarray(Number(range[1]), end + 1));
      return;
    }
    res.writeHead(200, { "content-type": type });
    res.end(body);
  });
  let browser;
  try {
    await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--enable-unsafe-webgpu"],
    });
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
      deviceScaleFactor: 1,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => window.__trajectory?.mounted, null, {
      timeout: 30000,
    }).catch((failure) => {
      throw new Error(`not mounted: ${JSON.stringify(errors)}`, {
        cause: failure,
      });
    });
    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 6; i++) await new Promise(requestAnimationFrame);
      });
    const update = async (patch) => {
      await page.evaluate((p) => window.__trajectory.update(p), patch);
      await settle();
    };
    const counters = () => page.evaluate(() => window.__trajectory.counters());
    // Frames land asynchronously: wait until the displayed pair is `want`.
    const displayed = (want) =>
      page.waitForFunction(
        (w) => {
          const d = window.__trajectory.state?.displayed;
          return d && d.a === w.a && d.b === w.b && Math.abs(d.t - w.t) < 1e-6;
        },
        want,
        { timeout: 10000 },
      ).then(settle);
    const read = () =>
      page.evaluate(async () => {
        const { source, device } = window.__trajectory;
        const bytes = source.length * 12;
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
    const near = (actual, expected, what, tol = 1e-5) => {
      assert.equal(actual.length, expected.length, `${what}: length`);
      actual.forEach((v, i) =>
        assert.ok(
          Math.abs(v - expected[i]) <= tol,
          `${what}[${i}]: ${v} vs ${expected[i]}`,
        )
      );
    };
    // The first dispatch waits for asynchronous pipeline creation; later ones
    // land in the next frame. Poll, and report how many reads each check took.
    const polls = [];
    const expectRead = async (expected, what, tol = 1e-5) => {
      let values;
      for (let attempt = 1; attempt <= 30; attempt++) {
        values = await read();
        const ok = values.length === expected.length &&
          values.every((v, i) => Math.abs(v - expected[i]) <= tol);
        if (ok) {
          polls.push([what, attempt]);
          return values;
        }
        await settle();
      }
      near(values, expected, what, tol);
    };
    const pageFrames = await page.evaluate(() => window.__trajectory.frames);
    const rootPositions = await page.evaluate(() => window.__trajectory.root);
    const lerp = (a, b, t) =>
      Array.from(
        interpolatePositions(
          Float32Array.from(pageFrames[a]),
          Float32Array.from(pageFrames[b]),
          t,
        ),
      );
    const baseline = await counters();
    const report = {};

    // 1. Integer frames and a fractional frame.
    await update({ mode: "whole", frame: 0 });
    await displayed({ a: 0, b: 0, t: 0 });
    await expectRead(pageFrames[0], "frame 0");
    await update({ frame: 2.25 });
    await displayed({ a: 2, b: 3, t: 0.25 });
    await expectRead(lerp(2, 3, 0.25), "frame 2.25");
    await update({ frame: 3 });
    await displayed({ a: 3, b: 3, t: 0 });
    await expectRead(pageFrames[3], "frame 3");
    await update({ interpolate: "nearest", frame: 1.4 });
    await displayed({ a: 1, b: 1, t: 0 });
    await expectRead(pageFrames[1], "nearest 1.4");
    await update({ interpolate: "linear", frame: 7 });
    await displayed({ a: 3, b: 3, t: 0 });

    // 2. All four frames are resident: scrubbing among them writes nothing to
    // the frame window, observed at the device's queue.writeBuffer. use.gpu
    // writes a few hundred storage bytes of scene state on every redraw
    // (lights), with or without a frame change; the report records both.
    await page.evaluate(() => {
      const queue = window.__trajectory.device.queue;
      const write = queue.writeBuffer;
      window.__writes = { window: 0, storage: 0 };
      queue.writeBuffer = function (buffer, offset, data, ...rest) {
        const bytes = data.byteLength ?? data.length;
        if (buffer.label === "molgpu:coords:trajectory:window") {
          window.__writes.window += bytes;
        } else if (buffer.usage & GPUBufferUsage.STORAGE) {
          window.__writes.storage += bytes;
        }
        return write.call(this, buffer, offset, data, ...rest);
      };
    });
    const writes = () =>
      page.evaluate(() => {
        const w = { ...window.__writes };
        window.__writes = { window: 0, storage: 0 };
        return w;
      });
    for (const frame of [0.5, 2.75, 1, 3, 0]) await update({ frame });
    await displayed({ a: 0, b: 0, t: 0 });
    const scrub = await writes();
    for (let i = 0; i < 5; i++) await update({ interpolate: "linear" });
    const idle = await writes();
    report.residentScrub = { scrub, idleRedrawsSameCount: idle };
    assert.equal(
      scrub.window,
      0,
      "re-displaying resident frames uploads nothing",
    );
    const after = await counters();
    const windowBytes = after.ownedBuffers.bytes["coords:trajectory:window"];
    assert.equal(windowBytes, 4 * 3 * 12, "four slots of 3 atoms");

    // 3. Unmount releases the window and the provider output.
    await update({ mode: "none" });
    let now = await counters();
    for (const label of ["coords:trajectory:window", "coords:provider"]) {
      assert.equal(now.ownedBuffers.bytes[label] ?? 0, 0, `${label} released`);
    }

    // 4. A subset: rows 2 and 0 move, row 1 keeps the structure's position.
    await update({ mode: "subset", frame: 1.5 });
    await displayed({ a: 1, b: 2, t: 0.5 });
    const two = (k) => [-4 + k, k + 1, -k, k, k + 1, -k];
    const blend = two(1).map((v, i) => v + 0.5 * (two(2)[i] - v));
    await expectRead(
      [
        ...blend.slice(3, 6), // row 0 = trajectory atom 1
        ...rootPositions.slice(3, 6), // row 1 is unmapped: upstream
        ...blend.slice(0, 3), // row 2 = trajectory atom 0
      ],
      "subset",
    );
    now = await counters();
    assert.equal(now.ownedBuffers.bytes["coords:trajectory:map"], 12);
    await update({ mode: "none" });
    assert.equal(
      (await counters()).ownedBuffers.bytes["coords:trajectory:map"] ?? 0,
      0,
    );

    // 5. Minimum image: atom 0 wraps from x = 9.5 to 0.5 across a 10 Å box.
    await update({ mode: "boxed", frame: 0.25, pbc: "none" });
    await displayed({ a: 0, b: 1, t: 0.25 });
    const rest = [2, 2, 2, 3, 3, 3];
    await expectRead([7.25, 1, 1, ...rest], "plain lerp crosses the box", 1e-4);
    await update({ pbc: "minimum-image" });
    await expectRead([9.75, 1, 1, ...rest], "minimum image", 1e-4);
    const box = await page.evaluate(() =>
      Array.from(window.__trajectory.state.box)
    );
    near(box, [10.5, 0, 0, 0, 10, 0, 0, 0, 10], "interpolated box");
    await update({ mode: "none", pbc: "none" });

    // 6. The timeline: frameCurve at 1 fps seeks frame t.
    for (
      const [time, want] of [[1.5, { a: 1, b: 2, t: 0.5 }], [0.25, {
        a: 0,
        b: 1,
        t: 0.25,
      }], [9, { a: 3, b: 3, t: 0 }]]
    ) {
      await update({ mode: "timeline", time });
      await displayed(want);
      await expectRead(lerp(want.a, want.b, want.t), `timeline t=${time}`);
    }
    await update({ mode: "none" });

    // 7. Before the first frame lands, upstream coordinates show; no blank.
    await update({ mode: "slow", frame: 2 });
    const early = await page.evaluate(() => window.__trajectory.state);
    assert.equal(
      early.displayed,
      null,
      "nothing displayed before a frame lands",
    );
    await expectRead(rootPositions, "upstream before the first frame");
    await displayed({ a: 2, b: 2, t: 0 });
    await expectRead(pageFrames[2], "slow frame 2");
    await update({ mode: "none" });

    // 8. <UnitCell> draws the displayed box, and it follows frames.
    const lit = async (name) => {
      await settle();
      const png = await page.locator("canvas").screenshot({
        path: `${out}/trajectory-${name}.png`,
      });
      return page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes]));
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
        let green = 0, maxX = 0;
        for (let i = 0; i < data.length / 4; i++) {
          if (data[i * 4 + 1] > 120 && data[i * 4] < 120) {
            green++;
            maxX = Math.max(maxX, i % bmp.width);
          }
        }
        return { green, maxX };
      }, png.toString("base64"));
    };
    await update({ mode: "cell", frame: 0 });
    await displayed({ a: 0, b: 0, t: 0 });
    const small = await lit("cell-0");
    await update({ frame: 1 });
    await displayed({ a: 1, b: 1, t: 0 });
    const large = await lit("cell-1");
    assert.ok(small.green > 100, `box lines drawn: ${small.green}`);
    assert.ok(
      large.maxX > small.maxX,
      `box grows: ${small.maxX} → ${large.maxX}`,
    );
    await update({ mode: "none" });

    // 9. Snapshot consumers converge after playback stops, even when new
    // generations land while a readback is in flight (a Phase 9 regression:
    // the in-flight copy used to drop the hand-off and never reschedule).
    // Fresh mounts: the first readback (of the copied upstream) starts at
    // once, and the first frame lands while it is in flight.
    // Snapshot readbacks are held for 100 ms, and frames land 30 ms after
    // mount, so the first frame always arrives during the first readback.
    await page.evaluate(() => {
      const map = GPUBuffer.prototype.mapAsync;
      window.__mapAsync = map;
      GPUBuffer.prototype.mapAsync = async function (...args) {
        if (this.label === "molgpu:coords:snapshot") {
          await new Promise((r) => setTimeout(r, 100));
        }
        return map.apply(this, args);
      };
    });
    for (const [round, latency] of [30, 30, 60].entries()) {
      await update({ mode: "none" });
      await update({ mode: "snapshot", frame: 3, latency });
      await page.waitForFunction(
        () => {
          const { snapshot, generation } = window.__trajectory;
          return snapshot && generation !== null &&
            snapshot.generation === generation;
        },
        null,
        { timeout: 5000 },
      ).catch((failure) => {
        throw new Error(`mount ${round}: the snapshot never caught up`, {
          cause: failure,
        });
      });
      near(
        await page.evaluate(() => window.__trajectory.snapshot.positions),
        pageFrames[3],
        `snapshot after mount ${round}`,
      );
    }
    await page.evaluate(() => {
      GPUBuffer.prototype.mapAsync = window.__mapAsync;
    });
    await update({ frame: 0 });
    await displayed({ a: 0, b: 0, t: 0 });
    for (let round = 0; round < 3; round++) {
      await page.evaluate(async () => {
        for (const frame of [0.5, 1, 1.5, 2, 2.5, 3]) {
          window.__trajectory.update({ frame });
          await new Promise(requestAnimationFrame);
        }
      });
      await page.waitForFunction(
        () => {
          const { snapshot, generation } = window.__trajectory;
          return snapshot && snapshot.generation === generation;
        },
        null,
        { timeout: 5000 },
      ).catch((failure) => {
        throw new Error(
          `round ${round}: the snapshot never reached the final generation`,
          { cause: failure },
        );
      });
      near(
        await page.evaluate(() => window.__trajectory.snapshot.positions),
        pageFrames[3],
        `snapshot round ${round}`,
      );
      await update({ frame: 0 });
      await displayed({ a: 0, b: 0, t: 0 });
    }
    await update({ mode: "none" });

    // 10. src streams an XTC through HTTP Range requests.
    await update({ mode: "src", src: "/run.xtc", frame: 1 });
    await displayed({ a: 1, b: 1, t: 0 });
    await expectRead(pageFrames[1], "xtc frame 1", 0.0051);
    assert.ok(ranges.length >= 3, `range requests: ${ranges.length}`);
    report.rangeRequests = ranges.length;
    await update({ mode: "none" });

    now = await counters();
    for (const [label, bytes] of Object.entries(now.ownedBuffers.bytes)) {
      if (label.startsWith("coords:")) {
        assert.equal(bytes, 0, `${label} leaked`);
      }
    }
    assert.equal(
      now.ownedBuffers.live,
      baseline.ownedBuffers.live,
      "every owned buffer released",
    );
    const pageErrors = await page.evaluate(() => window.__trajectory.errors);
    assert.deepEqual(
      [...errors, ...pageErrors],
      [],
      "no page or WebGPU errors",
    );
    report.readPolls = polls;
    await writeFile(
      `${out}/trajectory-report.json`,
      JSON.stringify(report, null, 2),
    );
  } finally {
    await browser?.close();
    server.close();
  }
});
