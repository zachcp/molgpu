// Row-wise blend y = mask * a + (1 - mask) * b, with one mask value per row.
// ProteinMPNN's decoder uses it to choose, per neighbour, between features that
// include the neighbour's amino acid (already decoded) and encoder-only ones.
import { expectShape, lastAxis, type Tensor } from "../tensor.ts";
import { ENTRY_WGSL, PRELUDE_WGSL } from "./common.ts";

/** Validate a [..., C], b of the same shape, and mask [...]; returns [rows, C]. */
export function mixShape(
  a: readonly number[],
  b: readonly number[],
  mask: readonly number[],
): [number, number] {
  expectShape(b, a, "mix b");
  expectShape(mask, a.slice(0, -1), "mix mask");
  return lastAxis(a, "mix");
}

/** CPU reference of mask * a + (1 - mask) * b per row. */
export function mix(a: Tensor, b: Tensor, mask: Tensor): Tensor {
  const [rows, c] = mixShape(a.shape, b.shape, mask.shape);
  const out = new Float32Array(rows * c);
  for (let i = 0; i < rows * c; i++) {
    const m = mask.data[Math.floor(i / c)];
    out[i] = m * a.data[i] + (1 - m) * b.data[i];
  }
  return { shape: [...a.shape], data: out };
}

/** params: a = rows, b = row width. */
export const MIX_WGSL = /* wgsl */ `${PRELUDE_WGSL}
@group(0) @binding(1) var<storage, read> x0: array<f32>;
@group(0) @binding(2) var<storage, read> x1: array<f32>;
@group(0) @binding(3) var<storage, read> mask: array<f32>;
@group(0) @binding(4) var<storage, read_write> y: array<f32>;
${ENTRY_WGSL} {
  let i = thread_index(g, n);
  if (i >= params.a * params.b) { return; }
  let m = mask[i / params.b];
  y[i] = m * x0[i] + (1.0 - m) * x1[i];
}
`;
