import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertInstanceOf,
  assertRejects,
} from "@std/assert";
import {
  activeAtoms,
  type TrajectoryData,
  validateTrajectory,
} from "@molgpu/table";
import { AKMA_PS, trajectoryFromDcd } from "../src/dcd.ts";
import { byteSource, urlByteSource } from "../src/byte-source.ts";
import { IoError, openTrajectory, structureFromBcif } from "../src/index.ts";
import { trajectoryFormat } from "../src/trajectory.ts";
import { trajectoryFromTrr } from "../src/trr.ts";
import { trajectoryFromXtc } from "../src/xtc.ts";
import { trajectoryFromModels } from "../../table/test/models-trajectory.ts";
import type { ByteSource } from "../src/index.ts";
import {
  proteinFrames,
  tile,
  writeDcd,
  writeTrr,
  writeXtc,
} from "./trajectory-fixture.ts";
import { _parseDcd } from "molstar/lib/mol-io/reader/dcd/parser.js";
import { parseXtc } from "molstar/lib/mol-io/reader/xtc/parser.js";
import { parseTrr } from "molstar/lib/mol-io/reader/trr/parser.js";

const code = async (p: Promise<unknown>, expected: string) => {
  const error = await assertRejects(() => p, IoError);
  assertEquals((error as IoError).code, expected, error.message);
};
const frames = async (t: TrajectoryData) =>
  await Promise.all(
    Array.from({ length: t.frameCount }, (_, i) => t.source.read(i)),
  );
const near = (
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  tol: number,
  what: string,
) => {
  assertEquals(a.length, b.length, `${what}: length`);
  for (let i = 0; i < a.length; i++) {
    if (!(Math.abs(a[i] - b[i]) <= tol)) {
      throw new Error(`${what}[${i}]: ${a[i]} vs ${b[i]} (tol ${tol})`);
    }
  }
};
/** Fresh bytes, because Mol*'s DCD/TRR readers ignore byteOffset and swap in place. */
const copy = (b: Uint8Array) => new Uint8Array(b);
const xyz = (
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  z: ArrayLike<number>,
) =>
  Float32Array.from(
    { length: x.length * 3 },
    (_, i) => [x, y, z][i % 3][Math.floor(i / 3)],
  );

// ------------------------------------------------------------------ DCD

Deno.test("DCD: CHARMM frames, cells and times match the writer and Mol*", async () => {
  const known = (await proteinFrames()).slice(0, 4);
  const cells = [
    [40, 90, 50, 90, 90, 60], // degrees, orthorhombic
    [40, 0, 50, 0, 0, 60], // cosines of 90°
    [40, 0.5, 50, 0, 0, 60], // cos γ = 0.5: γ = 60°
    [0, 0, 0, 0, 0, 0], // no box
  ];
  const bytes = writeDcd({
    frames: known,
    cells,
    istart: 100,
    nsavc: 10,
    delta: 2,
  });
  const t = await trajectoryFromDcd(bytes);
  assertEquals([t.atomCount, t.frameCount, t.timeUnit], [1231, 4, "ps"]);
  for (let i = 0; i < 4; i++) {
    assertAlmostEquals(t.time[i], (100 + i * 10) * 2 * AKMA_PS, 1e-9);
  }
  const decoded = await frames(t);
  decoded.forEach((f, i) => assertEquals(f.positions, known[i], `frame ${i}`));
  near(decoded[0].box!, [40, 0, 0, 0, 50, 0, 0, 0, 60], 1e-5, "degrees box");
  near(decoded[1].box!, [40, 0, 0, 0, 50, 0, 0, 0, 60], 1e-5, "cosine box");
  near(
    decoded[2].box!,
    [40, 0, 0, 25, 50 * Math.sin(Math.PI / 3), 0, 0, 0, 60],
    1e-4,
    "γ=60",
  );
  assertEquals(decoded[3].box, undefined);

  const oracle = _parseDcd(copy(bytes));
  oracle.frames.forEach((f, i) =>
    assertEquals(xyz(f.x, f.y, f.z), decoded[i].positions, `Mol* frame ${i}`)
  );
});

Deno.test("DCD: X-PLOR, big-endian, triclinic, stale NSET", async () => {
  const known = (await proteinFrames()).slice(4, 7);
  for (const nset of [0, 99]) {
    const t = await trajectoryFromDcd(
      writeDcd({
        frames: known,
        charmm: false,
        little: false,
        delta: 0.5,
        nset,
      }),
    );
    assertEquals(t.frameCount, 3, `NSET ${nset} is ignored`);
    assertAlmostEquals(t.time[2], 2 * 0.5 * AKMA_PS, 1e-9);
    (await frames(t)).forEach((f, i) => assertEquals(f.positions, known[i]));
  }
  const tri = await trajectoryFromDcd(
    writeDcd({ frames: known.slice(0, 1), cells: [[30, 100, 40, 95, 80, 50]] }),
  );
  const box = (await tri.source.read(0)).box!;
  const length = (c: number) =>
    Math.hypot(box[c * 3], box[c * 3 + 1], box[c * 3 + 2]);
  const angle = (p: number, q: number) =>
    Math.acos(
      (box[p * 3] * box[q * 3] + box[p * 3 + 1] * box[q * 3 + 1] +
        box[p * 3 + 2] * box[q * 3 + 2]) / length(p) / length(q),
    ) * 180 / Math.PI;
  near([length(0), length(1), length(2)], [30, 40, 50], 1e-4, "lengths");
  near([angle(1, 2), angle(0, 2), angle(0, 1)], [80, 95, 100], 1e-3, "α β γ");
});

Deno.test("DCD: no timestep, truncation, fixed atoms and bad input", async () => {
  const known = (await proteinFrames()).slice(0, 3);
  const steps = await trajectoryFromDcd(
    writeDcd({ frames: known, istart: 5, nsavc: 2 }),
  );
  assertEquals([steps.timeUnit, [...steps.time]], ["step", [5, 7, 9]]);

  const whole = writeDcd({ frames: known });
  const partial = await trajectoryFromDcd(
    whole.subarray(0, whole.length - 100),
  );
  assertEquals(partial.frameCount, 2, "a trailing partial frame is ignored");
  await code(trajectoryFromDcd(whole.subarray(0, 50)), "TRUNCATED_TRAJECTORY");
  await code(trajectoryFromDcd(whole.subarray(0, 300)), "TRUNCATED_TRAJECTORY");
  await code(
    trajectoryFromDcd(writeDcd({ frames: known, namnf: 3 })),
    "UNSUPPORTED_TRAJECTORY",
  );
  const bad = copy(whole);
  bad[4] = 88; // "XORD"
  await code(trajectoryFromDcd(bad), "INVALID_TRAJECTORY");
  const corrupt = copy(whole);
  new DataView(corrupt.buffer).setInt32(whole.length - 4, 7, true);
  const t = await trajectoryFromDcd(corrupt);
  await code(t.source.read(2), "INVALID_TRAJECTORY");
});

// ------------------------------------------------------------------ XTC

Deno.test("XTC: compressed frames match the writer within precision and Mol* exactly", async () => {
  const known = (await proteinFrames()).slice(0, 5);
  const box = [52, 0, 0, 0, 48, 0, 0, 0, 61];
  const bytes = writeXtc(
    known.map((positions, i) => ({ positions, box, time: 2.5 * i })),
  );
  assert(
    bytes.length < known.length * 1231 * 12 * 0.5,
    `compressed: ${bytes.length} bytes`,
  );
  const t = await trajectoryFromXtc(bytes);
  assertEquals([t.atomCount, t.frameCount, t.timeUnit], [1231, 5, "ps"]);
  assertEquals([...t.time], [0, 2.5, 5, 7.5, 10]);
  const oracle = await parseXtc(copy(bytes)).run();
  assert(!oracle.isError);
  // Out of order, and each frame twice.
  for (const i of [3, 0, 4, 1, 2, 3]) {
    const f = await t.source.read(i);
    // 0.5 / precision nm = 0.005 Å, plus float32 rounding.
    near(f.positions, known[i], 0.0051, `frame ${i}`);
    const o = oracle.result.frames[i];
    assertEquals(f.positions, xyz(o.x, o.y, o.z), `Mol* frame ${i}`);
    near(f.box!, box, 1e-4, "box");
  }
});

Deno.test("XTC: uncompressed small frames, large coordinates, bad input", async () => {
  const few = [
    Float32Array.of(1, 2, 3, -4, 5.5, 6),
    Float32Array.of(0, 0, 0, 1, 1, 1),
  ];
  const small = await trajectoryFromXtc(
    writeXtc(few.map((positions) => ({ positions }))),
  );
  near((await small.source.read(0)).positions, few[0], 1e-5, "raw floats");
  assertEquals((await small.source.read(1)).box, undefined);

  // Coordinates spanning more than 0xffffff quanta take the per-axis path.
  const wide = Float32Array.from(
    { length: 30 },
    (_, i) => (i % 7) * 40000 - 100000 + i,
  );
  const t = await trajectoryFromXtc(writeXtc([{ positions: wide }]));
  near((await t.source.read(0)).positions, wide, 0.0051 + 1e-2, "wide");

  const protein = (await proteinFrames())[0];
  const a = writeXtc([{ positions: protein }]);
  const b = writeXtc([{ positions: protein.subarray(0, 300) }]);
  const mixed = new Uint8Array([...a, ...b]);
  await code(trajectoryFromXtc(mixed), "INVALID_TRAJECTORY");
  const two = writeXtc([{ positions: protein }, { positions: protein }]);
  assertEquals(
    (await trajectoryFromXtc(two.subarray(0, two.length - 10))).frameCount,
    1,
  );
  const bad = copy(two);
  bad[3] = 0;
  await code(trajectoryFromXtc(bad), "INVALID_TRAJECTORY");
  await code(trajectoryFromXtc(two.subarray(0, 20)), "TRUNCATED_TRAJECTORY");
  const decreasing = writeXtc([{ positions: protein, time: 5 }, {
    positions: protein,
    time: 1,
  }]);
  await code(trajectoryFromXtc(decreasing), "INVALID_TRAJECTORY");
});

Deno.test("XTC: 100k-atom decode time and a 10k-frame header scan", async () => {
  const protein = (await proteinFrames())[0];
  const big = tile(protein, 82); // 100,942 atoms
  const bytes = writeXtc([0, 1, 2].map((i) => ({ positions: big, time: i })));
  const t = await trajectoryFromXtc(bytes);
  assertEquals(t.atomCount, 100942);
  await t.source.read(0); // warm the lazy Mol* import
  const decoded = [];
  const start = performance.now();
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < 3; i++) decoded.push(await t.source.read(i));
  }
  const decode = (performance.now() - start) / decoded.length;
  near(decoded[1].positions, big, 0.0051, "100k");
  console.log(
    `XTC decode, 100,942 atoms: ${decode.toFixed(1)} ms/frame; ` +
      `${(bytes.length / 3 / 100942).toFixed(2)} B/atom`,
  );

  // 10,000 frames of 12 atoms: count the reads the header scan makes.
  const one = writeXtc([{ positions: protein.subarray(0, 36) }]);
  const many = new Uint8Array(one.length * 10000);
  for (let i = 0; i < 10000; i++) many.set(one, i * one.length);
  let reads = 0;
  const inner = byteSource(many);
  const counted: ByteSource = {
    size: inner.size,
    read: (o, l, s) => (reads++, inner.read(o, l, s)),
  };
  const open = performance.now();
  const long = await trajectoryFromXtc(counted);
  console.log(
    `XTC open, 10,000 frames (${many.length} bytes): ` +
      `${(performance.now() - open).toFixed(1)} ms, ${reads} reads`,
  );
  assertEquals(long.frameCount, 10000);
  assert(
    reads <= Math.ceil(many.length / (4 * 1024 * 1024)) + 1,
    `${reads} reads`,
  );
});

// ------------------------------------------------------------------ TRR

Deno.test("TRR: single and double precision, velocities opt-in, frames without positions", async () => {
  const known = (await proteinFrames()).slice(0, 3);
  const box = [50, 0, 0, 0, 50, 0, 0, 0, 50];
  const velocities = known.map((p) => p.map((v) => v * 0.01));
  const file = writeTrr([
    { positions: known[0], velocities: velocities[0], box, time: 0 },
    { velocities: velocities[1], box, time: 0.5 }, // no positions: skipped
    { positions: known[1], box, time: 1 },
    { positions: known[2], velocities: velocities[2], box, time: 2 },
  ]);
  const plain = await trajectoryFromTrr(file);
  assertEquals([plain.frameCount, [...plain.time]], [3, [0, 1, 2]]);
  const decoded = await frames(plain);
  decoded.forEach((f, i) => {
    near(f.positions, known[i], 1e-5, `frame ${i}`);
    assertEquals(f.velocities, undefined, "velocities are opt-in");
    near(f.box!, box, 1e-5, "box");
  });
  const withV = await frames(
    await trajectoryFromTrr(file, { velocities: true }),
  );
  near(withV[0].velocities!, velocities[0], 1e-6, "velocities");
  assertEquals(withV[1].velocities, undefined);
  near(withV[2].velocities!, velocities[2], 1e-6, "velocities");

  const oracle = await parseTrr(
    copy(writeTrr(known.map((positions) => ({ positions, box })))),
  ).run();
  assert(!oracle.isError);
  oracle.result.frames.forEach((o, i) =>
    assertEquals(xyz(o.x, o.y, o.z), decoded[i].positions, `Mol* frame ${i}`)
  );

  const double = await trajectoryFromTrr(
    writeTrr(known.map((positions) => ({ positions })), { double: true }),
  );
  const d = await frames(double);
  d.forEach((f, i) => {
    near(f.positions, known[i], 1e-5, `double frame ${i}`);
    assertEquals(f.box, undefined);
  });
  await code(
    trajectoryFromTrr(writeTrr([{ velocities: velocities[0] }])),
    "TRUNCATED_TRAJECTORY",
  );
  const bad = copy(file);
  bad[3] = 0;
  await code(trajectoryFromTrr(bad), "INVALID_TRAJECTORY");
});

// ------------------------------------------------------------ NMR ensembles

Deno.test("2k39: a multi-model BCIF plays as 116 frames over model 1", async () => {
  const bytes = await Deno.readFile(
    new URL("./fixtures/2k39.bcif", import.meta.url),
  );
  const structure = await structureFromBcif(bytes);
  const t = trajectoryFromModels(structure);
  validateTrajectory(structure, t);
  assertEquals([t.frameCount, t.atomCount, t.timeUnit], [116, 1231, "index"]);
  const shown = activeAtoms(structure); // the default view policy's first model
  assertEquals(
    [...t.atomMap!],
    [...shown],
    "atomMap is the rows the view shows",
  );
  const { chains: c, residues: r, atoms: a } = structure.topology;
  const models = [...new Set(c.model)];
  for (const k of [0, 57, 115]) {
    const rows = [...Array(a.count).keys()].filter((i) =>
      c.model[r.chain[a.residue[i]]] === models[k]
    );
    const expected = Float32Array.from(
      rows.flatMap((i) => [...structure.positions.subarray(i * 3, i * 3 + 3)]),
    );
    assertEquals(
      (await t.source.read(k)).positions,
      expected,
      `model ${k + 1}`,
    );
  }
});

// ------------------------------------------------------------------ sources

Deno.test("openTrajectory: formats, Blobs, Files and HTTP Range", async () => {
  assertEquals(trajectoryFormat("run.XTC?x=1"), "xtc");
  assertEquals(trajectoryFormat("https://a/b/run.dcd#t"), "dcd");
  assertEquals(trajectoryFormat("run.pdb"), null);
  const known = (await proteinFrames()).slice(0, 3);
  const xtc = writeXtc(known.map((positions) => ({ positions })));
  const file = new File([xtc], "traj.xtc");
  assertEquals((await openTrajectory(file)).frameCount, 3);
  assertEquals(
    (await openTrajectory(new Blob([xtc]), { format: "xtc" })).frameCount,
    3,
  );
  await code(openTrajectory(xtc), "INVALID_INPUT");
  await code(openTrajectory(xtc, { format: "pdb" as "xtc" }), "INVALID_INPUT");

  const ranges: string[] = [];
  const server = Deno.serve({ port: 0, onListen: () => {} }, (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/missing.xtc") {
      return new Response("no", { status: 404 });
    }
    const range = request.headers.get("range");
    if (url.pathname === "/plain.xtc" || !range) return new Response(xtc);
    ranges.push(range);
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range)!;
    const end = Math.min(Number(b), xtc.length - 1);
    return new Response(xtc.slice(Number(a), end + 1), {
      status: 206,
      headers: { "content-range": `bytes ${a}-${end}/${xtc.length}` },
    });
  });
  try {
    const base = `http://127.0.0.1:${server.addr.port}`;
    const remote = await openTrajectory(`${base}/range.xtc`);
    near(
      (await remote.source.read(2)).positions,
      known[2],
      0.0051,
      "range frame",
    );
    assertEquals(ranges.length, 3, `probe, header block, frame: ${ranges}`);
    const plain = await openTrajectory(`${base}/plain.xtc`);
    near(
      (await plain.source.read(1)).positions,
      known[1],
      0.0051,
      "full download",
    );
    await code(
      openTrajectory(`${base}/plain.xtc`, { maxDownload: 100 }),
      "TRAJECTORY_TOO_LARGE",
    );
    await code(urlByteSource(`${base}/missing.xtc`), "FETCH_FAILED");
  } finally {
    await server.shutdown();
  }
  const controller = new AbortController();
  controller.abort();
  const t = await openTrajectory(file);
  const error = await assertRejects(() => t.source.read(0, controller.signal));
  assertInstanceOf(error, DOMException);
});

Deno.test("URL fallback stops a chunked download at maxDownload", async () => {
  let chunks = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(4));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const get = (() => Promise.resolve(new Response(stream))) as typeof fetch;
  await code(
    urlByteSource("https://example.test/run.xtc", {
      maxDownload: 5,
      fetch: get,
    }),
    "TRAJECTORY_TOO_LARGE",
  );
  assert(cancelled, "the response body is cancelled at the limit");
  assert(chunks < 10, "the stream is not consumed to completion");
});

Deno.test("XTC frame reads reject with the abort reason after bytes arrive", async () => {
  const bytes = writeXtc([{ positions: new Float32Array([1, 2, 3]) }]);
  const reason = new Error("cancelled after bytes became available");
  let abortAfterRead: AbortController | null = null;
  const opening = new AbortController();
  const t = await openTrajectory({
    size: bytes.length,
    read(offset, length) {
      const controller = abortAfterRead;
      // Abort only once readExactly has seen the bytes, before decode/publish.
      if (controller) {
        queueMicrotask(() => queueMicrotask(() => controller.abort(reason)));
      }
      return Promise.resolve(bytes.subarray(offset, offset + length));
    },
  }, { format: "xtc", signal: opening.signal });
  // Frame signals are independent of the opening signal.
  opening.abort();
  assertEquals((await t.source.read(0)).positions.length, 3);
  const late = new AbortController();
  abortAfterRead = late;
  const error = await assertRejects(() => t.source.read(0, late.signal));
  assert(error === reason, "post-byte abort keeps signal.reason");
  abortAfterRead = null;
  const again = await assertRejects(() => t.source.read(0, late.signal));
  assert(again === reason, "pre-aborted read keeps signal.reason");
  const fresh = await t.source.read(0, new AbortController().signal);
  assertEquals(fresh.positions.length, 3, "a fresh read still succeeds");
});
