// safetensors reader (https://huggingface.co/docs/safetensors): an 8-byte
// little-endian header length, a JSON header naming each tensor's dtype, shape
// and byte range, then the raw little-endian data. Checkpoints convert from
// PyTorch with `safetensors.torch.save_file`. Float tensors widen to f32.
import { elementCount, type Tensor } from "./tensor.ts";

const BYTES: Readonly<Record<string, number>> = { F32: 4, F16: 2, BF16: 2 };

/** Decode one IEEE 754 half-precision value. */
function halfToFloat(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/** One tensor as a safetensors header describes it, without its data. */
export interface SafetensorsEntry {
  /** As stored, such as `"F16"`, `"BF16"`, `"F32"` or `"I64"`. */
  readonly dtype: string;
  readonly shape: readonly number[];
  /** Byte range within the data section. */
  readonly offsets: readonly [number, number];
}

/**
 * Byte length of the JSON header, from a file's first 8 bytes. The whole
 * header is `bytes[8, 8 + length)`, so a model's layout can be read with two
 * range requests and none of its weights.
 */
export function safetensorsHeaderLength(prefix: Uint8Array): number {
  if (prefix.byteLength < 8) throw new Error("safetensors: file too short");
  const view = new DataView(prefix.buffer, prefix.byteOffset, 8);
  const length = Number(view.getBigUint64(0, true));
  // The format caps headers at 100 MB; anything larger is not safetensors.
  if (length > 100_000_000) throw new Error("safetensors: header too large");
  return length;
}

/**
 * Tensor names, dtypes and shapes from a safetensors header, in header order.
 * `bytes` holds at least the first 8 + header-length bytes of the file; the
 * data section need not be present.
 */
export function readSafetensorsHeader(
  bytes: Uint8Array,
): Map<string, SafetensorsEntry> {
  const length = safetensorsHeaderLength(bytes);
  if (8 + length > bytes.byteLength) {
    throw new Error("safetensors: header runs past the end of the bytes");
  }
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + length)),
  ) as Record<
    string,
    { dtype: string; shape: number[]; data_offsets: [number, number] }
  >;
  const out = new Map<string, SafetensorsEntry>();
  for (const [name, entry] of Object.entries(header)) {
    if (name === "__metadata__") continue;
    out.set(name, {
      dtype: entry.dtype,
      shape: [...entry.shape],
      offsets: [entry.data_offsets[0], entry.data_offsets[1]],
    });
  }
  return out;
}

/** Parse a safetensors file into named f32 tensors (F32, F16 and BF16 inputs). */
export function parseSafetensors(bytes: Uint8Array): Map<string, Tensor> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = readSafetensorsHeader(bytes);
  const dataStart = 8 + safetensorsHeaderLength(bytes);
  const out = new Map<string, Tensor>();
  for (const [name, entry] of header) {
    const size = BYTES[entry.dtype];
    if (!size) {
      throw new Error(
        `safetensors: ${name} has unsupported dtype ${entry.dtype}`,
      );
    }
    const count = elementCount(entry.shape);
    const [begin, end] = entry.offsets;
    if (end - begin !== count * size || dataStart + end > bytes.byteLength) {
      throw new Error(
        `safetensors: ${name} byte range does not match its shape`,
      );
    }
    const data = new Float32Array(count);
    const at = dataStart + begin;
    for (let i = 0; i < count; i++) {
      const offset = at + i * size;
      data[i] = entry.dtype === "F32"
        ? view.getFloat32(offset, true)
        : entry.dtype === "F16"
        ? halfToFloat(view.getUint16(offset, true))
        : new Float32Array(
          new Uint32Array([view.getUint16(offset, true) << 16]).buffer,
        )[0];
    }
    out.set(name, { shape: [...entry.shape], data });
  }
  return out;
}
