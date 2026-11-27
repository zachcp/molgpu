// Exact (erf) GELU, PyTorch's default `nn.GELU()`. The CPU reference computes
// erf in double precision; the WGSL uses Abramowitz & Stegun 7.1.26 (absolute
// error <= 1.5e-7), which is below f32 resolution for GELU's output range.
import type { Tensor } from "../tensor.ts";

const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

/** The error function in double precision (absolute error below 1e-13). */
export function erf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const a = Math.abs(x);
  let r: number;
  if (a < 2.5) {
    // Maclaurin series: 2/sqrt(pi) * sum (-1)^n a^(2n+1) / (n! (2n+1)).
    const a2 = a * a;
    let term = a, sum = a;
    for (let n = 1; n < 200; n++) {
      term *= -a2 / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    r = TWO_OVER_SQRT_PI * sum;
  } else {
    // erfc continued fraction: exp(-a^2)/sqrt(pi) / (a + (1/2)/(a + 1/(a + ...))).
    let f = a;
    for (let k = 200; k >= 1; k--) f = a + (k / 2) / f;
    r = 1 - Math.exp(-a * a) / Math.sqrt(Math.PI) / f;
  }
  return x < 0 ? -r : r;
}

/** Exact GELU of one value: x/2 * (1 + erf(x / sqrt(2))). */
export function geluScalar(x: number): number {
  return 0.5 * x * (1 + erf(x / Math.SQRT2));
}

/** Elementwise exact GELU. */
export function gelu(x: Tensor): Tensor {
  return { shape: [...x.shape], data: x.data.map(geluScalar) };
}

/** WGSL `erf_f32` and `gelu_f32`, shared by kernels that fuse the activation. */
export const GELU_WGSL = /* wgsl */ `
fn erf_f32(x: f32) -> f32 {
  let a = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * a);
  let poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t;
  return sign(x) * (1.0 - poly * exp(-a * a));
}
fn gelu_f32(x: f32) -> f32 {
  return 0.5 * x * (1.0 + erf_f32(x * 0.70710678118654752));
}
`;
