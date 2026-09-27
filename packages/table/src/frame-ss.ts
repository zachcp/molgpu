// Per-frame secondary structure for a file trajectory (efv.8): CPU DSSP on
// integer frames read from TrajectoryData.source, cached with a byte cap. The
// same cache serves the cartoon of a paused frame and SS-vs-time plots.
import type { StructureData } from "./structure-types.ts";
import type { TrajectoryData } from "./trajectory-types.ts";
import { activeAtoms } from "./structure-view.ts";
import { withPositions } from "./structure.ts";
import { dssp } from "./dssp.ts";

/** @internal Per-frame `ssCode` values for trajectory-aware consumers. */
export interface FrameSecondaryStructure {
  /** `ssCode` values per residue for integer frame `index`, computed once. */
  frame(index: number, signal?: AbortSignal): Promise<Uint8Array>;
  /** Codes for each listed frame, in order: an SS-vs-time matrix. */
  timeline(
    frames: ArrayLike<number>,
    signal?: AbortSignal,
  ): Promise<Uint8Array[]>;
}

/** @internal Deep-module utility; the package entrypoint exposes DSSP instead.
 *
 * DSSP of `trajectory`'s frames over `data`'s topology. A frame's positions
 * replace `data`'s rows (through `atomMap` when the trajectory covers a subset)
 * and `dssp` reads `rows` (default: the active model and altlocs). At most
 * `maxBytes` of codes stay cached (least recently used first out; default
 * 64 MiB, one byte per residue per frame).
 */
export function frameSecondaryStructure(
  data: StructureData,
  trajectory: TrajectoryData,
  options: { readonly rows?: ArrayLike<number>; readonly maxBytes?: number } =
    {},
): FrameSecondaryStructure {
  const { atoms, residues } = data.topology;
  const map = trajectory.atomMap;
  if (!map && trajectory.atomCount !== atoms.count) {
    throw new TypeError(
      `frameSecondaryStructure: trajectory has ${trajectory.atomCount} atoms, structure ${atoms.count}`,
    );
  }
  const rows = options.rows ?? activeAtoms(data);
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!(maxBytes >= 0)) {
    throw new TypeError("frameSecondaryStructure: maxBytes must be >= 0");
  }
  const capacity = Math.max(
    1,
    Math.floor(maxBytes / Math.max(1, residues.count)),
  );
  const cache = new Map<number, Promise<Uint8Array>>();
  const compute = async (index: number, signal?: AbortSignal) => {
    const frame = await trajectory.source.read(index, signal);
    const positions = map ? data.positions.slice() : frame.positions;
    if (map) {
      for (let i = 0; i < map.length; i++) {
        positions.set(frame.positions.subarray(i * 3, i * 3 + 3), map[i] * 3);
      }
    }
    return dssp(withPositions(data, positions), { rows });
  };
  const frame = (index: number, signal?: AbortSignal): Promise<Uint8Array> => {
    if (
      !Number.isInteger(index) || index < 0 || index >= trajectory.frameCount
    ) {
      return Promise.reject(
        new RangeError(`frameSecondaryStructure: no frame ${index}`),
      );
    }
    let hit = cache.get(index);
    if (hit) {
      cache.delete(index); // refresh recency
    } else {
      hit = compute(index, signal);
      // A failed or aborted frame is not cached.
      hit.catch(() => cache.get(index) === hit && cache.delete(index));
    }
    cache.set(index, hit);
    while (cache.size > capacity) cache.delete(cache.keys().next().value!);
    return hit;
  };
  return Object.freeze({
    frame,
    async timeline(frames: ArrayLike<number>, signal?: AbortSignal) {
      const out: Uint8Array[] = [];
      for (let k = 0; k < frames.length; k++) {
        out.push(await frame(frames[k], signal));
      }
      return out;
    },
  });
}
