// Renderer-free trajectories: per-frame coordinates over a structure's fixed
// topology. See docs/findings/2026-09-26-trajectory-plan.md.
import type {
  FrameSource,
  TrajectoryData,
  TrajectoryFrame,
  TrajectoryInput,
} from "./trajectory-types.ts";
import type { StructureData } from "./structure-types.ts";

const fail = (path: string, message: string): never => {
  throw new TypeError(`${path}: ${message}`);
};
const count = (n: unknown, path: string, min = 0): void => {
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < min) {
    fail(
      path,
      min
        ? "expected positive safe integer"
        : "expected nonnegative safe integer",
    );
  }
};
const finiteArray = (values: ArrayLike<number>, path: string): void => {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      fail(`${path}[${i}]`, "expected finite number");
    }
  }
};

const abortError = (): Error =>
  new DOMException("frame read aborted", "AbortError");

/** @internal Frame validation is part of createTrajectory's public contract. */
export function validateTrajectoryFrame(
  frame: TrajectoryFrame,
  atomCount: number,
  path = "frame",
): TrajectoryFrame {
  if (!frame || typeof frame !== "object") fail(path, "expected object");
  const { positions, box, velocities } = frame;
  if (
    !(positions instanceof Float32Array) || positions.length !== atomCount * 3
  ) {
    fail(`${path}.positions`, `expected Float32Array[${atomCount * 3}]`);
  }
  finiteArray(positions, `${path}.positions`);
  if (box !== undefined) {
    if (!(box instanceof Float32Array) || box.length !== 9) {
      fail(`${path}.box`, "expected Float32Array[9] (column-major 3×3)");
    }
    finiteArray(box, `${path}.box`);
  }
  if (velocities !== undefined) {
    if (
      !(velocities instanceof Float32Array) ||
      velocities.length !== atomCount * 3
    ) {
      fail(`${path}.velocities`, `expected Float32Array[${atomCount * 3}]`);
    }
    finiteArray(velocities, `${path}.velocities`);
  }
  return frame;
}

/** An in-memory source over validated, frozen frames. */
function memorySource(frames: readonly TrajectoryFrame[]): FrameSource {
  return Object.freeze({
    read(index: number, signal?: AbortSignal): Promise<TrajectoryFrame> {
      if (signal?.aborted) return Promise.reject(abortError());
      if (!Number.isInteger(index) || index < 0 || index >= frames.length) {
        return Promise.reject(
          new RangeError(`frame ${index} out of range [0, ${frames.length})`),
        );
      }
      return Promise.resolve(frames[index]);
    },
  });
}

/**
 * Validate `input` and wrap it as a frozen `TrajectoryData`. With `frames`,
 * each frame is validated and the trajectory reads from memory; with `source`,
 * `frameCount` is required and frames are validated by whoever decodes them.
 * `time` defaults to the frame index (`timeUnit: "index"`).
 */
export function createTrajectory(input: TrajectoryInput): TrajectoryData {
  if (!input || typeof input !== "object") {
    fail("trajectory", "expected object");
  }
  const { atomCount, frames, source, atomMap } = input;
  count(atomCount, "trajectory.atomCount", 1);
  if ((frames === undefined) === (source === undefined)) {
    fail("trajectory", "expected exactly one of frames or source");
  }
  let frameCount: number;
  let read: FrameSource;
  if (frames !== undefined) {
    if (!Array.isArray(frames) || !frames.length) {
      fail("trajectory.frames", "expected a nonempty array");
    }
    if (input.frameCount !== undefined && input.frameCount !== frames.length) {
      fail(
        "trajectory.frameCount",
        `expected ${frames.length} (frames.length)`,
      );
    }
    const owned = frames.map((frame, i) =>
      Object.freeze({
        ...validateTrajectoryFrame(frame, atomCount, `trajectory.frames[${i}]`),
      })
    );
    frameCount = owned.length;
    read = memorySource(Object.freeze(owned));
  } else {
    if (!source || typeof source.read !== "function") {
      fail("trajectory.source", "expected a FrameSource");
    }
    count(input.frameCount, "trajectory.frameCount", 1);
    frameCount = input.frameCount!;
    read = source!;
  }
  let time: Float64Array;
  if (input.time === undefined) {
    if (input.timeUnit !== undefined && input.timeUnit !== "index") {
      fail("trajectory.timeUnit", "a time unit other than index needs time");
    }
    time = Float64Array.from({ length: frameCount }, (_, i) => i);
  } else {
    if (input.time.length !== frameCount) {
      fail("trajectory.time", `expected length ${frameCount}`);
    }
    time = Float64Array.from(input.time);
    finiteArray(time, "trajectory.time");
    for (let i = 1; i < time.length; i++) {
      if (time[i] < time[i - 1]) {
        fail(`trajectory.time[${i}]`, "expected nondecreasing time");
      }
    }
  }
  const timeUnit = input.timeUnit ??
    (input.time === undefined ? "index" : "ps");
  if (!["ps", "step", "index"].includes(timeUnit)) {
    fail("trajectory.timeUnit", "expected ps, step or index");
  }
  let map: Uint32Array | undefined;
  if (atomMap !== undefined) {
    if (atomMap.length !== atomCount) {
      fail("trajectory.atomMap", `expected length ${atomCount} (atomCount)`);
    }
    const seen = new Set<number>();
    for (let i = 0; i < atomMap.length; i++) {
      const row = atomMap[i];
      if (!Number.isInteger(row) || row < 0 || row > 0xfffffffe) {
        fail(`trajectory.atomMap[${i}]`, "expected a topology row");
      }
      if (seen.has(row)) {
        fail(`trajectory.atomMap[${i}]`, `duplicate row ${row}`);
      }
      seen.add(row);
    }
    map = Uint32Array.from(atomMap);
  }
  return Object.freeze({
    atomCount,
    frameCount,
    time,
    timeUnit,
    ...(map ? { atomMap: map } : {}),
    source: read,
  });
}

/**
 * Throw a `TypeError` if `trajectory` cannot move `structure`: without an
 * `atomMap` its atom count must equal the structure's; with one, every mapped
 * row must exist. Frames are not decoded. Returns the trajectory.
 */
export function validateTrajectory(
  structure: StructureData,
  trajectory: TrajectoryData,
): TrajectoryData {
  const rows = structure.topology.atoms.count;
  const { atomCount, atomMap } = trajectory;
  if (!atomMap) {
    if (atomCount !== rows) {
      fail(
        "trajectory.atomCount",
        `${atomCount} atoms per frame, but the structure has ${rows}; pass an atomMap for a subset`,
      );
    }
    return trajectory;
  }
  if (atomMap.length !== atomCount) {
    fail("trajectory.atomMap", `expected length ${atomCount} (atomCount)`);
  }
  for (let i = 0; i < atomMap.length; i++) {
    if (atomMap[i] >= rows) {
      fail(
        `trajectory.atomMap[${i}]`,
        `row ${atomMap[i]} out of range (structure has ${rows})`,
      );
    }
  }
  return trajectory;
}

/** @internal Timeline interpolation helper; not part of the package entrypoint. */
export function frameAtTime(trajectory: TrajectoryData, t: number): number {
  if (!Number.isFinite(t)) fail("time", "expected finite number");
  const time = trajectory.time;
  const last = time.length - 1;
  if (t <= time[0]) return 0;
  if (t >= time[last]) return time.indexOf(time[last]);
  let lo = 0, hi = last; // time[lo] < t < time[hi]
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (time[mid] < t) lo = mid;
    else hi = mid;
  }
  return lo + (t - time[lo]) / (time[hi] - time[lo]);
}

/** @internal Convert an NMR multi-model structure into its trajectory view.
 *
 * A multi-model structure (an NMR ensemble) as a trajectory over the same
 * structure: frame `k` holds model `k`'s coordinates, in the order models are
 * first encountered, and `atomMap` points at the rows of the first model — the
 * model the default view policy shows. Every model must list the same atoms in
 * the same order; the first difference throws a `TypeError` naming the model
 * and row. A single-model structure gives one frame and no `atomMap`.
 */
export function trajectoryFromModels(data: StructureData): TrajectoryData {
  const { atoms: a, residues: r, chains: c } = data.topology;
  if (!a.count) fail("structure", "expected at least one atom");
  const models: number[] = [];
  const rowsOf = new Map<number, number[]>();
  for (let i = 0; i < a.count; i++) {
    const residue = a.residue[i];
    const model = c.model[r.chain[residue]];
    let rows = rowsOf.get(model);
    if (!rows) {
      rowsOf.set(model, rows = []);
      models.push(model);
    }
    rows.push(i);
  }
  const first = rowsOf.get(models[0])!;
  const key = (i: number): string => {
    const residue = a.residue[i];
    return JSON.stringify([
      a.element[i],
      a.name[i],
      a.altloc[i],
      a.comp?.[i] ?? r.comp[residue],
      r.labelSeq[residue],
      c.labelId[r.chain[residue]],
    ]);
  };
  const reference = first.map(key);
  const frames = models.map((model) => {
    const rows = rowsOf.get(model)!;
    if (rows.length !== first.length) {
      fail(
        `model ${model}`,
        `has ${rows.length} atoms, but model ${
          models[0]
        } has ${first.length}; models must list the same atoms`,
      );
    }
    const positions = new Float32Array(rows.length * 3);
    rows.forEach((row, j) => {
      if (key(row) !== reference[j]) {
        fail(
          `model ${model} row ${row}`,
          `atom ${j} differs from model ${models[0]} row ${first[j]} (${
            reference[j]
          } vs ${key(row)})`,
        );
      }
      positions[j * 3] = data.positions[row * 3];
      positions[j * 3 + 1] = data.positions[row * 3 + 1];
      positions[j * 3 + 2] = data.positions[row * 3 + 2];
    });
    return { positions };
  });
  return createTrajectory({
    atomCount: first.length,
    frames,
    ...(first.length === a.count ? {} : { atomMap: first }),
  });
}
