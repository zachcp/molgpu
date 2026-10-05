// Renderer-free trajectories: per-frame coordinates over a structure's fixed
// topology.
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

const inRange = (index: number, frameCount: number): void => {
  if (!Number.isInteger(index) || index < 0 || index >= frameCount) {
    throw new RangeError(`frame ${index} out of range [0, ${frameCount})`);
  }
};

/** Shallow-freeze a validated frame, copying its arrays unless adopted. */
const ownFrame = (
  frame: TrajectoryFrame,
  atomCount: number,
  path: string,
  adopt: boolean,
): TrajectoryFrame => {
  const { positions, box, velocities } = validateTrajectoryFrame(
    frame,
    atomCount,
    path,
  );
  const copy = (values: Float32Array) => adopt ? values : values.slice();
  return Object.freeze({
    positions: copy(positions),
    ...(box === undefined ? {} : { box: copy(box) }),
    ...(velocities === undefined ? {} : { velocities: copy(velocities) }),
  });
};

/** An in-memory source over validated, frozen frames. */
function memorySource(frames: readonly TrajectoryFrame[]): FrameSource {
  return Object.freeze({
    read(index: number, signal?: AbortSignal): Promise<TrajectoryFrame> {
      if (signal?.aborted) return Promise.reject(signal.reason);
      try {
        inRange(index, frames.length);
      } catch (error) {
        return Promise.reject(error);
      }
      return Promise.resolve(frames[index]);
    },
  });
}

/**
 * Check every frame a caller's source returns before any consumer caches it.
 * The source keeps ownership of the frame's arrays and must never write them
 * again; consumers may retain them.
 */
function validatedSource(
  source: FrameSource,
  atomCount: number,
  frameCount: number,
): FrameSource {
  return Object.freeze({
    async read(index: number, signal?: AbortSignal): Promise<TrajectoryFrame> {
      signal?.throwIfAborted();
      inRange(index, frameCount);
      const frame = await source.read(index, signal);
      // A source that ignores its signal must still not publish after abort.
      signal?.throwIfAborted();
      return ownFrame(
        frame,
        atomCount,
        `trajectory.source.read(${index})`,
        true,
      );
    },
  });
}

/**
 * Validate `input` and wrap it as a frozen `TrajectoryData`. With `frames`,
 * each frame is validated and its arrays are copied, so callers keep ownership
 * of their inputs. With `source`, `frameCount` is required and every frame the
 * source returns is validated on read; the source must never write a frame's
 * arrays after returning it. `time` defaults to the frame index
 * (`timeUnit: "index"`).
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
      ownFrame(frame, atomCount, `trajectory.frames[${i}]`, false)
    );
    frameCount = owned.length;
    read = memorySource(Object.freeze(owned));
  } else {
    if (!source || typeof source.read !== "function") {
      fail("trajectory.source", "expected a FrameSource");
    }
    count(input.frameCount, "trajectory.frameCount", 1);
    frameCount = input.frameCount!;
    read = validatedSource(source!, atomCount, frameCount);
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
