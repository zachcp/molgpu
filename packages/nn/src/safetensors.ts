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

/** Parse a safetensors file into named f32 tensors (F32, F16 and BF16 inputs). */
export function parseSafetensors(bytes: Uint8Array): Map<string, Tensor> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8) throw new Error("safetensors: file too short");
  const headerLength = Number(view.getBigUint64(0, true));
  const dataStart = 8 + headerLength;
  if (dataStart > bytes.byteLength) {
    throw new Error("safetensors: header runs past the end of the file");
  }
  const header = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, dataStart)),
  ) as Record<
    string,
    { dtype: string; shape: number[]; data_offsets: [number, number] }
  >;
  const out = new Map<string, Tensor>();
  for (const [name, entry] of Object.entries(header)) {
    if (name === "__metadata__") continue;
    const size = BYTES[entry.dtype];
    if (!size) {
      throw new Error(
        `safetensors: ${name} has unsupported dtype ${entry.dtype}`,
      );
    }
    const count = elementCount(entry.shape);
    const [begin, end] = entry.data_offsets;
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
