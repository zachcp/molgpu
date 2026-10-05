// GROMACS XTC trajectories, streamed one frame at a time. Frames are
// variable-length, so opening walks the frame headers (in large blocks) to
// build an offset index; each frame is then decoded by Mol*'s XTC decoder on a
// one-frame slice, which it reads as a one-frame file.
import type { TrajectoryData } from "@molgpu/table";
import {
  BlockReader,
  byteSource,
  parsedTrajectory,
  readExactly,
  trajectoryError,
} from "./byte-source.ts";
import type { ByteSource, TrajectoryReadOptions } from "./types.ts";

const MAGIC = 1995;
/** magic, natoms, step, time, 9 box floats. */
const HEADER = 52;

const invalid = (message: string): never => {
  throw trajectoryError(`XTC: ${message}`, "INVALID_TRAJECTORY");
};

type ParseXtc =
  typeof import("molstar/lib/mol-io/reader/xtc/parser.js").parseXtc;
let decoder: Promise<ParseXtc> | undefined;
const loadDecoder = (): Promise<ParseXtc> =>
  decoder ??= import("molstar/lib/mol-io/reader/xtc/parser.js").then(
    (module) => module.parseXtc,
    (error) => {
      decoder = undefined;
      throw trajectoryError(
        "Unable to load the optional Mol* XTC decoder",
        "PARSER_UNAVAILABLE",
        error,
      );
    },
  );

interface Index {
  atoms: number;
  offsets: number[];
  lengths: number[];
  time: number[];
}

async function indexFrames(reader: BlockReader): Promise<Index> {
  const index: Index = { atoms: 0, offsets: [], lengths: [], time: [] };
  let at = 0;
  while (at < reader.size) {
    const frame = index.offsets.length;
    if (reader.size - at < HEADER + 4) {
      // A partial trailing header: a file still being written, or cut short.
      break;
    }
    const head = await reader.view(
      at,
      Math.min(HEADER + 40, reader.size - at),
      "XTC header",
    );
    if (head.getInt32(0) !== MAGIC) {
      invalid(
        `frame ${frame} at byte ${at}: bad magic number ${head.getInt32(0)}`,
      );
    }
    const atoms = head.getInt32(4);
    if (atoms <= 0) invalid(`frame ${frame}: atom count ${atoms}`);
    if (frame === 0) index.atoms = atoms;
    else if (atoms !== index.atoms) {
      invalid(`frame ${frame} has ${atoms} atoms, frame 0 has ${index.atoms}`);
    }
    let length: number;
    if (atoms <= 9) length = HEADER + 4 + 12 * atoms;
    else {
      if (head.byteLength < HEADER + 40) break;
      const bytes = head.getInt32(HEADER + 36);
      if (bytes < 0) invalid(`frame ${frame}: negative compressed size`);
      length = HEADER + 40 + Math.ceil(bytes / 4) * 4;
    }
    if (at + length > reader.size) break;
    index.offsets.push(at);
    index.lengths.push(length);
    index.time.push(head.getFloat32(12));
    at += length;
  }
  if (!index.offsets.length) {
    throw trajectoryError(
      "XTC: the file holds no complete frame",
      "TRUNCATED_TRAJECTORY",
    );
  }
  return index;
}

/**
 * Open a GROMACS XTC trajectory for streaming. Opening reads frame headers in
 * 4 MiB blocks; `source.read(i)` fetches one frame and decodes it with Mol*.
 * Positions and boxes are converted from nm to Å; times are picoseconds. A
 * trailing partial frame is ignored. Fails with an `IoError` (format `trajectory`).
 */
export async function trajectoryFromXtc(
  input: Uint8Array | Blob | ByteSource,
  options: TrajectoryReadOptions = {},
): Promise<TrajectoryData> {
  const bytes = byteSource(input);
  const index = await indexFrames(
    new BlockReader(bytes, 4 * 1024 * 1024, options.signal),
  );
  const count = index.offsets.length;
  return parsedTrajectory("XTC", {
    atomCount: index.atoms,
    frameCount: count,
    time: Float64Array.from(index.time),
    timeUnit: "ps",
    source: Object.freeze({
      async read(i: number, signal?: AbortSignal) {
        if (!Number.isInteger(i) || i < 0 || i >= count) {
          throw new RangeError(`frame ${i} out of range [0, ${count})`);
        }
        const [parseXtc, frame] = await Promise.all([
          loadDecoder(),
          readExactly(
            bytes,
            index.offsets[i],
            index.lengths[i],
            signal,
            `XTC frame ${i}`,
          ),
        ]);
        // The decoder may load after the bytes arrive, and one frame's decode
        // is too short to reach Mol*'s cooperative abort points: check around it.
        signal?.throwIfAborted();
        const parsed = await parseXtc(frame).run();
        signal?.throwIfAborted();
        if (parsed.isError || parsed.result.frames.length !== 1) {
          throw trajectoryError(
            `XTC: Mol* could not decode frame ${i}`,
            "INVALID_TRAJECTORY",
            parsed.isError ? parsed.message : undefined,
          );
        }
        const { x, y, z, count: atoms } = parsed.result.frames[0];
        if (atoms !== index.atoms) {
          invalid(`frame ${i}: decoded ${atoms} atoms`);
        }
        const positions = new Float32Array(atoms * 3);
        for (let a = 0; a < atoms; a++) {
          positions[a * 3] = x[a];
          positions[a * 3 + 1] = y[a];
          positions[a * 3 + 2] = z[a];
          if (!Number.isFinite(x[a] + y[a] + z[a])) {
            invalid(`frame ${i}: atom ${a} is not finite`);
          }
        }
        const b = parsed.result.boxes[0];
        const box = Float32Array.from(b);
        return Object.freeze(
          box.some((v) => v !== 0) ? { positions, box } : { positions },
        );
      },
    }),
  });
}
