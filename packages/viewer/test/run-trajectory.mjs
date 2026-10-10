/**
 * WebGPU acceptance for Phase 12's <Trajectory> and <UnitCell>: the provider
 * output equals frames and their lerp, re-displaying resident frames writes no
 * storage bytes, subset maps leave unmapped rows at upstream, minimum-image
 * interpolation keeps wrapped atoms near both endpoints, a timeline seeks
 * frames, the box follows frames, `src` streams an XTC over HTTP Range, and
 * unmount releases every buffer. Part of `deno task test:components`.
 */
import {
  assert,
  assertEquals,
  assertMatch,
  assertNotStrictEquals,
  assertStrictEquals,
} from "@std/assert";
import { extname, fromFileUrl, normalize } from "@std/path";
import { build } from "vite";
import { applyAffine } from "../../dynamics/src/affine.ts";
import {
  cellListWgsl,
  createUnwrapForest,
  planCellList,
} from "@molgpu/dynamics/wgsl";
import { createCellList } from "../../dynamics/src/cell-list.ts";
import { fitKabsch } from "@molgpu/dynamics";
import { unwrapFrame } from "../../dynamics/src/pbc.ts";
import { writeXtc } from "../../io/test/trajectory-fixture.ts";
import { structureFromBcif } from "@molgpu/io";
import { interpolatePositions } from "../src/trajectory/frame-window.ts";
import { captureErrors, launchWebGpuBrowser } from "./harness.mjs";

async function runGpuCellList(page, positions, cutoff) {
  const cpu = createCellList(Float32Array.from(positions), cutoff, {
    maxCells: 1_000_000,
    maxCandidates: 20_000,
  });
  const gpu = await page.evaluate(
    async ({ shaders, positions, cutoff, origin, dims }) => {
      const device = globalThis.__trajectory.device;
      const S = GPUBufferUsage.STORAGE,
        R = GPUBufferUsage.COPY_SRC,
        W = GPUBufferUsage.COPY_DST;
      const all = [];
      const make = (bytes, usage = S | R | W, data = null) => {
        const buffer = device.createBuffer({ size: Math.max(4, bytes), usage });
        all.push(buffer);
        if (data) device.queue.writeBuffer(buffer, 0, data);
        return buffer;
      };
      const pipeline = async (code) => {
        const module = device.createShaderModule({ code });
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter((message) =>
          message.type === "error"
        );
        if (errors.length) {
          throw new Error(errors.map((e) => e.message).join("\n"));
        }
        return device.createComputePipelineAsync({
          layout: "auto",
          compute: { module, entryPoint: "main" },
        });
      };
      const dispatch = (encoder, pipe, bindings, groups) => {
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipe);
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout: pipe.getBindGroupLayout(0),
            entries: bindings.map(([binding, buffer]) => ({
              binding,
              resource: { buffer },
            })),
          }),
        );
        pass.dispatchWorkgroups(groups);
        pass.end();
      };
      const n = positions.length / 3;
      const cells = dims[0] * dims[1] * dims[2];
      const source = make(
        positions.length * 4,
        S | W,
        Float32Array.from(positions),
      );
      const dummy = make(4, S | W, new Uint32Array(1));
      const ids = make(n * 4);
      const counts = make(cells * 4, S | R | W, new Uint32Array(cells));
      const sorted = make(n * 4);
      const paramsBytes = new ArrayBuffer(64);
      const u = new Uint32Array(paramsBytes), f = new Float32Array(paramsBytes);
      u.set([n, 0, 20_000, 1_000_000, ...dims, cells]);
      f.set(
        [...origin, 0, 1 / (cutoff * (1 + 1e-6)), cutoff * cutoff, 0, 0],
        8,
      );
      const params = make(64, GPUBufferUsage.UNIFORM | W, paramsBytes);
      const scanParams = (count) =>
        make(16, GPUBufferUsage.UNIFORM | W, Uint32Array.of(count, 0, 0, 0));
      const boundsPipe = await pipeline(shaders.bounds);
      const mergeBoundsPipe = await pipeline(shaders.mergeBounds);
      const countPipe = await pipeline(shaders.count);
      const scanCountsPipe = await pipeline(shaders.scanCounts);
      const scanValuesPipe = await pipeline(shaders.scanValues);
      const addPipe = await pipeline(shaders.addOffsets);
      const scatterPipe = await pipeline(shaders.scatter);
      const pairsPipe = await pipeline(shaders.pairs);
      const encoder = device.createCommandEncoder();
      let boundCount = n;
      let boundInput = source;
      let boundOutput;
      let first = true;
      while (true) {
        const blocks = Math.ceil(boundCount / 64);
        boundOutput = make(blocks * 32);
        dispatch(
          encoder,
          first ? boundsPipe : mergeBoundsPipe,
          first
            ? [[0, boundInput], [1, dummy], [2, boundOutput], [
              3,
              scanParams(boundCount),
            ]]
            : [[0, boundInput], [2, boundOutput], [
              3,
              scanParams(boundCount),
            ]],
          blocks,
        );
        if (blocks === 1) break;
        boundInput = boundOutput;
        boundCount = blocks;
        first = false;
      }
      dispatch(encoder, countPipe, [
        [0, source],
        [1, dummy],
        [2, ids],
        [3, counts],
        [4, params],
      ], Math.ceil(n / 64));
      const levels = [];
      let levelCount = cells;
      let input = counts;
      while (true) {
        const blocks = Math.ceil(levelCount / 256);
        const offsets = make(levelCount * 4);
        const sums = make(blocks * 4);
        dispatch(
          encoder,
          levels.length ? scanValuesPipe : scanCountsPipe,
          [[0, input], [1, offsets], [2, sums], [3, scanParams(levelCount)]],
          blocks,
        );
        levels.push({ offsets, count: levelCount });
        if (blocks === 1) break;
        input = sums;
        levelCount = blocks;
      }
      for (let level = levels.length - 2; level >= 0; level--) {
        dispatch(encoder, addPipe, [
          [0, levels[level].offsets],
          [1, levels[level + 1].offsets],
          [2, scanParams(levels[level].count)],
        ], Math.ceil(levels[level].count / 64));
      }
      const offsets = levels[0].offsets;
      const cursor = make(cells * 4);
      encoder.copyBufferToBuffer(offsets, 0, cursor, 0, cells * 4);
      dispatch(encoder, scatterPipe, [
        [0, dummy],
        [1, ids],
        [2, cursor],
        [3, sorted],
        [4, params],
      ], Math.ceil(n / 64));
      const pairCapacity = 1_000_000;
      const pairs = make(pairCapacity * 8);
      const state = make(8, S | R | W, new Uint32Array(2));
      dispatch(encoder, pairsPipe, [
        [0, source],
        [1, dummy],
        [2, counts],
        [3, offsets],
        [4, params],
        [5, sorted],
        [6, pairs],
        [7, state],
      ], Math.ceil(n / 64));
      device.queue.submit([encoder.finish()]);
      const sizes = [32, cells * 4, cells * 4, n * 4, 8, pairCapacity * 8];
      const sources = [boundOutput, counts, offsets, sorted, state, pairs];
      const start = [];
      let total = 0;
      for (const size of sizes) {
        start.push(total);
        total += size;
      }
      const staging = make(
        total,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      );
      const readEncoder = device.createCommandEncoder();
      sources.forEach((buffer, i) =>
        readEncoder.copyBufferToBuffer(buffer, 0, staging, start[i], sizes[i])
      );
      device.queue.submit([readEncoder.finish()]);
      await staging.mapAsync(GPUMapMode.READ);
      const copy = staging.getMappedRange().slice(0);
      const readU32 = (part) =>
        Array.from(new Uint32Array(copy, start[part], sizes[part] / 4));
      const bounds = Array.from(new Float32Array(copy, start[0], 8));
      const status = readU32(4);
      const pairWords = readU32(5).slice(0, status[0] * 2);
      const pairRows = [];
      for (let i = 0; i < pairWords.length; i += 2) {
        pairRows.push([pairWords[i], pairWords[i + 1]]);
      }
      pairRows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      staging.unmap();
      all.forEach((buffer) => buffer.destroy());
      return {
        bounds,
        counts: readU32(1),
        offsets: readU32(2),
        rows: readU32(3),
        overflow: status[1],
        pairs: pairRows.flat(),
        errors: globalThis.__trajectory.errors.slice(),
      };
    },
    {
      shaders: cellListWgsl,
      positions,
      cutoff,
      origin: cpu.origin,
      dims: cpu.dims,
    },
  );
  assertEquals(gpu.errors, []);
  assertEquals(gpu.counts, [...cpu.counts]);
  assertEquals(gpu.offsets, [...cpu.offsets.slice(0, -1)]);
  assertEquals(
    gpu.rows.slice().sort((a, b) => a - b),
    [...cpu.rows].sort((a, b) => a - b),
  );
  assertStrictEquals(gpu.overflow, 0);
  assertEquals(gpu.pairs, [...cpu.pairsWithin(cutoff)]);
  assertEquals(gpu.bounds.slice(0, 3), [...cpu.origin]);
  return { cells: cpu.counts.length, pairs: gpu.pairs.length / 2 };
}

Deno.test("trajectory components", async () => {
  const root = fromFileUrl(new URL("../../../", import.meta.url));
  const fixture = `${root}packages/viewer/test/trajectory`;
  const out = `${root}packages/viewer/test/results`;
  const PORT = 5194;
  await Deno.mkdir(out, { recursive: true });
  await build({ configFile: `${fixture}/vite.config.mjs`, logLevel: "warn" });
  // The page's four synthetic frames, written as XTC for the `src` path.
  const frames = [0, 1, 2, 3].map((k) =>
    Float32Array.from(
      { length: 9 },
      (_, j) => [4 * Math.floor(j / 3) - 4 + k, k + 1, -k][j % 3],
    )
  );
  await Deno.writeFile(
    `${fixture}/dist/run.xtc`,
    writeXtc(frames.map((positions, i) => ({ positions, time: i }))),
  );

  const ranges = [];
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
      const body = await Deno.readFile(path);
      const rangeHeader = req.headers.get("range");
      const range = /bytes=(\d+)-(\d+)/.exec(rangeHeader ?? "");
      if (range) {
        ranges.push(rangeHeader);
        const end = Math.min(Number(range[2]), body.length - 1);
        return new Response(body.subarray(Number(range[1]), end + 1), {
          status: 206,
          headers: {
            "content-type": type,
            "content-range": `bytes ${range[1]}-${end}/${body.length}`,
          },
        });
      }
      return new Response(body, { headers: { "content-type": type } });
    },
  );
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
      deviceScaleFactor: 1,
    });
    const errors = captureErrors(page);
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => globalThis.__trajectory?.mounted, null, {
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
      await page.evaluate((p) => globalThis.__trajectory.update(p), patch);
      await settle();
    };
    const counters = () =>
      page.evaluate(() => globalThis.__trajectory.counters());
    // Frames land asynchronously: wait until the displayed pair is `want`.
    const displayed = (want) =>
      page.waitForFunction(
        (w) => {
          const d = globalThis.__trajectory.state?.displayed;
          return d && d.a === w.a && d.b === w.b && Math.abs(d.t - w.t) < 1e-6;
        },
        want,
        { timeout: 10000 },
      ).then(settle);
    const read = () =>
      page.evaluate(async () => {
        const { source, device } = globalThis.__trajectory;
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
      assertStrictEquals(actual.length, expected.length, `${what}: length`);
      actual.forEach((v, i) =>
        assert(
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
    const pageFrames = await page.evaluate(() =>
      globalThis.__trajectory.frames
    );
    const rootPositions = await page.evaluate(() =>
      globalThis.__trajectory.root
    );
    const lerp = (a, b, t) =>
      Array.from(
        interpolatePositions(
          Float32Array.from(pageFrames[a]),
          Float32Array.from(pageFrames[b]),
          t,
        ),
      );
    const unw = await page.evaluate(() => {
      const { statuses: _, ...rest } = globalThis.__trajectory.unwrap;
      return rest;
    });
    const unwrapTopology = {
      atoms: {
        count: unw.root.length / 3,
        residue: new Uint32Array(unw.root.length / 3),
        altloc: new Array(unw.root.length / 3).fill(""),
      },
      residues: { chain: new Uint32Array(1) },
      chains: { model: Int32Array.of(1) },
      bonds: {
        count: unw.bonds.length,
        a: Uint32Array.from(unw.bonds, (bond) => bond[0]),
        b: Uint32Array.from(unw.bonds, (bond) => bond[1]),
        flags: new Uint8Array(unw.bonds.length).fill(1),
      },
    };
    const forest = createUnwrapForest(unwrapTopology);

    // 0. First-dispatch race (molgpu-sept-usx). A CoordinatePasses provider
    // under a static kernel provider must not keep an output computed from the
    // kernel's zero-filled buffer: nothing upstream changes after the kernel's
    // pipeline compiles, so only the kernel's own first-dispatch signal can
    // trigger the re-run. Each case starts on a fresh page so the kernel
    // pipeline compiles asynchronously.
    const fresh = async () => {
      await page.reload();
      await page.waitForFunction(() => globalThis.__trajectory?.mounted, null, {
        timeout: 30000,
      });
    };
    {
      const sup = await page.evaluate(() => globalThis.__trajectory.superpose);
      const upstream = Float32Array.from(sup.frames[2]);
      const fit = fitKabsch(upstream, Float32Array.from(sup.fixed), null, true);
      await update({ mode: "static-superpose" });
      await expectRead(
        Array.from(applyAffine(upstream, fit.matrix)),
        "superpose under static Wobble",
        2e-3,
      );
      await fresh();
      await update({ mode: "static-unwrap" });
      await expectRead(
        Array.from(
          unwrapFrame(Float32Array.from(unw.frames[0]), forest, unw.boxes[0])
            .positions,
        ),
        "unwrap under static Wobble",
        1e-4,
      );
      await fresh();
    }

    const baseline = await counters();
    const report = {};

    // A Structure boundary shadows trajectory metadata even when the nested
    // structure has the same row count. Volume and Timeline remain inherited.
    await update({ mode: "scope", frame: 0, time: 2.25 });
    await page.waitForFunction(() =>
      globalThis.__trajectory.scope.outer?.box?.[0] === 10 &&
      globalThis.__trajectory.scope.nestedUnwrap !== undefined
    );
    const scope = await page.evaluate(() => globalThis.__trajectory.scope);
    for (const name of ["outer", "afterNested"]) {
      assertStrictEquals(scope[name].trajectory, true, `${name} trajectory`);
      assertStrictEquals(scope[name].box[0], 10, `${name} box`);
    }
    for (const name of ["nested", "nestedUnwrap", "sibling"]) {
      assertStrictEquals(scope[name].trajectory, false, `${name} trajectory`);
      assertStrictEquals(scope[name].box, null, `${name} box`);
      assertStrictEquals(scope[name].volume, true, `${name} volume`);
      assertStrictEquals(scope[name].time, 2.25, `${name} timeline`);
    }
    assertStrictEquals(
      (await page.evaluate(() =>
        globalThis.__trajectory.unwrap.statuses.slice(-1)[0]
      )).status,
      "missing-box",
      "nested Unwrap cannot use the outer box",
    );
    await update({ mode: "none" });

    // Source replacement must withdraw the old trajectory while its successor opens.
    await update({ mode: "reload", src: "first.xtc", frame: 0 });
    await page.waitForFunction(() =>
      globalThis.__trajectory.loads.length === 1
    );
    const mountsWhileOpening = await page.evaluate(() =>
      globalThis.__trajectory.mounts
    );
    await page.evaluate(() => globalThis.__trajectory.loads[0].resolve());
    await displayed({ a: 0, b: 0, t: 0 });
    const mountsAfterOpen = await page.evaluate(() =>
      globalThis.__trajectory.mounts
    );
    assertStrictEquals(
      mountsAfterOpen,
      mountsWhileOpening,
      "opening a src trajectory must not remount its descendants",
    );
    await update({ src: "second.xtc" });
    await page.waitForFunction(() =>
      globalThis.__trajectory.loads.length === 2
    );
    assertStrictEquals(
      await page.evaluate(() => globalThis.__trajectory.state),
      null,
      "a pending replacement must not expose the old trajectory metadata",
    );
    assertStrictEquals(
      await page.evaluate(() =>
        globalThis.__trajectory.loads[0].signal.aborted
      ),
      true,
      "replacement aborts the old loader request",
    );
    await update({ src: "third.xtc" });
    await page.waitForFunction(() =>
      globalThis.__trajectory.loads.length === 3
    );
    await page.evaluate(() => globalThis.__trajectory.loads[1].resolve());
    await page.evaluate(() =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
    );
    assertStrictEquals(
      await page.evaluate(() => globalThis.__trajectory.state),
      null,
      "a cancelled completion cannot clear a newer request's pending state",
    );
    await page.evaluate(() => globalThis.__trajectory.loads[2].resolve());
    await displayed({ a: 0, b: 0, t: 0 });
    await update({ mode: "none" });

    await update({ mode: "reload", src: "fourth.xtc", reloadData: false });
    await page.waitForFunction(() =>
      globalThis.__trajectory.loads.length === 4
    );
    await update({ reloadData: true });
    await displayed({ a: 0, b: 0, t: 0 });
    assertStrictEquals(
      await page.evaluate(() =>
        globalThis.__trajectory.loads[3].signal.aborted
      ),
      true,
      "source-to-data aborts pending transport",
    );
    await update({ reloadData: false });
    await page.waitForFunction(() =>
      globalThis.__trajectory.loads.length === 5
    );
    assertStrictEquals(
      await page.evaluate(() => globalThis.__trajectory.state),
      null,
    );
    await update({ mode: "none" });
    assertStrictEquals(
      await page.evaluate(() =>
        globalThis.__trajectory.loads[4].signal.aborted
      ),
      true,
      "unmount aborts pending transport",
    );

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
      const queue = globalThis.__trajectory.device.queue;
      const write = queue.writeBuffer;
      globalThis.__writes = { window: 0, storage: 0 };
      queue.writeBuffer = function (buffer, offset, data, ...rest) {
        const bytes = data.byteLength ?? data.length;
        if (buffer.label === "molgpu:coords:trajectory:window") {
          globalThis.__writes.window += bytes;
        } else if (buffer.usage & GPUBufferUsage.STORAGE) {
          globalThis.__writes.storage += bytes;
        }
        return write.call(this, buffer, offset, data, ...rest);
      };
    });
    const writes = () =>
      page.evaluate(() => {
        const w = { ...globalThis.__writes };
        globalThis.__writes = { window: 0, storage: 0 };
        return w;
      });
    for (const frame of [0.5, 2.75, 1, 3, 0]) await update({ frame });
    await displayed({ a: 0, b: 0, t: 0 });
    const scrub = await writes();
    for (let i = 0; i < 5; i++) await update({ interpolate: "linear" });
    const idle = await writes();
    report.residentScrub = { scrub, idleRedrawsSameCount: idle };
    assertStrictEquals(
      scrub.window,
      0,
      "re-displaying resident frames uploads nothing",
    );
    const after = await counters();
    const windowBytes = after.ownedBuffers.bytes["coords:trajectory:window"];
    assertStrictEquals(windowBytes, 4 * 3 * 12, "four slots of 3 atoms");

    // 3. Unmount releases the window and the provider output.
    await update({ mode: "none" });
    let now = await counters();
    for (const label of ["coords:trajectory:window", "coords:provider"]) {
      assertStrictEquals(
        now.ownedBuffers.bytes[label] ?? 0,
        0,
        `${label} released`,
      );
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
    assertStrictEquals(now.ownedBuffers.bytes["coords:trajectory:map"], 12);
    await update({ mode: "none" });
    assertStrictEquals(
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
      Array.from(globalThis.__trajectory.state.box)
    );
    near(box, [10.5, 0, 0, 0, 10, 0, 0, 0, 10], "interpolated box");
    await update({ mode: "none", pbc: "none" });

    // Fractional rounding picks a longer path in this skew triclinic cell.
    await update({ mode: "skew", frame: 0.5, pbc: "minimum-image" });
    await displayed({ a: 0, b: 1, t: 0.5 });
    const cpuSkew = interpolatePositions(
      Float32Array.of(0, 0, 0, 2, 2, 2, 3, 3, 3),
      Float32Array.of(9.31, 0.49, 0, 2, 2, 2, 3, 3, 3),
      0.5,
      Float32Array.of(10, 0, 0, 9, 1, 0, 0, 0, 10),
    );
    near(
      Array.from(cpuSkew),
      [0.155, -0.255, 0, 2, 2, 2, 3, 3, 3],
      "CPU exact triclinic image",
      1e-5,
    );
    await expectRead(
      Array.from(cpuSkew),
      "exact triclinic minimum image",
      2e-4,
    );
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
    const early = await page.evaluate(() => globalThis.__trajectory.state);
    assertStrictEquals(
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
    assert(small.green > 100, `box lines drawn: ${small.green}`);
    assert(
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
      globalThis.__mapAsync = map;
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
          const { snapshot, generation } = globalThis.__trajectory;
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
        await page.evaluate(() => globalThis.__trajectory.snapshot.positions),
        pageFrames[3],
        `snapshot after mount ${round}`,
      );
    }
    await page.evaluate(() => {
      GPUBuffer.prototype.mapAsync = globalThis.__mapAsync;
    });
    await update({ frame: 0 });
    await displayed({ a: 0, b: 0, t: 0 });
    for (let round = 0; round < 3; round++) {
      await page.evaluate(async () => {
        for (const frame of [0.5, 1, 1.5, 2, 2.5, 3]) {
          globalThis.__trajectory.update({ frame });
          await new Promise(requestAnimationFrame);
        }
      });
      await page.waitForFunction(
        () => {
          const { snapshot, generation } = globalThis.__trajectory;
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
        await page.evaluate(() => globalThis.__trajectory.snapshot.positions),
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
    assert(ranges.length >= 3, `range requests: ${ranges.length}`);
    report.rangeRequests = ranges.length;
    await update({ mode: "none" });

    // 11. Phase 13 affine provider: GPU output agrees with its CPU transform,
    // subset masks pass other rows through, and matrix/selection changes do
    // not upload the structure positions again.
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const shift = (x, y = 0) => [
      ...identity.slice(0, 12),
      x,
      y,
      0,
      1,
    ];
    const shifted = (positions, x, y = 0, only = null) =>
      positions.map((v, i) => {
        if (only !== null && Math.floor(i / 3) !== only) return v;
        return v + (i % 3 === 0 ? x : i % 3 === 1 ? y : 0);
      });
    await update({ mode: "transform", matrix: shift(2, 3) });
    await expectRead(shifted(rootPositions, 2, 3), "affine all");
    const uploaded =
      (await counters()).detail["uploadBytes:structure:positions"] ?? 0;
    await update({ matrix: shift(-4, 1) });
    await expectRead(shifted(rootPositions, -4, 1), "affine changed matrix");
    assertStrictEquals(
      (await counters()).detail["uploadBytes:structure:positions"] ?? 0,
      uploaded,
      "matrix change does not re-upload structure positions",
    );
    await update({
      mode: "transform-selected",
      matrix: shift(5),
      selectedRow: 0,
    });
    await expectRead(shifted(rootPositions, 5, 0, 0), "affine row 0");
    await update({ selectedRow: 2 });
    await expectRead(shifted(rootPositions, 5, 0, 2), "affine row 2");
    await update({ mode: "transform-curve", time: 0.5 });
    await expectRead(shifted(rootPositions, 1), "affine curve t=0.5");
    await update({ time: 1 });
    await expectRead(shifted(rootPositions, 2), "affine curve t=1");
    await update({ mode: "none" });

    // 12. Normal-mode displacement is additive to the trajectory, reversible
    // under scrubbing, and a fixed-time mode swap refreshes structural inputs.
    const modal = (base, version, scale) =>
      base.map((v, i) => {
        const row = Math.floor(i / 3), axis = i % 3;
        const one = [[1, 0, 0], [1, 0, 0], [0, 2, 0]];
        const two = [[0, 0, 3], [0, 0, 3], [0, -1, 0]];
        return v + scale * (version === 1 ? one : two)[row][axis];
      });
    await update({
      mode: "normal-mode",
      frame: 1,
      time: 0.25,
      amplitude: 2,
      modeVersion: 1,
    });
    await displayed({ a: 1, b: 1, t: 0 });
    await expectRead(modal(pageFrames[1], 1, 2), "normal mode forward");
    const modeUpload =
      (await counters()).detail["uploadBytes:structure:positions"] ?? 0;
    await update({ time: 0.75 });
    await expectRead(modal(pageFrames[1], 1, -2), "normal mode reverse");
    // Landing on an exact zero of the sine (t = 0) keeps the kernel mounted:
    // no mode buffer is uploaded again (9g3.10).
    const vectorUploads = async () =>
      (await counters()).detail["uploadBytes:coords:normal-mode:vectors"] ?? 0;
    const beforeZero = await vectorUploads();
    await update({ time: 0 });
    await expectRead(modal(pageFrames[1], 1, 0), "normal mode at a zero");
    await update({ time: 0.25 });
    await expectRead(modal(pageFrames[1], 1, 2), "normal mode after a zero");
    assertStrictEquals(
      await vectorUploads(),
      beforeZero,
      "a zero crossing does not re-upload mode buffers",
    );
    await update({ time: 0.25, modeVersion: 2 });
    await expectRead(modal(pageFrames[1], 2, 2), "normal mode swap");
    await update({ amplitude: 0 });
    await expectRead(pageFrames[1], "normal mode zero amplitude");
    assertStrictEquals(
      (await counters()).detail["uploadBytes:structure:positions"] ?? 0,
      modeUpload,
      "normal-mode animation does not re-upload root positions",
    );
    await update({ mode: "none" });

    // 13. The shared GPU cell list agrees with the CPU counting-sort oracle.
    // The second case crosses a 256-cell scan block boundary.
    report.cellList = [];
    const smallPoints = [-2, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0];
    for (const cutoff of [1, 2]) {
      report.cellList.push(await runGpuCellList(page, smallPoints, cutoff));
    }
    const longChain = Array.from(
      { length: 512 * 3 },
      (_, i) => i % 3 === 0 ? i / 3 : 0,
    );
    report.cellList.push(await runGpuCellList(page, longChain, 1));
    // A corpus structure at two cutoffs (the CPU reference is itself checked
    // against table.spatialGrid on the corpus in dynamics' unit tests).
    const crn = await structureFromBcif(
      await Deno.readFile(`${root}packages/io/test/fixtures/1crn.bcif`),
    );
    for (const cutoff of [4, 8]) {
      report.cellList.push(
        await runGpuCellList(page, Array.from(crn.positions), cutoff),
      );
    }

    // 14. <Superpose>: the GPU fit of each displayed frame agrees with the CPU
    // Kabsch oracle, at a ~1000 Å offset, through a mirror image (still a
    // proper rotation), for fit subsets and translate=false. Scrubbing moves
    // no reference or structure bytes. A collinear frame passes through.
    const sup = await page.evaluate(() => globalThis.__trajectory.superpose);
    const supFrame = (frame) => {
      const a = Math.floor(frame), t = frame - a;
      const b = Math.min(a + 1, sup.frames.length - 1);
      return Float32Array.from(
        t
          ? interpolatePositions(
            Float32Array.from(sup.frames[a]),
            Float32Array.from(sup.frames[b]),
            t,
          )
          : sup.frames[a],
      );
    };
    const fitRows = [0, 1, 2, 3, 4, 5];
    const oracle = (frame, { to = "first", rows = null, translate = true }) => {
      const upstream = supFrame(frame);
      const reference = Float32Array.from(
        to === "first" ? sup.frames[0] : sup.fixed,
      );
      const fit = fitKabsch(upstream, reference, rows, translate);
      return {
        positions: Array.from(applyAffine(upstream, fit.matrix)),
        rmsd: fit.rmsd,
        reference,
      };
    };
    const rmsdOf = (values, reference, rows) => {
      const list = rows ?? values.map((_, i) => i).filter((i) => i % 3 === 0)
        .map((i) => i / 3);
      let sum = 0;
      for (const row of list) {
        for (let a = 0; a < 3; a++) {
          sum += (values[3 * row + a] - reference[3 * row + a]) ** 2;
        }
      }
      return Math.sqrt(sum / list.length);
    };
    report.superpose = [];
    await page.evaluate(() =>
      globalThis.__trajectory.superpose.statuses.length = 0
    );
    const checkFit = async (frame, options = {}) => {
      const want = oracle(frame, options);
      const what = `superpose ${JSON.stringify({ frame, ...options })}`;
      // f32 positions near 1000 Å carry ~6e-5 Å of rounding.
      const got = await expectRead(want.positions, what, 2e-3);
      const rmsd = rmsdOf(got, want.reference, options.rows ?? null);
      assert(
        Math.abs(rmsd - want.rmsd) <= 1e-4,
        `${what}: rmsd ${rmsd} vs ${want.rmsd}`,
      );
      report.superpose.push({ frame, ...options, rmsd, oracle: want.rmsd });
    };
    await update({
      mode: "superpose",
      frame: 0,
      supTo: "first",
      supSelect: false,
      supTranslate: true,
    });
    await displayed({ a: 0, b: 0, t: 0 });
    await checkFit(0);
    await page.waitForFunction(() =>
      globalThis.__trajectory.superpose.statuses.some((s) =>
        s.status === "solved"
      )
    );
    const initialFitStatus = await page.evaluate(() =>
      globalThis.__trajectory.superpose.statuses.slice(-1)[0]
    );
    assertStrictEquals(initialFitStatus.status, "solved");
    assert(Math.abs(initialFitStatus.rmsd) <= 1e-3);
    const referenceUploads = async () =>
      (await counters()).detail["uploadBytes:coords:superpose:reference"] ?? 0;
    const supUploads = await referenceUploads();
    const rootUploads =
      (await counters()).detail["uploadBytes:structure:positions"] ?? 0;
    for (const frame of [1, 2, 3, 2.5]) {
      await update({ frame });
      await displayed({
        a: Math.floor(frame),
        b: Math.ceil(frame),
        t: frame % 1,
      });
      await checkFit(frame);
    }
    // Rapid backward scrub: one displayed frame per animation frame.
    await page.evaluate(async () => {
      for (const frame of [3, 2.75, 2.5, 2, 1.5, 1.25]) {
        globalThis.__trajectory.update({ frame });
        await new Promise(requestAnimationFrame);
      }
    });
    await displayed({ a: 1, b: 2, t: 0.25 });
    await checkFit(1.25);
    assertStrictEquals(
      await referenceUploads(),
      supUploads,
      "scrubbing does not re-upload the reference",
    );
    assertStrictEquals(
      (await counters()).detail["uploadBytes:structure:positions"] ?? 0,
      rootUploads,
      "scrubbing does not re-upload structure positions",
    );
    // A collinear frame has no unique rotation: it passes through.
    await page.evaluate(() =>
      globalThis.__trajectory.superpose.statuses.length = 0
    );
    await update({ frame: 4 });
    await displayed({ a: 4, b: 4, t: 0 });
    await expectRead(Array.from(supFrame(4)), "superpose collinear", 0);
    await page.waitForFunction(() =>
      globalThis.__trajectory.superpose.statuses.some((s) =>
        s.status === "passthrough"
      )
    );
    assertStrictEquals(
      (await page.evaluate(() =>
        globalThis.__trajectory.superpose.statuses.slice(-1)[0]
      )).rmsd,
      null,
    );
    // Fit rows, then translate=false, then a fixed reference.
    await update({ frame: 2, supSelect: true });
    await displayed({ a: 2, b: 2, t: 0 });
    await checkFit(2, { rows: fitRows });
    await update({ supSelect: false, supTranslate: false });
    await checkFit(2, { translate: false });
    await page.evaluate(() =>
      globalThis.__trajectory.superpose.statuses.length = 0
    );
    await update({ supTranslate: true, supTo: "fixed" });
    await checkFit(2, { to: "fixed" });
    await page.waitForFunction(() =>
      globalThis.__trajectory.superpose.statuses.some((s) =>
        s.status === "solved"
      )
    );
    const fixedFitStatus = await page.evaluate(() =>
      globalThis.__trajectory.superpose.statuses.slice(-1)[0]
    );
    assert(
      Math.abs(fixedFitStatus.rmsd - oracle(2, { to: "fixed" }).rmsd) < 1e-4,
      "reported fitted RMSD agrees with the CPU oracle",
    );
    await update({ mode: "none" });

    // Hold an old fit readback while changing reference buffers. Its eventual
    // completion must neither report a stale generation nor clear a new slot.
    await page.evaluate(() => {
      const original = GPUBuffer.prototype.mapAsync;
      let release;
      let pending = false;
      GPUBuffer.prototype.mapAsync = function (...args) {
        const mapped = original.apply(this, args);
        if (!pending && this.label === "molgpu:coords:superpose:staging") {
          pending = true;
          return new Promise((resolve, reject) => {
            release = () => mapped.then(resolve, reject);
          });
        }
        return mapped;
      };
      globalThis.__trajectory.heldFit = {
        get pending() {
          return pending;
        },
        release() {
          GPUBuffer.prototype.mapAsync = original;
          return release();
        },
      };
    });
    await update({ mode: "superpose", frame: 2, supTo: "fixed" });
    await page.waitForFunction(() => globalThis.__trajectory.heldFit.pending);
    await page.evaluate(() =>
      globalThis.__trajectory.superpose.statuses.length = 0
    );
    await update({ supTo: "first" });
    await page.waitForFunction(() =>
      globalThis.__trajectory.superpose.statuses.some((s) =>
        s.status === "solved"
      )
    );
    const freshStatuses = await page.evaluate(() =>
      globalThis.__trajectory.superpose.statuses.length
    );
    await page.evaluate(async () => {
      await globalThis.__trajectory.heldFit.release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assertStrictEquals(
      await page.evaluate(() =>
        globalThis.__trajectory.superpose.statuses.length
      ),
      freshStatuses,
      "old fit readback does not report after reference buffers change",
    );
    await update({ frame: 3 });
    await page.waitForFunction(
      (previous) =>
        globalThis.__trajectory.superpose.statuses.length > previous,
      freshStatuses,
    );
    await update({ mode: "none" });

    // 15. <Unwrap>: each displayed frame agrees with the CPU unwrapFrame on a
    // skew triclinic cell, bonds come back whole, the box follows frames,
    // centering moves the ring into the primary cell, ring ambiguity is
    // reported, and a missing or singular box passes through.
    const ringRows = [14, 15, 16, 17, 18, 19];
    const cpuUnwrap = (frame, center = null) =>
      unwrapFrame(
        Float32Array.from(unw.frames[frame]),
        forest,
        unw.boxes[frame],
        center,
      );
    const bondLengths = (values) =>
      unw.bonds.map(([a, b]) =>
        Math.hypot(
          values[3 * a] - values[3 * b],
          values[3 * a + 1] - values[3 * b + 1],
          values[3 * a + 2] - values[3 * b + 2],
        )
      );
    const wholeLengths = bondLengths(unw.root);
    const unwrapStatuses = () =>
      page.evaluate(() => globalThis.__trajectory.unwrap.statuses.slice(-1)[0]);
    await page.evaluate(() => {
      globalThis.__trajectory.unwrap.statuses.length = 0;
    });
    await update({
      mode: "unwrap",
      frame: 0,
      unwrapBox: "trajectory",
      unwrapCenter: false,
    });
    await displayed({ a: 0, b: 0, t: 0 });
    const graphUploads = async () =>
      (await counters()).detail["uploadBytes:coords:unwrap:graph"] ?? 0;
    let graphBytes;
    report.unwrap = [];
    for (const frame of [0, 1, 0, 1]) {
      await update({ frame });
      await displayed({ a: frame, b: frame, t: 0 });
      const want = cpuUnwrap(frame);
      const got = await expectRead(
        Array.from(want.positions),
        `unwrap frame ${frame}`,
        1e-4,
      );
      bondLengths(got).forEach((length, k) =>
        assert(
          Math.abs(length - wholeLengths[k]) < 1e-4,
          `unwrap frame ${frame} bond ${k}: ${length} vs ${wholeLengths[k]}`,
        )
      );
      graphBytes ??= await graphUploads();
      report.unwrap.push({ frame, status: want.status });
    }
    assertStrictEquals(
      await graphUploads(),
      graphBytes,
      "frames re-upload no forest",
    );
    await page.waitForFunction(
      () =>
        globalThis.__trajectory.unwrap.statuses.slice(-1)[0]?.status === "ok",
    );
    // Centering: the ring's centroid lands in the primary cell.
    await update({ unwrapCenter: true, frame: 1 });
    await displayed({ a: 1, b: 1, t: 0 });
    await expectRead(
      Array.from(cpuUnwrap(1, ringRows).positions),
      "unwrap centered",
      1e-4,
    );
    // Ambiguous ring closure is counted like the CPU reference.
    await update({ unwrapCenter: false, frame: 2 });
    await displayed({ a: 2, b: 2, t: 0 });
    const ambiguous = cpuUnwrap(2);
    assertStrictEquals(ambiguous.status, "ambiguous");
    await expectRead(
      Array.from(ambiguous.positions),
      "unwrap ambiguous frame",
      1e-4,
    );
    await page.waitForFunction(
      (count) => {
        const last = globalThis.__trajectory.unwrap.statuses.slice(-1)[0];
        return last?.status === "ambiguous" &&
          last.ambiguousRingEdges === count;
      },
      ambiguous.ambiguousRingEdges,
      { timeout: 5000 },
    );
    report.unwrap.push(await unwrapStatuses());
    // No box, or a singular one: positions pass through, with a status.
    await update({ unwrapBox: "singular" });
    await expectRead(unw.frames[2], "unwrap singular box", 0);
    assertStrictEquals((await unwrapStatuses()).status, "invalid-box");
    await update({ unwrapBox: "none" });
    // Without a Trajectory the probe sees the root upload itself, which is not
    // a copy source: check that no provider output is published instead.
    assertNotStrictEquals(
      await page.evaluate(() => globalThis.__trajectory.source.buffer.label),
      "molgpu:coords:provider",
      "no box: the root coordinates pass through",
    );
    assertStrictEquals((await unwrapStatuses()).status, "missing-box");
    await update({ mode: "none" });

    // A near-degenerate but valid cell exceeds the bounded search. The GPU
    // reports it and retains the best displacement found in the 27 seeds.
    await update({ mode: "unwrap-limit" });
    await expectRead(
      [0, 0, 0, -4.99, -0.01, 0],
      "unwrap search limit best image",
      1e-4,
    );
    await page.waitForFunction(() =>
      globalThis.__trajectory.unwrap.statuses.slice(-1)[0]?.status ===
        "search-limit"
    );
    assertStrictEquals((await unwrapStatuses()).ambiguousRingEdges, 0);
    await update({ mode: "none" });
    // Depth 33 takes the logarithmic fallback and remains whole.
    await update({ mode: "unwrap-deep" });
    await expectRead(
      Array.from(
        { length: 34 * 3 },
        (_, j) => j % 3 === 0 ? Math.floor(j / 3) * 1.5 : 0,
      ),
      "unwrap deep-chain fallback",
      1e-4,
    );
    await update({ mode: "none" });

    // 16. Gate 13 budgets (opt-in: `deno task gate:dynamics`). The scene is
    // root + Trajectory (four slots) + Unwrap + Superpose (reference) +
    // NormalMode at 100k and 1M atoms, as ten-atom chains in a periodic box.
    if (Deno.env.get("MOLGPU_DYNAMICS_GATE")) {
      report.gate = [];
      const MB = 1e6;
      for (const atoms of [100_000, 1_000_000]) {
        const mountStart = performance.now();
        await update({ mode: "gate", gateAtoms: atoms, frame: 0, time: 0.1 });
        await page.waitForFunction(
          (n) => {
            const t = globalThis.__trajectory;
            return t.gate?.count === n && t.state?.displayed?.a === 0;
          },
          atoms,
          { timeout: 180000 },
        );
        await settle();
        const mountMs = performance.now() - mountStart;
        const snap = await counters();
        const bytes = snap.ownedBuffers.bytes;
        // Buffers only used inside one generation's passes (held for reuse).
        const within = [
          "coords:unwrap:links",
          "coords:unwrap:params",
          "coords:unwrap:status",
          "coords:unwrap:staging",
          "coords:superpose:fit",
          "coords:superpose:params",
          "coords:superpose:staging",
        ];
        let persistent = 0, scratch = 0;
        for (const [label, n] of Object.entries(bytes)) {
          if (within.includes(label)) scratch += n;
          else persistent += n;
        }
        // The shared cell list is not mounted in this scene: add its planned
        // grid for an 8 Å cutoff over frame 0's bounds.
        const cell = await page.evaluate((n) => {
          const t = globalThis.__trajectory;
          return {
            bounds: t.gateBounds(n),
            limit: t.device.limits.maxStorageBufferBindingSize,
          };
        }, atoms);
        const plan = planCellList(
          { generation: 1, values: Float32Array.from(cell.bounds) },
          1,
          atoms,
          8,
          cell.limit,
        );
        // Warm every pipeline, then time a changed generation: a timeline
        // tick (NormalMode only) and a resident trajectory frame (all four).
        const change = (patch) =>
          page.evaluate(async (patch) => {
            const t = globalThis.__trajectory;
            const before = t.gate.generation;
            const start = performance.now();
            t.update(patch);
            let frames = 0;
            while (t.gate.generation === before && frames < 120) {
              await new Promise(requestAnimationFrame);
              frames++;
            }
            const published = performance.now() - start;
            await t.device.queue.onSubmittedWorkDone();
            return {
              frames,
              publishedMs: published,
              gpuDoneMs: performance.now() - start,
            };
          }, patch);
        for (const frame of [1, 2, 3, 0]) {
          await update({ frame });
          await page.waitForFunction(
            (f) => globalThis.__trajectory.state?.displayed?.a === f,
            frame,
            { timeout: 60000 },
          );
        }
        const dispatches = async () => {
          const d = (await counters()).detail;
          return {
            unwrap: d["gathers:coords:unwrap:dispatch"] ?? 0,
            superpose: d["gathers:coords:superpose:dispatch"] ?? 0,
          };
        };
        const ticks = [];
        const before = await dispatches();
        for (const time of [0.15, 0.2, 0.25]) {
          ticks.push(await change({ time }));
        }
        const afterTicks = await dispatches();
        assertEquals(
          afterTicks,
          before,
          "a timeline tick re-runs only NormalMode",
        );
        const frames = [];
        for (const frame of [1, 2, 3]) frames.push(await change({ frame }));
        const afterFrames = await dispatches();
        assertStrictEquals(afterFrames.unwrap - afterTicks.unwrap, 3);
        assertStrictEquals(afterFrames.superpose - afterTicks.superpose, 3);
        const worst = Math.max(...ticks.map((t) => t.frames));
        if (atoms === 100_000) {
          assert(
            worst <= 3,
            `100k: a warmed transform shows within 3 frames (${worst})`,
          );
        }
        // Bytes each full generation reads and writes per atom: trajectory
        // lerp 36; unwrap link 44 + one level accumulation (52 per
        // non-root row) + place 60; superpose 72 (centroid, covariance,
        // apply over all rows); normal mode 40.
        const perAtom = 36 + 44 + 52 * 0.9 + 60 + 72 + 40;
        report.gate.push({
          atoms,
          mountMs: Math.round(mountMs),
          ownedBytes: bytes,
          persistentMB: +(persistent / MB).toFixed(2),
          withinGenerationMB: +(scratch / MB).toFixed(2),
          cellList: {
            cells: plan.cellCount,
            persistentMB: +(plan.persistentBytes / MB).toFixed(2),
            scratchMB: +(plan.scratchBytes / MB).toFixed(2),
          },
          totalPersistentMB: +((persistent + plan.persistentBytes) / MB)
            .toFixed(2),
          totalScratchMB: +((scratch + plan.scratchBytes) / MB).toFixed(2),
          trafficPerGenerationMB: {
            fullFrame: +(perAtom * atoms / MB).toFixed(1),
            timelineTick: +(40 * atoms / MB).toFixed(1),
            fourPlainPasses: +(4 * 24 * atoms / MB).toFixed(1),
          },
          timelineTick: ticks,
          residentFrame: frames,
        });
        await update({ mode: "none" });
      }
      console.log(JSON.stringify(report.gate, null, 2));
      await Deno.writeTextFile(
        `${out}/dynamics-gate.json`,
        JSON.stringify(report.gate, null, 2),
      );
    }

    now = await counters();
    for (const [label, bytes] of Object.entries(now.ownedBuffers.bytes)) {
      if (label.startsWith("coords:")) {
        assertStrictEquals(bytes, 0, `${label} leaked`);
      }
    }
    assertStrictEquals(
      now.ownedBuffers.live,
      baseline.ownedBuffers.live,
      "every owned buffer released",
    );
    const pageErrors = await page.evaluate(() =>
      globalThis.__trajectory.errors
    );
    assertEquals(
      [...errors, ...pageErrors],
      [],
      "no page or WebGPU errors",
    );
    // Source and frame failures are reported through onStatus, never thrown
    // (molgpu-sept-s5o.18): upstream coordinates pass through meanwhile.
    const statuses = () =>
      page.evaluate(() =>
        globalThis.__trajectory.statuses.map((s) => ({
          ...s,
          ...(s.error === undefined ? {} : { error: String(s.error) }),
        }))
      );
    const clearStatuses = () =>
      page.evaluate(() => globalThis.__trajectory.statuses.length = 0);
    await clearStatuses();
    await update({
      mode: "reload",
      src: "failure.xtc",
      frame: 0,
      interpolate: "linear",
      reloadData: false,
    });
    await page.waitForFunction(() =>
      globalThis.__trajectory.loads.length === 6
    );
    const beforeSource = errors.length;
    await page.evaluate(() =>
      globalThis.__trajectory.loads[5].reject(new Error("reload test failure"))
    );
    await page.waitForFunction(() =>
      globalThis.__trajectory.statuses.some((s) => s.status === "error")
    );
    await settle();
    assertEquals(
      await statuses(),
      [
        { status: "opening" },
        {
          status: "error",
          phase: "source",
          frame: null,
          error: "Error: reload test failure",
        },
      ],
      "a source failure reports opening, then a source error",
    );
    assertEquals(
      errors.slice(beforeSource),
      [],
      "a source failure is not thrown",
    );
    // Children see upstream coordinates (copied through the idle kernel) and
    // no trajectory scope.
    assertStrictEquals(
      await page.evaluate(() => globalThis.__trajectory.state),
      null,
      "a failed source exposes no trajectory",
    );
    await expectRead(rootPositions, "failed source passes upstream through");
    // Retry by changing the request; the old failure is not repeated.
    await clearStatuses();
    await update({ src: "retry.xtc" });
    await page.waitForFunction(() =>
      globalThis.__trajectory.loads.length === 7
    );
    await page.evaluate(() => globalThis.__trajectory.loads[6].resolve());
    await displayed({ a: 0, b: 0, t: 0 });
    assertEquals(
      await statuses(),
      [{ status: "opening" }, { status: "ready", frameCount: 4 }],
      "retry reports opening, then ready, without the previous failure",
    );
    assertEquals(errors.slice(beforeSource), [], "retry raises no errors");
    await update({ mode: "none" });
    // A frame read failure is sticky for its player and passes through.
    await clearStatuses();
    const beforeFrame = errors.length;
    await update({ mode: "data-retry", badFrames: true });
    await page.waitForFunction(() =>
      globalThis.__trajectory.statuses.some((s) => s.status === "error")
    );
    await settle();
    assertEquals(
      await statuses(),
      [
        { status: "ready", frameCount: 1 },
        {
          status: "error",
          phase: "frame",
          frame: 0,
          error: "Error: frame retry test failure",
        },
      ],
      "a frame failure reports ready, then a frame error",
    );
    assertEquals(
      errors.slice(beforeFrame),
      [],
      "a frame failure is not thrown",
    );
    assertStrictEquals(
      await page.evaluate(() => globalThis.__trajectory.state?.displayed),
      null,
      "a failed player displays no frame",
    );
    await expectRead(rootPositions, "failed frame passes upstream through");
    await clearStatuses();
    await update({ badFrames: false });
    await displayed({ a: 0, b: 0, t: 0 });
    assertEquals(
      await statuses(),
      [{ status: "ready", frameCount: 4 }],
      "a replacement player does not inherit frame failure",
    );
    await update({ mode: "none" });
    // Without a callback, each failure is logged once rather than thrown.
    const beforeLogged = errors.length;
    await update({ mode: "data-retry", badFrames: true, reportStatus: false });
    for (let i = 0; i < 50 && errors.length === beforeLogged; i++) {
      await settle();
    }
    // Further renders of the same failed player must not log again.
    await update({ frame: 0.5 });
    const logged = errors.slice(beforeLogged);
    assertStrictEquals(logged.length, 1, `one console error: ${logged}`);
    assertMatch(logged[0], /<Trajectory>: frame 0 failed to load/);
    errors.length = beforeLogged;
    await update({ reportStatus: true, badFrames: false });
    await update({ mode: "none" });
    const rejectedFirst = page.waitForEvent("pageerror", { timeout: 5000 });
    await update({ mode: "scope-superpose", frame: 0 });
    const rejection = String(await rejectedFirst);
    assert(
      rejection.includes(
        '<Superpose to="first"> needs a <Trajectory> ancestor',
      ),
      `nested Superpose rejects the absent trajectory: ${rejection}`,
    );
    report.readPolls = polls;
    await Deno.writeTextFile(
      `${out}/trajectory-report.json`,
      JSON.stringify(report, null, 2),
    );
  } finally {
    await browser?.close();
    await server.shutdown();
  }
});
