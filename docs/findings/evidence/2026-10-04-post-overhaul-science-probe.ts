// Execute from the repository root using deno run -A <this-file>.
// Small local fixture; no network, GPU, or timing assumptions.
import { openTrajectory } from "../../../packages/io/src/index.ts";
import { writeXtc } from "../../../packages/io/test/trajectory-fixture.ts";

const bytes = writeXtc([{ positions: new Float32Array([1, 2, 3]) }]);
const controller = new AbortController();
const reason = new Error("cancelled after bytes became available");
let armed = false;
const trajectory = await openTrajectory({
  size: bytes.length,
  read(offset, length) {
    if (armed) {
      queueMicrotask(() => queueMicrotask(() => controller.abort(reason)));
    }
    return Promise.resolve(bytes.subarray(offset, offset + length));
  },
}, { format: "xtc" });
armed = true;
try {
  const frame = await trajectory.source.read(0, controller.signal);
  console.log({
    phase: "post-byte cancellation",
    aborted: controller.signal.aborted,
    outcome: "resolved",
    positions: Array.from(frame.positions),
  });
} catch (error) {
  console.log({
    phase: "post-byte cancellation",
    outcome: "rejected",
    preservesReason: error === reason,
  });
}
try {
  await trajectory.source.read(0, controller.signal);
} catch (error) {
  console.log({
    phase: "already aborted",
    outcome: "rejected",
    preservesReason: error === reason,
  });
}
