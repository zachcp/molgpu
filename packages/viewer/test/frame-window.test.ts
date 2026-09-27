import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import type { FrameSource, TrajectoryFrame } from "@molgpu/table";
import {
  framePair,
  FrameScheduler,
  interpolatePositions,
  prefetchFrames,
  resolveDisplay,
  SlotTable,
  TrajectoryImageBoxLimitError,
} from "../src/internal/frame-window.ts";
import { FrameCache } from "../src/internal/frame-cache.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Frames whose every coordinate equals the frame index, after `latency` ms. */
function slowSource(
  atoms: number,
  latency: number,
): FrameSource & { reads: number[] } {
  const reads: number[] = [];
  return {
    reads,
    read(index: number, signal?: AbortSignal) {
      reads.push(index);
      return new Promise<TrajectoryFrame>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve({ positions: new Float32Array(atoms * 3).fill(index) }),
          latency,
        );
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    },
  };
}

Deno.test("framePair clamps, rounds, snaps and rejects non-finite frames", () => {
  assertEquals(framePair(2.25, 10, "linear"), { a: 2, b: 3, t: 0.25 });
  assertEquals(framePair(2.75, 10, "nearest"), { a: 3, b: 3, t: 0 });
  assertEquals(framePair(-4, 10, "linear"), { a: 0, b: 0, t: 0 });
  assertEquals(framePair(9.5, 10, "linear"), { a: 9, b: 9, t: 0 });
  assertEquals(framePair(4, 10, "linear"), { a: 4, b: 4, t: 0 });
  assertEquals(framePair(1.9999999, 10, "linear"), { a: 2, b: 2, t: 0 });
  assertThrows(() => framePair(NaN, 10, "linear"), TypeError);
});

Deno.test("prefetchFrames reads ahead in the direction of travel", () => {
  const pair = { a: 4, b: 5, t: 0.5 };
  assertEquals(prefetchFrames(pair, 1, 2, 10), [6, 7]);
  assertEquals(prefetchFrames(pair, -1, 2, 10), [3, 2]);
  assertEquals(prefetchFrames({ a: 9, b: 9, t: 0 }, 1, 2, 10), []);
});

Deno.test("resolveDisplay falls back to the nearer resident frame, then the last pair", () => {
  const wanted = { a: 4, b: 5, t: 0.3 };
  const last = { a: 9, b: 9, t: 0 };
  const has = (...frames: number[]) => (f: number) => frames.includes(f);
  assertEquals(resolveDisplay(wanted, has(4, 5), last), wanted);
  assertEquals(resolveDisplay(wanted, has(5), last), { a: 5, b: 5, t: 0 });
  assertEquals(resolveDisplay(wanted, has(4, 9), last), { a: 4, b: 4, t: 0 });
  assertEquals(resolveDisplay({ ...wanted, t: 0.7 }, has(4, 5), last)?.t, 0.7);
  assertEquals(resolveDisplay(wanted, has(9), last), last);
  assertEquals(resolveDisplay(wanted, has(), null), null);
});

Deno.test("SlotTable replaces the least recently used unpinned slot", () => {
  const slots = new SlotTable(3);
  assertEquals([0, 1, 2].map((f) => slots.assign(f, new Set())), [0, 1, 2]);
  slots.slotOf(0); // 1 is now the oldest
  assertEquals(
    slots.assign(7, new Set([1])),
    2,
    "1 is pinned, 2 is next oldest",
  );
  assertEquals(slots.frames(), [0, 1, 7]);
  assertEquals(slots.assign(8, new Set([0, 1, 7])), -1, "everything pinned");
  assertEquals(
    slots.assign(1, new Set()),
    1,
    "a resident frame keeps its slot",
  );
});

Deno.test("interpolatePositions: lerp, and minimum image across a wrap", () => {
  const p0 = Float32Array.of(1, 2, 3, 9.5, 5, 5);
  const p1 = Float32Array.of(3, 2, 1, 0.5, 5, 5); // atom 1 wraps across x = 10
  const lerp = interpolatePositions(p0, p1, 0.25);
  assertEquals([...lerp.subarray(0, 3)], [1.5, 2, 2.5]);
  assertAlmostEquals(lerp[3], 7.25, 1e-6, "plain lerp crosses the box");
  const box = Float32Array.of(10, 0, 0, 0, 10, 0, 0, 0, 10);
  const wrapped = interpolatePositions(p0, p1, 0.25, box);
  assertAlmostEquals(
    wrapped[3],
    9.75,
    1e-5,
    "minimum image moves 0.25 of +1 Å",
  );
  assertAlmostEquals(wrapped[0], 1.5, 1e-6);
  // A mildly skew box retains its shortest Cartesian image.
  const tri = Float32Array.of(10, 0, 0, 5, 8, 0, 0, 0, 10);
  const q0 = Float32Array.of(0.2, 0.2, 0), q1 = Float32Array.of(4.8, 7.8, 0);
  const t = interpolatePositions(q0, q1, 1, tri);
  assertAlmostEquals(t[0], 4.8 - 5, 1e-5);
  assertAlmostEquals(t[1], 7.8 - 8, 1e-5);
  // Here fractional rounding instead chooses a longer Cartesian path.
  const skew = Float32Array.of(10, 0, 0, 9, 1, 0, 0, 0, 10);
  const exact = interpolatePositions(
    Float32Array.of(0, 0, 0),
    Float32Array.of(9.31, 0.49, 0),
    0.5,
    skew,
  );
  assertAlmostEquals(exact[0], 0.155, 1e-5);
  assertAlmostEquals(exact[1], -0.255, 1e-5);
  assertThrows(
    () =>
      interpolatePositions(
        Float32Array.of(0, 0, 0),
        Float32Array.of(5, 0, 0),
        0.5,
        Float32Array.of(10, 0, 0, 9.999, 0.001, 0, 0, 0, 10),
      ),
    TrajectoryImageBoxLimitError,
  );
});

Deno.test("FrameScheduler never uploads over a displayed or wanted frame", () => {
  const frames = new Map<number, TrajectoryFrame>(
    Array.from(
      { length: 20 },
      (_, i) => [i, { positions: Float32Array.of(i, i, i) }],
    ),
  );
  const cache = { want() {}, get: (i: number) => frames.get(i) };
  const writes: [number, number][] = [];
  const s = new FrameScheduler(
    cache,
    20,
    (slot, index) => writes.push([slot, index]),
  );
  assertEquals(s.update(3.5, "linear"), { a: 3, b: 4, t: 0.5 });
  const slotOf = (f: number) => s.slots.frames().indexOf(f);
  const shown = [slotOf(3), slotOf(4)];
  writes.length = 0;
  // Jump far away: the old pair (3, 4) may still be read by a pending
  // dispatch, the new pair (12, 13) must land, so prefetch gets no slot.
  assertEquals(s.update(12.5, "linear"), { a: 12, b: 13, t: 0.5 });
  assert(
    writes.every(([slot]) => !shown.includes(slot)),
    JSON.stringify(writes),
  );
  assertEquals(writes.map(([, f]) => f), [12, 13]);
});

Deno.test("frame cache: forward playback at 30 fps never holds on a 20 ms source", async () => {
  const source = slowSource(100, 20);
  const cache = new FrameCache(source, 200);
  let uploads = 0;
  const s = new FrameScheduler(cache, 200, () => uploads++);
  // Ticks at 30 fps, one frame per tick, the way a timeline curve plays.
  for (let frame = 0; frame < 45; frame++) {
    const shown = s.update(frame, "linear");
    if (frame === 2) s.holds = 0; // warm-up: the first two frames load cold
    if (frame > 2) {
      assertEquals(shown, { a: frame, b: frame, t: 0 }, `frame ${frame}`);
    }
    await sleep(1000 / 30);
  }
  assertEquals(s.holds, 0);
  assert(uploads >= 45 && uploads <= source.reads.length, `${uploads} uploads`);
  cache.close();
});

Deno.test("frame cache: a backwards seek holds, then shows the new frame", async () => {
  const source = slowSource(10, 20);
  const cache = new FrameCache(source, 100);
  const s = new FrameScheduler(cache, 100, () => {});
  let landed = 0;
  cache.onLoad = () => landed++;
  for (const f of [40, 41, 42]) {
    s.update(f, "linear");
    await sleep(40);
  }
  assertEquals(s.update(42, "linear"), { a: 42, b: 42, t: 0 });
  // 5.5 is not loaded: the last pair stays on screen, and reads go backwards.
  assertEquals(s.update(5.5, "linear"), { a: 42, b: 42, t: 0 });
  await sleep(40);
  assert(landed > 0);
  assertEquals(s.update(5.5, "linear"), { a: 5, b: 6, t: 0.5 });
  assert(
    source.reads.includes(4) && source.reads.includes(3),
    `${source.reads}`,
  );
  cache.close();
});

Deno.test("frame cache: memory stays under the cap on a long trajectory", async () => {
  const source = slowSource(1000, 0); // 12 kB per frame
  const cap = 100_000;
  const cache = new FrameCache(source, 500, cap);
  const s = new FrameScheduler(cache, 500, () => {});
  let peak = 0;
  for (let frame = 0; frame < 300; frame += 0.5) {
    s.update(frame, "linear");
    await sleep(0);
    peak = Math.max(peak, cache.stats.bytes);
  }
  assert(peak <= cap, `peak ${peak} > cap ${cap}`);
  assert(cache.stats.frames >= 2);
  cache.close();
});

Deno.test("frame cache: aborts stale prefetches and pins needed frames", async () => {
  const source = slowSource(10, 30);
  const cache = new FrameCache(source, 100, 1); // cap below one frame
  cache.want([10], [11, 12]);
  cache.want([50], []);
  assertEquals(cache.stats.aborted, 3);
  await sleep(50);
  assert(cache.has(50), "a needed frame is kept even over the cap");
  assertEquals(cache.stats.frames, 1);
  cache.close();
});

Deno.test("frame cache: a failed prefetch is reported when needed, without retry churn", async () => {
  const reads: number[] = [];
  const errors: number[] = [];
  const cache = new FrameCache({
    read(index: number) {
      reads.push(index);
      return index === 1
        ? Promise.reject(new Error("bad frame"))
        : Promise.resolve({ positions: Float32Array.of(index, index, index) });
    },
  }, 3);
  cache.onError = (index) => errors.push(index);
  cache.want([0], [1]);
  await sleep(0);
  assertEquals(errors, [], "a failed prefetch is not yet on screen");
  cache.want([0], [1]);
  await sleep(0);
  assertEquals(reads.filter((i) => i === 1).length, 1);

  cache.want([1]);
  await sleep(0);
  assertEquals(errors, [1], "the needed frame failure reaches the caller");
  cache.want([1]);
  await sleep(0);
  assertEquals(reads.filter((i) => i === 1).length, 1);
  assertEquals(errors, [1]);

  cache.want([2]); // seeking away permits a later retry
  cache.want([1]);
  await sleep(0);
  assertEquals(reads.filter((i) => i === 1).length, 2);
  assertEquals(errors, [1, 1]);
  cache.close();
});
