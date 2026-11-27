// Message aggregation: out[l, c] = sum_k x[l, k, c] * mask[l, k] / scale.
// ProteinMPNN sums masked neighbour messages and divides by a constant scale
// (30) rather than the neighbour count.
import { expectShape, type Tensor } from "../tensor.ts";
import { ENTRY_WGSL, PRELUDE_WGSL } from "./common.ts";

/** Output shape of `neighborSum`, validating x [L, K, C] and mask [L, K]. */
export function neighborSumShape(
  x: readonly number[],
  mask?: readonly number[],
): number[] {
  if (x.length !== 3) {
    throw new Error(`neighborSum: expected x [L, K, C], got [${x}]`);
  }
  if (mask) expectShape(mask, [x[0], x[1]], "neighborSum mask");
  return [x[0], x[2]];
}

/** CPU reference with double accumulation. */
export function neighborSum(
  x: Tensor,
  options: { mask?: Tensor; scale?: number } = {},
): Tensor {
  const { mask, scale = 1 } = options;
  const shape = neighborSumShape(x.shape, mask?.shape);
  const [l, k, c] = x.shape;
  const out = new Float32Array(l * c);
  for (let i = 0; i < l; i++) {
    for (let ch = 0; ch < c; ch++) {
      let acc = 0;
      for (let j = 0; j < k; j++) {
        const weight = mask ? mask.data[i * k + j] : 1;
        acc += x.data[(i * k + j) * c + ch] * weight;
      }
      out[i * c + ch] = acc / scale;
    }
  }
  return { shape, data: out };
}

/** params: a = L, b = K, c = C, d = bit 0 mask, e = scale (f32 bits). */
export const NEIGHBOR_SUM_WGSL = /* wgsl */ `${PRELUDE_WGSL}
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read> mask: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
${ENTRY_WGSL} {
  let i = thread_index(g, n);
  if (i >= params.a * params.c) { return; }
  let l = i / params.c;
  let ch = i % params.c;
  var acc = 0.0;
  for (var j = 0u; j < params.b; j++) {
    var weight = 1.0;
    if ((params.d & 1u) != 0u) { weight = mask[l * params.b + j]; }
    acc += x[(l * params.b + j) * params.c + ch] * weight;
  }
  y[i] = acc / bitcast<f32>(params.e);
}
`;
