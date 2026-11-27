// y = x Wᵀ + b, with an optional fused GELU. W uses PyTorch's nn.Linear layout,
// [out, in], so checkpoint tensors upload unchanged.
import { expectShape, lastAxis, type Tensor } from "../tensor.ts";
import { ENTRY_WGSL, PRELUDE_WGSL } from "./common.ts";
import { GELU_WGSL, geluScalar } from "./gelu.ts";

/** Activation fused after a linear layer. */
export type Activation = "none" | "gelu";

/** Output shape of `linear`, validating x [..., K], w [N, K] and b [N]. */
export function linearShape(
  x: readonly number[],
  w: readonly number[],
  b?: readonly number[],
): number[] {
  const [, k] = lastAxis(x, "linear");
  if (w.length !== 2 || w[1] !== k) {
    throw new Error(`linear: weight [${w}] does not match input [${x}]`);
  }
  if (b) expectShape(b, [w[0]], "linear bias");
  return [...x.slice(0, -1), w[0]];
}

/** CPU reference: double accumulation, rounded to f32 on store. */
export function linear(
  x: Tensor,
  w: Tensor,
  b?: Tensor,
  activation: Activation = "none",
): Tensor {
  const shape = linearShape(x.shape, w.shape, b?.shape);
  const [m, k] = lastAxis(x.shape, "linear");
  const n = w.shape[0];
  const out = new Float32Array(m * n);
  for (let row = 0; row < m; row++) {
    for (let col = 0; col < n; col++) {
      let acc = b ? b.data[col] : 0;
      for (let j = 0; j < k; j++) {
        acc += x.data[row * k + j] * w.data[col * k + j];
      }
      out[row * n + col] = activation === "gelu" ? geluScalar(acc) : acc;
    }
  }
  return { shape, data: out };
}

/** params: a = rows, b = out features, c = in features, d = bit 0 bias, bit 1 GELU. */
export const LINEAR_WGSL = /* wgsl */ `${PRELUDE_WGSL}${GELU_WGSL}
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read> w: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
@group(0) @binding(4) var<storage, read_write> y: array<f32>;
${ENTRY_WGSL} {
  let i = thread_index(g, n);
  if (i >= params.a * params.b) { return; }
  let row = i / params.b;
  let col = i % params.b;
  var acc = 0.0;
  if ((params.d & 1u) != 0u) { acc = bias[col]; }
  for (var j = 0u; j < params.c; j++) {
    acc += x[row * params.c + j] * w[col * params.c + j];
  }
  if ((params.d & 2u) != 0u) { acc = gelu_f32(acc); }
  y[i] = acc;
}
`;
