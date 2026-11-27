// Concatenation along the last axis with prefix broadcasting: a [L, C0] joins
// b [L, K, C1] as [L, K, C0 + C1], repeating each row of a over K. This is
// ProteinMPNN's cat([h_V_i expanded over neighbours, h_E_ij]).
import { lastAxis, type Tensor } from "../tensor.ts";
import { ENTRY_WGSL, PRELUDE_WGSL } from "./common.ts";

/** How two shapes concatenate: output shape, rows, and each side's row repeat. */
export interface ConcatPlan {
  readonly shape: number[];
  readonly rows: number;
  readonly repeat: readonly [number, number];
}

const isPrefix = (p: readonly number[], of: readonly number[]) =>
  p.length <= of.length && p.every((d, i) => d === of[i]);

/** Plan `concat(a, b)`; one side's leading dims must prefix the other's. */
export function concatPlan(
  a: readonly number[],
  b: readonly number[],
): ConcatPlan {
  const [rowsA, ca] = lastAxis(a, "concat");
  const [rowsB, cb] = lastAxis(b, "concat");
  const la = a.slice(0, -1), lb = b.slice(0, -1);
  if (isPrefix(la, lb)) {
    return {
      shape: [...lb, ca + cb],
      rows: rowsB,
      repeat: [rowsA ? rowsB / rowsA : 1, 1],
    };
  }
  if (isPrefix(lb, la)) {
    return {
      shape: [...la, ca + cb],
      rows: rowsA,
      repeat: [1, rowsB ? rowsA / rowsB : 1],
    };
  }
  throw new Error(`concat: cannot broadcast [${a}] with [${b}]`);
}

/** CPU reference of last-axis concatenation with prefix broadcasting. */
export function concat(a: Tensor, b: Tensor): Tensor {
  const { shape, rows, repeat } = concatPlan(a.shape, b.shape);
  const ca = a.shape[a.shape.length - 1], cb = b.shape[b.shape.length - 1];
  const out = new Float32Array(rows * (ca + cb));
  for (let row = 0; row < rows; row++) {
    const ra = Math.floor(row / repeat[0]), rb = Math.floor(row / repeat[1]);
    out.set(a.data.subarray(ra * ca, ra * ca + ca), row * (ca + cb));
    out.set(b.data.subarray(rb * cb, rb * cb + cb), row * (ca + cb) + ca);
  }
  return { shape, data: out };
}

/** params: a = rows, b = width of a, c = width of b, d = repeat of a, e = repeat of b. */
export const CONCAT_WGSL = /* wgsl */ `${PRELUDE_WGSL}
@group(0) @binding(1) var<storage, read> x0: array<f32>;
@group(0) @binding(2) var<storage, read> x1: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
${ENTRY_WGSL} {
  let i = thread_index(g, n);
  let width = params.b + params.c;
  if (i >= params.a * width) { return; }
  let row = i / width;
  let col = i % width;
  if (col < params.b) {
    y[i] = x0[(row / params.d) * params.b + col];
  } else {
    y[i] = x1[(row / params.e) * params.c + col - params.b];
  }
}
`;
