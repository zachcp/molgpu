// Writes site/assets/1crn-motion.xtc: the 1CRN atoms moved by a smooth,
// seamlessly looping synthetic motion (three low-frequency displacement
// waves, about 1 Å), encoded with the in-test XTC writer. Deterministic; the
// site's trajectory demo streams it through <Trajectory src>.
//
//   deno run -A scripts/make-demo-trajectory.ts
import { structureFromBcif } from "../packages/io/src/index.ts";
import { writeXtc } from "../packages/io/test/trajectory-fixture.ts";

export const FRAMES = 60;

const root = new URL("../", import.meta.url);
const data = await structureFromBcif(
  await Deno.readFile(new URL("packages/io/test/fixtures/1crn.bcif", root)),
);
const base = data.positions;
// Each wave: a displacement direction, a spatial wavevector (1/Å) and phase.
const waves = [
  { dir: [0.9, 0.3, 0.2], k: [0.11, 0.04, 0.02], phase: 0.0, amp: 0.9 },
  { dir: [-0.2, 0.8, 0.5], k: [0.03, 0.12, -0.05], phase: 2.1, amp: 0.7 },
  { dir: [0.3, -0.4, 0.85], k: [-0.06, 0.02, 0.1], phase: 4.2, amp: 0.6 },
];
const frames = Array.from({ length: FRAMES }, (_, f) => {
  const angle = (2 * Math.PI * f) / FRAMES;
  const positions = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 3) {
    const x = [base[i], base[i + 1], base[i + 2]];
    const d = [0, 0, 0];
    for (const w of waves) {
      const s = w.amp *
        Math.sin(
          angle + w.phase + w.k[0] * x[0] + w.k[1] * x[1] + w.k[2] * x[2],
        );
      for (let a = 0; a < 3; a++) d[a] += s * w.dir[a];
    }
    for (let a = 0; a < 3; a++) positions[i + a] = x[a] + d[a];
  }
  return { positions, time: f * 2, step: f * 1000 }; // 2 ps apart
});
const bytes = writeXtc(frames);
const out = new URL("site/assets/1crn-motion.xtc", root);
await Deno.writeFile(out, bytes);
console.log(
  `${out.pathname}: ${FRAMES} frames × ${
    base.length / 3
  } atoms, ${bytes.length} bytes`,
);
