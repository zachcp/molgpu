// Executable acceptance for the data ownership decision (molgpu-sept-crj.10):
// docs/findings/2026-10-01-data-ownership-decision.md.
import {
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  createStructure,
  createTrajectory,
  createVolume,
  type FrameSource,
  withAttributes,
  withPositions,
} from "@molgpu/table";
import { fixture } from "./fixture.ts";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

Deno.test("ownership: structure constructors copy caller columns", () => {
  const input = fixture();
  const data = createStructure(input);
  input.positions[0] = 99;
  (input.topology.atoms.bfactor as Float32Array)[0] = 99;
  assertEquals(data.positions[0], 0);
  assertEquals(data.topology.atoms.bfactor[0], 0);

  const moved = new Float32Array(data.positions.length);
  const next = withPositions(data, moved);
  moved[0] = 99;
  assertEquals(next.positions[0], 0);

  const charge = new Float32Array(data.topology.atoms.count);
  const tagged = withAttributes(data, {
    partialCharge: {
      domain: "atom",
      kind: "scalar",
      values: charge,
      provenance: "user",
    },
  });
  charge[0] = 99;
  assertEquals(tagged.attributes!.partialCharge.values[0], 0);
});

Deno.test("ownership: createVolume adopts values as a transfer", () => {
  const values = new Float32Array(8).fill(1);
  const volume = createVolume({ values, dims: [2, 2, 2], transform: IDENTITY });
  // Transfer: the caller relinquishes `values`. Mutating it afterwards is a
  // contract violation that would also leave `stats` stale.
  assertStrictEquals(volume.values, values);
  assertEquals(volume.stats.max, 1);
});

Deno.test("ownership: molecular values do not survive structured clone", () => {
  const data = createStructure(fixture());
  const clone = structuredClone(data);
  assertThrows(
    () => withPositions(clone, clone.positions),
    TypeError,
    "identity",
  );
  const trajectory = createTrajectory({
    atomCount: data.topology.atoms.count,
    frames: [{ positions: data.positions }],
  });
  assertThrows(() => structuredClone(trajectory), DOMException);
});

Deno.test({
  name: "ownership: createTrajectory copies in-memory frames [crj.24]",
  fn: async () => {
    const positions = new Float32Array(6 * 3);
    const box = Float32Array.of(10, 0, 0, 0, 10, 0, 0, 0, 10);
    const trajectory = createTrajectory({
      atomCount: 6,
      frames: [{ positions, box }],
    });
    positions[0] = 99;
    box[0] = 99;
    const frame = await trajectory.source.read(0);
    assertNotStrictEquals(frame.positions, positions);
    assertEquals(frame.positions[0], 0);
    assertEquals(frame.box![0], 10);
  },
});

Deno.test({
  name: "ownership: every FrameSource read is validated [crj.24]",
  fn: async () => {
    const n = 6;
    const source = (positions: unknown): FrameSource => ({
      read: () => Promise.resolve({ positions: positions as Float32Array }),
    });
    const wrongType = createTrajectory({
      atomCount: n,
      frameCount: 1,
      source: source(new Float64Array(n * 3)),
    });
    await assertRejects(
      () => wrongType.source.read(0),
      TypeError,
      "Float32Array",
    );
    const notFinite = createTrajectory({
      atomCount: n,
      frameCount: 1,
      source: source(new Float32Array(n * 3).fill(NaN)),
    });
    await assertRejects(() => notFinite.source.read(0), TypeError, "finite");
    const valid = createTrajectory({
      atomCount: n,
      frameCount: 1,
      source: source(new Float32Array(n * 3)),
    });
    await assertRejects(() => valid.source.read(1), RangeError);
    const aborted = AbortSignal.abort();
    await assertRejects(() => valid.source.read(0, aborted), DOMException);
  },
});
