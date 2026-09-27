// CCP4/MRC density maps to @molgpu/table VolumeData, through Mol*'s reader.
// Mol* stays behind a dynamic import, as for BCIF.
import {
  createVolume,
  MAX_VOLUME_SAMPLES,
  type VolumeData,
} from "@molgpu/table";
import { errorFor } from "./error.ts";
import { type FileInput, readInput } from "./input.ts";
import { gridToXFast } from "./grid.ts";

const volumeError = errorFor("ccp4");

const HEADER_BYTES = 1024;
/** Bytes per sample for the modes Mol* reads. */
const MODE_BYTES: Record<number, number> = { 0: 1, 1: 2, 2: 4 };

interface Preflight {
  readonly little: boolean;
  readonly offset: number;
  readonly elementBytes: number;
  readonly dataBytes: number;
}

/**
 * A little-endian copy of a big-endian map. Mol* 5.11's big-endian float path
 * loses precision, so the reader always hands it little-endian bytes. Header
 * words 52-53 (MAP, MACHST) and 56+ (labels) are text; symmetry records too.
 */
function toLittleEndian(bytes: Uint8Array, p: Preflight): Uint8Array {
  const out = bytes.slice(0, p.offset + p.dataBytes);
  const swap = (at: number, size: number) => {
    for (let n = 0; n < size / 2; n++) {
      const t = out[at + n];
      out[at + n] = out[at + size - 1 - n];
      out[at + size - 1 - n] = t;
    }
  };
  for (let word = 0; word < 56; word++) {
    if (word !== 52 && word !== 53) swap(word * 4, 4);
  }
  out.set([0x44, 0x41, 0, 0], 212);
  if (p.elementBytes > 1) {
    for (let at = p.offset; at < p.offset + p.dataBytes; at += p.elementBytes) {
      swap(at, p.elementBytes);
    }
  }
  return out;
}

/** Read just enough of the header to reject bad or oversize input cheaply. */
function preflight(bytes: Uint8Array, maxSamples: number): Preflight {
  if (bytes.length < HEADER_BYTES) {
    throw volumeError(
      `CCP4/MRC input is ${bytes.length} bytes, shorter than the 1024-byte header`,
      "INVALID_MAP",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const map = String.fromCharCode(...bytes.subarray(208, 211));
  if (map !== "MAP") {
    throw volumeError(
      'CCP4/MRC header lacks the "MAP " marker',
      "INVALID_MAP",
    );
  }
  // Same endianness rule as Mol*: MACHST 0x44 0x41 is little-endian, 0x11
  // 0x11 big-endian, otherwise guess from a plausible mode.
  let little = view.getInt32(12, true) <= 16;
  if (bytes[212] === 0x44 && bytes[213] === 0x41) little = true;
  else if (bytes[212] === 0x11 && bytes[213] === 0x11) little = false;
  const int = (word: number) => view.getInt32(word * 4, little);
  const [nc, nr, ns, mode] = [int(0), int(1), int(2), int(3)];
  if (![nc, nr, ns].every((n) => n > 0)) {
    throw volumeError(
      `CCP4/MRC dimensions ${nc}×${nr}×${ns} must be positive`,
      "INVALID_MAP",
    );
  }
  const axes = [int(16), int(17), int(18)].sort().join();
  if (axes !== "1,2,3") {
    throw volumeError(
      "CCP4/MRC MAPC/MAPR/MAPS must be a permutation of 1, 2, 3",
      "INVALID_MAP",
    );
  }
  const userFlags = int(39) === -128 && int(40) === 127;
  const elementBytes = MODE_BYTES[mode];
  if (elementBytes === undefined) {
    throw volumeError(
      `CCP4/MRC mode ${mode} is not supported (0, 1 and 2 are)`,
      "UNSUPPORTED_MODE",
    );
  }
  const samples = nc * nr * ns;
  if (!(samples <= maxSamples)) {
    throw volumeError(
      `CCP4/MRC map has ${samples} samples, over maxSamples ${maxSamples}; ` +
        "pass a larger maxSamples to accept it (no implicit downsampling)",
      "VOLUME_TOO_LARGE",
    );
  }
  const size = userFlags ? 1 : elementBytes;
  const dataBytes = samples * size;
  const offset = HEADER_BYTES + Math.max(0, int(23));
  if (bytes.length < offset + dataBytes) {
    throw volumeError(
      `CCP4/MRC data is truncated: need ${
        offset + dataBytes
      } bytes, have ${bytes.length}`,
      "INVALID_MAP",
    );
  }
  return { little, offset, elementBytes: size, dataBytes };
}

/**
 * Read a CCP4/MRC map (modes 0, 1 and 2) into a scalar `VolumeData` from its
 * bytes, a `Blob`/`File`, or a URL fetched once. The
 * transform is Mol*'s grid-to-Cartesian affine: cell angles (non-orthogonal
 * cells included), `MAPC/MAPR/MAPS` axis order, `N[CRS]START`, and the MRC
 * `ORIGIN` record when it is nonzero. Values are lowered to x-fastest order
 * along the cell axes. Statistics are computed from the values; header
 * statistics are ignored. Maps over `maxSamples` (default 256³) fail with
 * `VOLUME_TOO_LARGE` before their values are read.
 */
export async function volumeFromCcp4(
  source: FileInput,
  options: { maxSamples?: number } = {},
): Promise<VolumeData> {
  const bytes = await readInput(source, "CCP4/MRC", volumeError);
  const { maxSamples = MAX_VOLUME_SAMPLES } = options;
  const header = preflight(bytes, maxSamples);
  const input = header.little ? bytes : toLittleEndian(bytes, header);
  let modules;
  try {
    modules = await Promise.all([
      import("molstar/lib/mol-io/reader/ccp4/parser.js"),
      import("molstar/lib/mol-model-formats/volume/ccp4.js"),
      import("molstar/lib/mol-model/volume/grid.js"),
    ]);
  } catch (error) {
    throw volumeError(
      "Unable to load the optional Mol* CCP4 reader",
      "PARSER_UNAVAILABLE",
      error,
    );
  }
  const [{ parse }, { volumeFromCcp4: toVolume }, { Grid }] = modules;
  let grid;
  try {
    const parsed = await parse(input, "map").run();
    if (parsed.isError) throw new Error(parsed.message);
    // Mol*'s parser fills values without awaiting the slice read; one more
    // turn lets that promise settle before the values are used.
    await Promise.resolve();
    grid = (await toVolume(parsed.result).run()).grid;
  } catch (error) {
    throw volumeError(
      "Mol* rejected the CCP4/MRC map",
      "INVALID_MAP",
      error,
    );
  }
  const { space, data } = grid.cells;
  const { dims, values } = gridToXFast(space, data);
  try {
    return createVolume({
      values,
      dims,
      transform: Float32Array.from(Grid.getGridToCartesianTransform(grid)),
    }, { maxSamples });
  } catch (error) {
    throw volumeError(
      "The CCP4/MRC map is not a valid volume",
      "INVALID_MAP",
      error,
    );
  }
}
