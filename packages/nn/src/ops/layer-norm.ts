// LayerNorm over the last axis with biased variance (PyTorch nn.LayerNorm),
// optionally of x + residual, the post-norm residual step of an MPNN layer.
import { expectShape, lastAxis, type Tensor } from "../tensor.ts";
import { ENTRY_WGSL, PRELUDE_WGSL } from "./common.ts";

/** PyTorch's nn.LayerNorm default epsilon. */
export const LAYER_NORM_EPS = 1e-5;

/** Validate LayerNorm operands; returns [rows, features]. */
export function layerNormShape(
  x: readonly number[],
  gamma: readonly number[],
  beta: readonly number[],
  residual?: readonly number[],
): [number, number] {
  const [m, c] = lastAxis(x, "layerNorm");
  expectShape(gamma, [c], "layerNorm gamma");
  expectShape(beta, [c], "layerNorm beta");
  if (residual) expectShape(residual, x, "layerNorm residual");
  return [m, c];
}

/** CPU reference of gamma * (v - mean) / sqrt(var + eps) + beta, v = x (+ residual). */
export function layerNorm(
  x: Tensor,
  gamma: Tensor,
  beta: Tensor,
  options: { residual?: Tensor; eps?: number } = {},
): Tensor {
  const { residual, eps = LAYER_NORM_EPS } = options;
  const [m, c] = layerNormShape(
    x.shape,
    gamma.shape,
    beta.shape,
    residual?.shape,
  );
  const out = new Float32Array(m * c);
  const v = new Float64Array(c);
  for (let row = 0; row < m; row++) {
    let mean = 0;
    for (let j = 0; j < c; j++) {
      const i = row * c + j;
      v[j] = x.data[i] + (residual ? residual.data[i] : 0);
      mean += v[j];
    }
    mean /= c;
    let variance = 0;
    for (let j = 0; j < c; j++) variance += (v[j] - mean) ** 2;
    const inv = 1 / Math.sqrt(variance / c + eps);
    for (let j = 0; j < c; j++) {
      out[row * c + j] = (v[j] - mean) * inv * gamma.data[j] + beta.data[j];
    }
  }
  return { shape: [...x.shape], data: out };
}

/** params: a = rows, b = features, c = bit 0 residual, d = eps (f32 bits). */
export const LAYER_NORM_WGSL = /* wgsl */ `${PRELUDE_WGSL}
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read> residual: array<f32>;
@group(0) @binding(3) var<storage, read> gamma: array<f32>;
@group(0) @binding(4) var<storage, read> beta: array<f32>;
@group(0) @binding(5) var<storage, read_write> y: array<f32>;
fn value(i: u32) -> f32 {
  if ((params.c & 1u) != 0u) { return x[i] + residual[i]; }
  return x[i];
}
${ENTRY_WGSL} {
  let row = thread_index(g, n);
  if (row >= params.a) { return; }
  let c = params.b;
  let base = row * c;
  var mean = 0.0;
  for (var j = 0u; j < c; j++) { mean += value(base + j); }
  mean /= f32(c);
  var variance = 0.0;
  for (var j = 0u; j < c; j++) {
    let d = value(base + j) - mean;
    variance += d * d;
  }
  let inv = inverseSqrt(variance / f32(c) + bitcast<f32>(params.d));
  for (var j = 0u; j < c; j++) {
    y[base + j] = (value(base + j) - mean) * inv * gamma[j] + beta[j];
  }
}
`;
