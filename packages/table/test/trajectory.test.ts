import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  createStructure,
  createTrajectory,
  type StructureInput,
  validateTrajectory,
} from "@molgpu/table";
import { validateTrajectoryFrame } from "../src/trajectory.ts";
import { trajectoryFromModels } from "./models-trajectory.ts";
import { fixture } from "./fixture.ts";

const frame = (n: number, v: number) => ({
  positions: new Float32Array(n * 3).fill(v),
});

/** Three atoms in one residue, repeated as `models` models with shifted x. */
function ensemble(models: number, edit?: (input: StructureInput) => void) {
  const n = 3 * models;
  const input: StructureInput = {
    positions: Float32Array.from(
      { length: n * 3 },
      (_, i) => i % 3 === 0 ? Math.floor(i / 9) * 10 + ((i / 3) % 3) : 0,
    ),
    topology: {
      atoms: {
        count: n,
        id: Array.from({ length: n }, (_, i) => String(i + 1)),
        name: Array.from({ length: n }, (_, i) => ["N", "CA", "C"][i % 3]),
        altloc: new Array(n).fill(""),
        residue: Uint32Array.from({ length: n }, (_, i) => Math.floor(i / 3)),
        element: Uint8Array.from({ length: n }, (_, i) => i % 3 ? 6 : 7),
        occupancy: new Float32Array(n).fill(1),
        bfactor: new Float32Array(n),
      },
      residues: {
        count: models,
        chain: Uint32Array.from({ length: models }, (_, i) => i),
        labelSeq: new Int32Array(models).fill(1),
        authSeq: new Array(models).fill("1"),
        insertionCode: new Array(models).fill(""),
        comp: new Array(models).fill("GLY"),
        polymer: new Array(models).fill("protein"),
      },
      chains: {
        count: models,
        model: Int32Array.from({ length: models }, (_, i) => i + 1),
        labelId: new Array(models).fill("A"),
        authId: new Array(models).fill("A"),
      },
      bonds: {
        count: 0,
        a: new Uint32Array(),
        b: new Uint32Array(),
        order: new Uint8Array(),
        source: [],
      },
      instances: {
        count: 0,
        chain: new Uint32Array(),
        operatorId: [],
        transform: new Float64Array(),
      },
    },
  };
  edit?.(input);
  return createStructure(input);
}

Deno.test("createTrajectory validates frames, time and atomMap", () => {
  const t = createTrajectory({
    atomCount: 2,
    frames: [frame(2, 0), frame(2, 1)],
    time: [0, 2.5],
    timeUnit: "ps",
    atomMap: [4, 1],
  });
  assertEquals(t.frameCount, 2);
  assertEquals([...t.time], [0, 2.5]);
  assertEquals(t.timeUnit, "ps");
  assertEquals([...t.atomMap!], [4, 1]);
  assert(Object.isFrozen(t));

  const noTime = createTrajectory({ atomCount: 1, frames: [frame(1, 0)] });
  assertEquals(noTime.timeUnit, "index");
  assertEquals([...noTime.time], [0]);

  const bad: [() => unknown, RegExp][] = [
    [() => createTrajectory({ atomCount: 0, frames: [] }), /atomCount/],
    [() => createTrajectory({ atomCount: 1 }), /exactly one of frames/],
    [() => createTrajectory({ atomCount: 1, frames: [] }), /nonempty/],
    [
      () => createTrajectory({ atomCount: 2, frames: [frame(1, 0)] }),
      /frames\[0\]\.positions: expected Float32Array\[6\]/,
    ],
    [
      () =>
        createTrajectory({
          atomCount: 1,
          frames: [{ positions: Float32Array.of(0, NaN, 0) }],
        }),
      /positions\[1\]: expected finite/,
    ],
    [
      () =>
        createTrajectory({
          atomCount: 1,
          frames: [{ ...frame(1, 0), box: new Float32Array(6) }],
        }),
      /box: expected Float32Array\[9\]/,
    ],
    [
      () =>
        createTrajectory({
          atomCount: 1,
          frames: [frame(1, 0), frame(1, 0)],
          time: [1, 0],
        }),
      /time\[1\]: expected nondecreasing/,
    ],
    [
      () =>
        createTrajectory({ atomCount: 1, frames: [frame(1, 0)], time: [0, 1] }),
      /time: expected length 1/,
    ],
    [
      () =>
        createTrajectory({
          atomCount: 1,
          frames: [frame(1, 0)],
          timeUnit: "ps",
        }),
      /needs time/,
    ],
    [
      () =>
        createTrajectory({
          atomCount: 2,
          frames: [frame(2, 0)],
          atomMap: [1],
        }),
      /atomMap: expected length 2/,
    ],
    [
      () =>
        createTrajectory({
          atomCount: 2,
          frames: [frame(2, 0)],
          atomMap: [3, 3],
        }),
      /atomMap\[1\]: duplicate row 3/,
    ],
    [
      () =>
        createTrajectory({
          atomCount: 1,
          frames: [frame(1, 0)],
          atomMap: [-1],
        }),
      /atomMap\[0\]: expected a topology row/,
    ],
    [
      () =>
        createTrajectory({
          atomCount: 1,
          source: { read: () => Promise.resolve(frame(1, 0)) },
        }),
      /frameCount/,
    ],
  ];
  for (const [f, message] of bad) {
    assertMatch((assertThrows(f, TypeError) as Error).message, message);
  }
});

Deno.test("in-memory source reads, rejects out of range and honours abort", async () => {
  const t = createTrajectory({
    atomCount: 1,
    frames: [frame(1, 0), frame(1, 7)],
  });
  const a = await t.source.read(1);
  assertEquals([...a.positions], [7, 7, 7]);
  assertStrictEquals(
    await t.source.read(1),
    a,
    "frame i read twice is identical",
  );
  await assertRejects(() => t.source.read(2), RangeError);
  await assertRejects(() => t.source.read(0.5), RangeError);
  const controller = new AbortController();
  controller.abort();
  const error = await assertRejects(() => t.source.read(0, controller.signal));
  assertEquals((error as DOMException).name, "AbortError");
  const reason = new Error("caller reason");
  const custom = new AbortController();
  custom.abort(reason);
  assertStrictEquals(
    await assertRejects(() => t.source.read(0, custom.signal)),
    reason,
  );
});

Deno.test("source-backed reads keep the abort reason before and after the read", async () => {
  const reason = new Error("caller reason");
  let abortDuringRead: AbortController | null = null;
  const t = createTrajectory({
    atomCount: 1,
    frameCount: 1,
    // A source that ignores its signal entirely.
    source: {
      read: () => {
        abortDuringRead?.abort(reason);
        return Promise.resolve(frame(1, 3));
      },
    },
  });
  const pre = new AbortController();
  pre.abort(reason);
  assertStrictEquals(
    await assertRejects(() => t.source.read(0, pre.signal)),
    reason,
  );
  const during = new AbortController();
  abortDuringRead = during;
  assertStrictEquals(
    await assertRejects(() => t.source.read(0, during.signal)),
    reason,
    "an abort before publication is not swallowed by an unaware source",
  );
  abortDuringRead = null;
  assertEquals([...(await t.source.read(0)).positions], [3, 3, 3]);
});

Deno.test("validateTrajectory checks atom count and atomMap rows", () => {
  const structure = createStructure(fixture()); // six atoms
  const whole = createTrajectory({ atomCount: 6, frames: [frame(6, 0)] });
  assertStrictEquals(validateTrajectory(structure, whole), whole);
  assertThrows(
    () =>
      validateTrajectory(
        structure,
        createTrajectory({ atomCount: 5, frames: [frame(5, 0)] }),
      ),
    TypeError,
    "5 atoms per frame, but the structure has 6; pass an atomMap",
  );
  const subset = createTrajectory({
    atomCount: 2,
    frames: [frame(2, 0)],
    atomMap: [5, 0],
  });
  assertStrictEquals(validateTrajectory(structure, subset), subset);
  assertThrows(
    () =>
      validateTrajectory(
        structure,
        createTrajectory({
          atomCount: 2,
          frames: [frame(2, 0)],
          atomMap: [0, 6],
        }),
      ),
    TypeError,
    "atomMap[1]: row 6 out of range (structure has 6)",
  );
});

Deno.test("validateTrajectoryFrame names the field", () => {
  assertThrows(
    () =>
      validateTrajectoryFrame(
        { ...frame(1, 0), velocities: new Float32Array(2) },
        1,
      ),
    TypeError,
    "frame.velocities: expected Float32Array[3]",
  );
});

Deno.test("trajectoryFromModels plays models as frames over model 1", async () => {
  const data = ensemble(3);
  const t = trajectoryFromModels(data);
  assertEquals(t.frameCount, 3);
  assertEquals(t.atomCount, 3);
  assertEquals(t.timeUnit, "index");
  assertEquals([...t.atomMap!], [0, 1, 2]);
  validateTrajectory(data, t);
  for (let k = 0; k < 3; k++) {
    const { positions } = await t.source.read(k);
    assertEquals([positions[0], positions[3], positions[6]], [
      k * 10,
      k * 10 + 1,
      k * 10 + 2,
    ]);
  }

  const single = trajectoryFromModels(ensemble(1));
  assertEquals(single.frameCount, 1);
  assertEquals(single.atomMap, undefined, "all rows: no map needed");
});

Deno.test("trajectoryFromModels rejects models that differ", () => {
  assertThrows(
    () =>
      trajectoryFromModels(ensemble(2, (input) => {
        (input.topology.atoms.name as string[])[4] = "CB";
      })),
    TypeError,
    "model 2 row 4: atom 1 differs from model 1 row 1",
  );
  assertThrows(
    () => trajectoryFromModels(createStructure(fixture())),
    TypeError,
    "model 2: has 1 atoms, but model 1 has 5",
  );
});
