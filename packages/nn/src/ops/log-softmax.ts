// Numerically stable log-softmax over the last axis (ProteinMPNN's 21-letter
// output distribution).
import { lastAxis, type Tensor } from "../tensor.ts";
import { ENTRY_WGSL, PRELUDE_WGSL } from "./common.ts";

/** CPU reference: x - max - log(sum(exp(x - max))) per row. */
export function logSoftmax(x: Tensor): Tensor {
  const [m, c] = lastAxis(x.shape, "logSoftmax");
  const out = new Float32Array(m * c);
  for (let row = 0; row < m; row++) {
    const values = x.data.subarray(row * c, row * c + c);
    let max = -Infinity;
    for (const v of values) max = Math.max(max, v);
    let sum = 0;
    for (const v of values) sum += Math.exp(v - max);
    const offset = max + Math.log(sum);
    values.forEach((v, j) => out[row * c + j] = v - offset);
  }
  return { shape: [...x.shape], data: out };
}

/** params: a = rows, b = row width. */
export const LOG_SOFTMAX_WGSL = /* wgsl */ `${PRELUDE_WGSL}
@group(0) @binding(1) var<storage, read> x: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
${ENTRY_WGSL} {
  let row = thread_index(g, n);
  if (row >= params.a) { return; }
  let base = row * params.b;
  var top = x[base];
  for (var j = 1u; j < params.b; j++) { top = max(top, x[base + j]); }
  var sum = 0.0;
  for (var j = 0u; j < params.b; j++) { sum += exp(x[base + j] - top); }
  let offset = top + log(sum);
  for (var j = 0u; j < params.b; j++) { y[base + j] = x[base + j] - offset; }
}
`;
