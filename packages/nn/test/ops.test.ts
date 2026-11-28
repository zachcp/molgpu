import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  erf,
  gatherRows,
  gelu,
  indexTensor,
  layerNorm,
  linear,
  logSoftmax,
  neighborSum,
  parseSafetensors,
  tensor,
  tileMeanAbs,
} from "../src/index.ts";

const close = (actual: ArrayLike<number>, expected: number[], tol = 1e-6) => {
  assertEquals(actual.length, expected.length);
  expected.forEach((e, i) => assertAlmostEquals(actual[i], e, tol, `at ${i}`));
};

Deno.test("erf matches tabulated values on both branches and signs", () => {
  // Abramowitz & Stegun table 7.1 / high-precision references.
  for (
    const [x, e] of [
      [0.5, 0.5204998778130465],
      [1, 0.8427007929497149],
      [2, 0.9953222650189527],
      [3, 0.9999779095030014],
      [-1, -0.8427007929497149],
    ]
  ) assertAlmostEquals(erf(x), e, 1e-13);
});

Deno.test("gelu is the exact-erf form, not the tanh approximation", () => {
  // tanh-GELU(1) = 0.8411920; exact = Φ(1) = 0.8413447.
  close(gelu(tensor([3], [1, -1, 0])).data, [
    0.8413447460685429,
    -0.15865525393145707,
    0,
  ], 1e-7);
});

Deno.test("linear uses PyTorch [out, in] weights, bias and fused GELU", () => {
  const x = tensor([2, 3], [1, 2, 3, -1, 0, 1]);
  const w = tensor([2, 3], [1, 0, 0, 0, 1, 1]); // out 0 = x0, out 1 = x1 + x2
  const b = tensor([2], [10, 20]);
  const y = linear(x, w, b);
  assertEquals(y.shape, [2, 2]);
  close(y.data, [11, 25, 9, 21]);
  close(linear(x, w).data, [1, 5, -1, 1]);
  close(linear(tensor([1, 3], [0, -1, 0]), w, undefined, "gelu").data, [
    0,
    -0.15865525393145707,
  ]);
  assertThrows(
    () => linear(tensor([1, 2], [1, 2]), w),
    Error,
    "does not match",
  );
});

Deno.test("layerNorm uses biased variance, residual and affine terms", () => {
  const x = tensor([1, 4], [1, 2, 3, 3]);
  const residual = tensor([1, 4], [0, 0, 0, 1]); // v = [1, 2, 3, 4]
  const gamma = tensor([4], [1, 1, 1, 2]);
  const beta = tensor([4], [0, 0, 0, 1]);
  // mean 2.5, biased variance 1.25.
  const inv = 1 / Math.sqrt(1.25 + 1e-5);
  close(layerNorm(x, gamma, beta, { residual }).data, [
    -1.5 * inv,
    -0.5 * inv,
    0.5 * inv,
    1.5 * inv * 2 + 1,
  ]);
});

Deno.test("gatherRows reads neighbour rows and rejects bad indices", () => {
  const x = tensor([3, 2], [0, 1, 10, 11, 20, 21]);
  const y = gatherRows(x, indexTensor([3, 2], [2, 0, 1, 1, 0, 2]));
  assertEquals(y.shape, [3, 2, 2]);
  close(y.data, [20, 21, 0, 1, 10, 11, 10, 11, 0, 1, 20, 21]);
  assertThrows(() => gatherRows(x, indexTensor([1], [3])), Error, "outside");
});

Deno.test("neighborSum masks over K and divides by scale, not the count", () => {
  // L = 2, K = 3, C = 2.
  const x = tensor([2, 3, 2], [1, 2, 3, 4, 5, 6, -1, -2, -3, -4, -5, -6]);
  const mask = tensor([2, 3], [1, 0, 1, 0, 1, 1]);
  close(neighborSum(x, { mask, scale: 2 }).data, [3, 4, -4, -5]);
  close(neighborSum(x).data, [9, 12, -9, -12]);
});

Deno.test("logSoftmax is normalised and stable for large logits", () => {
  close(logSoftmax(tensor([2, 2], [0, Math.LN2, 1000, 1000])).data, [
    -Math.log(3),
    Math.LN2 - Math.log(3),
    -Math.LN2,
    -Math.LN2,
  ]);
});

Deno.test("tileMeanAbs preserves axes and averages partial tiles over real cells", () => {
  const values = Array.from({ length: 35 * 67 }, (_, i) => {
    const r = Math.floor(i / 67), c = i % 67;
    return (i % 2 ? -1 : 1) * (r * 100 + c + 1);
  });
  const out = tileMeanAbs(tensor([35, 67], values));
  assertEquals(out.shape, [2, 3]);
  // Means of the arithmetic row/column sequences, independent of reduction code.
  close(out.data, [1566.5, 1598.5, 1616, 3316.5, 3348.5, 3366]);
  close(tileMeanAbs(tensor([1, 3], [-3, 0, 6])).data, [3]);
  assertThrows(() => tileMeanAbs(tensor([0, 3])), Error, "non-empty");
  assertThrows(() => tileMeanAbs(tensor([3])), Error, "matrix");
});

Deno.test("parseSafetensors reads F32, F16 and BF16 at unaligned offsets", () => {
  const header = JSON.stringify({
    __metadata__: { format: "pt" },
    h: { dtype: "F16", shape: [3], data_offsets: [0, 6] },
    w: { dtype: "F32", shape: [2, 1], data_offsets: [6, 14] },
    b: { dtype: "BF16", shape: [1], data_offsets: [14, 16] },
  }) + " "; // odd header length: the F32 data starts misaligned.
  const json = new TextEncoder().encode(header);
  const bytes = new Uint8Array(8 + json.length + 16);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(json.length), true);
  bytes.set(json, 8);
  const at = 8 + json.length;
  // 1.5, -2 and the smallest normal half 2^-14.
  [0x3e00, 0xc000, 0x0400].forEach((h, i) =>
    view.setUint16(at + 2 * i, h, true)
  );
  view.setFloat32(at + 6, 0.1, true);
  view.setFloat32(at + 10, -3.25, true);
  view.setUint16(at + 14, 0x4049, true); // bf16 3.140625
  const tensors = parseSafetensors(bytes);
  assertEquals([...tensors.keys()], ["h", "w", "b"]);
  close(tensors.get("h")!.data, [1.5, -2, 2 ** -14], 0);
  assertEquals(tensors.get("w")!.shape, [2, 1]);
  close(tensors.get("w")!.data, [Math.fround(0.1), -3.25], 0);
  close(tensors.get("b")!.data, [3.140625], 0);
});
