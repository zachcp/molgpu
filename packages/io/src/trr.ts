// GROMACS TRR trajectories, streamed one frame at a time. Frames are plain
// XDR (big-endian) reals, decoded here so velocities survive (Mol*'s reader
// drops them); Mol*'s `parseTrr` is the positions oracle in tests.
import type { TrajectoryData, TrajectoryFrame } from "@molgpu/table";
import {
  BlockReader,
  byteSource,
  parsedTrajectory,
  readExactly,
  TrajectoryParseError,
} from "./byte-source.ts";
import type { ByteSource, TrajectoryReadOptions } from "./types.ts";

const MAGIC = 1993;

const invalid = (message: string): never => {
  throw new TrajectoryParseError(`TRR: ${message}`, "INVALID_TRAJECTORY");
};

interface FrameHeader {
  /** Bytes from the frame start to the box block. */
  head: number;
  real: 4 | 8;
  box: number;
  vir: number;
  pres: number;
  x: number;
  v: number;
  f: number;
  atoms: number;
  time: number;
  length: number;
}

async function readHeader(
  reader: BlockReader,
  at: number,
  frame: number,
): Promise<FrameHeader | null> {
  if (reader.size - at < 12) return null;
  const start = await reader.view(at, 12, "TRR header");
  if (start.getInt32(0) !== MAGIC) {
    invalid(
      `frame ${frame} at byte ${at}: bad magic number ${start.getInt32(0)}`,
    );
  }
  const version = start.getInt32(8);
  if (version < 0 || version > 1024) {
    invalid(`frame ${frame}: bad version string`);
  }
  const versionBytes = Math.ceil(version / 4) * 4;
  const sizesAt = at + 12 + versionBytes;
  if (reader.size - sizesAt < 52) return null;
  const s = await reader.view(sizesAt, 52, "TRR header");
  const size = (i: number) => s.getInt32(i * 4);
  const [ir, e, box, vir, pres, top, sym, x, v, f, atoms] = Array.from(
    { length: 11 },
    (_, i) => size(i),
  );
  if ([ir, e, box, vir, pres, top, sym, x, v, f].some((n) => n < 0)) {
    invalid(`frame ${frame}: negative block size`);
  }
  if (ir || e || top || sym) {
    throw new TrajectoryParseError(
      `TRR: frame ${frame} carries input-record/energy/topology blocks`,
      "UNSUPPORTED_TRAJECTORY",
    );
  }
  if (atoms <= 0) invalid(`frame ${frame}: atom count ${atoms}`);
  const n3 = atoms * 3;
  const real: number = box ? box / 9 : x ? x / n3 : v ? v / n3 : f ? f / n3 : 4;
  if (real !== 4 && real !== 8) {
    invalid(`frame ${frame}: cannot tell float size`);
  }
  for (
    const [name, bytes, n] of [["x", x, n3], ["v", v, n3], ["f", f, n3], [
      "box",
      box,
      9,
    ]] as const
  ) {
    if (bytes && bytes !== n * real) {
      invalid(`frame ${frame}: ${name} block is ${bytes} bytes`);
    }
  }
  const head = 12 + versionBytes + 52 + 2 * real;
  if (reader.size - at < head) return null;
  const t = await reader.view(sizesAt + 52, real, "TRR header");
  return {
    head,
    real: real as 4 | 8,
    box,
    vir,
    pres,
    x,
    v,
    f,
    atoms,
    time: real === 8 ? t.getFloat64(0) : t.getFloat32(0),
    length: head + box + vir + pres + x + v + f,
  };
}

function decode(
  bytes: Uint8Array,
  h: FrameHeader,
  velocities: boolean,
  index: number,
): TrajectoryFrame {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const get = h.real === 8
    ? (at: number) => view.getFloat64(at)
    : (at: number) => view.getFloat32(at);
  const block = (at: number, n: number, what: string) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const value = get(at + i * h.real) * 10; // nm -> Å, nm/ps -> Å/ps
      if (!Number.isFinite(value)) {
        invalid(`frame ${index}: ${what} ${i} is not finite`);
      }
      out[i] = value;
    }
    return out;
  };
  let at = h.head;
  const box = h.box ? block(at, 9, "box value") : undefined;
  at += h.box + h.vir + h.pres;
  const positions = block(at, h.atoms * 3, "coordinate");
  at += h.x;
  const v = velocities && h.v ? block(at, h.atoms * 3, "velocity") : undefined;
  const frame: TrajectoryFrame = {
    positions,
    ...(box && box.some((x) => x !== 0) ? { box } : {}),
    ...(v ? { velocities: v } : {}),
  };
  return Object.freeze(frame);
}

/**
 * Open a GROMACS TRR trajectory for streaming. Opening walks frame headers in
 * 4 MiB blocks; frames without positions (velocity- or force-only) are
 * skipped. Positions and boxes are Å, times picoseconds; with
 * `velocities: true`, frames that store velocities carry them in Å/ps. A
 * trailing partial frame is ignored. Fails with `TrajectoryParseError`.
 */
export async function trajectoryFromTrr(
  input: Uint8Array | Blob | ByteSource,
  options: TrajectoryReadOptions = {},
): Promise<TrajectoryData> {
  const bytes = byteSource(input);
  const reader = new BlockReader(bytes, 4 * 1024 * 1024, options.signal);
  const frames: { offset: number; header: FrameHeader }[] = [];
  let atoms = 0;
  for (let at = 0, n = 0; at < bytes.size; n++) {
    const header = await readHeader(reader, at, n);
    if (!header || at + header.length > bytes.size) break;
    if (header.x) {
      if (!atoms) atoms = header.atoms;
      else if (header.atoms !== atoms) {
        invalid(`frame ${n} has ${header.atoms} atoms, the first has ${atoms}`);
      }
      frames.push({ offset: at, header });
    }
    at += header.length;
  }
  if (!frames.length) {
    throw new TrajectoryParseError(
      "TRR: the file holds no complete frame with positions",
      "TRUNCATED_TRAJECTORY",
    );
  }
  const velocities = options.velocities ?? false;
  return parsedTrajectory("TRR", {
    atomCount: atoms,
    frameCount: frames.length,
    time: frames.map((f) => f.header.time),
    timeUnit: "ps",
    source: Object.freeze({
      async read(i: number, signal?: AbortSignal) {
        if (!Number.isInteger(i) || i < 0 || i >= frames.length) {
          throw new RangeError(`frame ${i} out of range [0, ${frames.length})`);
        }
        const { offset, header } = frames[i];
        const frame = await readExactly(
          bytes,
          offset,
          header.length,
          signal,
          `TRR frame ${i}`,
        );
        return decode(frame, header, velocities, i);
      },
    }),
  });
}
