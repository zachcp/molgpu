// CHARMM/NAMD/X-PLOR DCD trajectories, streamed one frame at a time. The
// format is fixed-stride Fortran records, so the frame index is arithmetic and
// frames are decoded here; Mol*'s `_parseDcd` is the test oracle (it parses
// whole files only, treats every file as CHARMM, and misreads the cell).
import type { TrajectoryData, TrajectoryFrame } from "@molgpu/table";
import {
  BlockReader,
  byteSource,
  parsedTrajectory,
  readExactly,
  TrajectoryParseError,
} from "./byte-source.ts";
import type { ByteSource, TrajectoryReadOptions } from "./types.ts";

/** One AKMA time unit (CHARMM's DELTA) in picoseconds. */
export const AKMA_PS = 0.0488882129;

const invalid = (message: string): never => {
  throw new TrajectoryParseError(`DCD: ${message}`, "INVALID_TRAJECTORY");
};

/**
 * Column-major 3×3 box vectors (Å) from cell lengths and angles in degrees,
 * with `a` along x and `b` in the xy plane.
 */
export function boxFromCell(
  a: number,
  b: number,
  c: number,
  alpha: number,
  beta: number,
  gamma: number,
): Float32Array {
  const rad = Math.PI / 180;
  const [ca, cb, cg] = [alpha, beta, gamma].map((x) => Math.cos(x * rad));
  const sg = Math.sin(gamma * rad);
  const cy = (ca - cb * cg) / sg;
  const cz = Math.sqrt(Math.max(0, 1 - cb * cb - cy * cy));
  return Float32Array.of(a, 0, 0, b * cg, b * sg, 0, c * cb, c * cy, c * cz);
}

/**
 * The DCD unit-cell record `(a, γ, b, β, α, c)` as box vectors. Angles are
 * degrees, or cosines when all three lie in [-1, 1] (newer NAMD/CHARMM); a
 * record with negative lengths or angles over 180 holds the symmetric box
 * matrix `(xx, xy, yy, xz, yz, zz)` (Mol*'s third case). All zeros means no box.
 */
export function boxFromDcdCell(c: ArrayLike<number>): Float32Array | undefined {
  if (Array.prototype.every.call(c, (x: number) => x === 0)) return undefined;
  if ([1, 3, 4].every((i) => c[i] >= -1 && c[i] <= 1)) {
    const deg = (cos: number) => Math.acos(cos) * 180 / Math.PI;
    return boxFromCell(c[0], c[2], c[5], deg(c[4]), deg(c[3]), deg(c[1]));
  }
  if (
    [0, 1, 2, 3, 4, 5].some((i) => c[i] < 0) || c[1] > 180 || c[3] > 180 ||
    c[4] > 180
  ) {
    return Float32Array.of(
      c[0],
      c[1],
      c[3],
      c[1],
      c[2],
      c[4],
      c[3],
      c[4],
      c[5],
    );
  }
  const angle = (x: number) => Math.abs(x) < 1e-6 ? 90 : x;
  return boxFromCell(c[0], c[2], c[5], angle(c[4]), angle(c[3]), angle(c[1]));
}

interface Layout {
  little: boolean;
  atoms: number;
  cell: boolean;
  fourDims: boolean;
  first: number;
  stride: number;
  frames: number;
  time: Float64Array;
  timeUnit: "ps" | "step";
}

async function readLayout(reader: BlockReader): Promise<Layout> {
  if (reader.size < 92) {
    throw new TrajectoryParseError(
      `DCD: ${reader.size} bytes is shorter than the 92-byte header record`,
      "TRUNCATED_TRAJECTORY",
    );
  }
  const head = await reader.view(0, 92, "DCD header");
  const little = head.getInt32(0, true) === 84;
  if (!little && head.getInt32(0, false) !== 84) {
    invalid("the first record is not 84 bytes (not a DCD file)");
  }
  const int = (at: number) => head.getInt32(at, little);
  if (
    String.fromCharCode(
      ...new Uint8Array(head.buffer, head.byteOffset + 4, 4),
    ) !== "CORD"
  ) {
    invalid('the header lacks the "CORD" tag');
  }
  if (int(88) !== 84) invalid("the header record does not close with 84");
  // icntrl[i] is the 32-bit word at byte 8 + 4i.
  const icntrl = (i: number) => int(8 + 4 * i);
  const [istart, nsavc, namnf] = [icntrl(1), icntrl(2), icntrl(8)];
  const charmm = icntrl(19) !== 0;
  const delta = charmm
    ? head.getFloat32(8 + 4 * 9, little)
    : head.getFloat64(8 + 4 * 9, little);
  const cell = charmm && icntrl(10) !== 0;
  const fourDims = charmm && icntrl(11) === 1;
  if (namnf > 0) {
    throw new TrajectoryParseError(
      `DCD: ${namnf} fixed atoms are not supported`,
      "UNSUPPORTED_TRAJECTORY",
    );
  }
  let at = 92;
  const titleBytes = (await reader.view(at, 4, "DCD title")).getInt32(
    0,
    little,
  );
  if (titleBytes < 4 || (titleBytes - 4) % 80 !== 0) {
    invalid("malformed title record");
  }
  const titleEnd = await reader.view(at + 4 + titleBytes, 4, "DCD title");
  if (titleEnd.getInt32(0, little) !== titleBytes) {
    invalid("unterminated title record");
  }
  at += titleBytes + 8;
  const natom = await reader.view(at, 12, "DCD atom count");
  if (natom.getInt32(0, little) !== 4 || natom.getInt32(8, little) !== 4) {
    invalid("malformed atom-count record");
  }
  const atoms = natom.getInt32(4, little);
  if (atoms <= 0) invalid(`atom count ${atoms} must be positive`);
  at += 12;
  const stride = (cell ? 56 : 0) + 3 * (8 + 4 * atoms) +
    (fourDims ? 8 + 4 * atoms : 0);
  // The frame count comes from the file size: NSET is often stale in files
  // that were appended to or cut short. A trailing partial frame is ignored.
  const frames = Math.floor((reader.size - at) / stride);
  if (frames < 1) {
    throw new TrajectoryParseError(
      "DCD: the file holds no complete frame",
      "TRUNCATED_TRAJECTORY",
    );
  }
  const step = nsavc > 0 ? nsavc : 1;
  const unit = delta > 0 && Number.isFinite(delta) ? delta * AKMA_PS : 0;
  const time = Float64Array.from(
    { length: frames },
    (_, i) => (istart + i * step) * (unit || 1),
  );
  return {
    little,
    atoms,
    cell,
    fourDims,
    first: at,
    stride,
    frames,
    time,
    timeUnit: unit ? "ps" : "step",
  };
}

function decodeFrame(
  bytes: Uint8Array,
  layout: Layout,
  index: number,
): TrajectoryFrame {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { little, atoms } = layout;
  const n4 = atoms * 4;
  let at = 0;
  const record = (length: number, what: string) => {
    if (
      view.getInt32(at, little) !== length ||
      view.getInt32(at + 4 + length, little) !== length
    ) invalid(`frame ${index}: malformed ${what} record`);
    at += 4;
  };
  let box: Float32Array | undefined;
  if (layout.cell) {
    record(48, "unit-cell");
    const c = Array.from(
      { length: 6 },
      (_, i) => view.getFloat64(at + i * 8, little),
    );
    box = boxFromDcdCell(c);
    at += 52;
  }
  const positions = new Float32Array(atoms * 3);
  for (let axis = 0; axis < 3; axis++) {
    record(n4, "coordinate");
    for (let i = 0; i < atoms; i++) {
      positions[i * 3 + axis] = view.getFloat32(at + i * 4, little);
    }
    at += n4 + 4;
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      invalid(`frame ${index}: coordinate ${i} is not finite`);
    }
  }
  return Object.freeze(box ? { positions, box } : { positions });
}

/**
 * Open a DCD trajectory for streaming. Only the header is read; each
 * `source.read(i)` fetches and decodes one frame. Times are picoseconds from
 * `(ISTART + i·NSAVC)·DELTA` AKMA units, or integrator steps when DELTA is 0.
 * Fails with `TrajectoryParseError`.
 */
export async function trajectoryFromDcd(
  input: Uint8Array | Blob | ByteSource,
  options: TrajectoryReadOptions = {},
): Promise<TrajectoryData> {
  const bytes = byteSource(input);
  const layout = await readLayout(
    new BlockReader(bytes, 64 * 1024, options.signal),
  );
  return parsedTrajectory("DCD", {
    atomCount: layout.atoms,
    frameCount: layout.frames,
    time: layout.time,
    timeUnit: layout.timeUnit,
    source: Object.freeze({
      async read(index: number, signal?: AbortSignal) {
        if (!Number.isInteger(index) || index < 0 || index >= layout.frames) {
          throw new RangeError(
            `frame ${index} out of range [0, ${layout.frames})`,
          );
        }
        const frame = await readExactly(
          bytes,
          layout.first + index * layout.stride,
          layout.stride,
          signal,
          `DCD frame ${index}`,
        );
        return decodeFrame(frame, layout, index);
      },
    }),
  });
}
