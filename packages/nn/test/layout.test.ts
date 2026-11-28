import { assertEquals, assertThrows } from "@std/assert";
import {
  layoutFromNames,
  layoutFromSteps,
  layoutParameters,
  parseSafetensors,
  readSafetensorsHeader,
  safetensorsHeaderLength,
} from "../src/index.ts";

const shapes = (entries: [string, number[]][]) =>
  new Map(entries.map(([name, shape]) => [name, { shape }]));

Deno.test("layoutFromSteps groups 2-D weights by first use, in reading order", () => {
  const layout = layoutFromSteps(
    [
      { stage: "features", layer: -1, weights: ["emb.weight", "emb.bias"] },
      { stage: "encoder", layer: 0, weights: ["enc.0.w1", "enc.0.w1.bias"] },
      { stage: "encoder", layer: 0, weights: ["enc.0.w2"] },
      // A weight read again later stays in the stage that read it first.
      { stage: "encoder", layer: 1, weights: ["emb.weight", "enc.1.w1"] },
      { stage: "output", layer: -1, weights: ["out"] },
    ],
    shapes([
      ["emb.weight", [16, 66]],
      ["emb.bias", [16]],
      ["enc.0.w1", [128, 384]],
      ["enc.0.w1.bias", [128]],
      ["enc.0.w2", [128, 128]],
      ["enc.1.w1", [128, 384]],
      ["out", [21, 128]],
      ["never.read", [4, 4]],
    ]),
  );
  assertEquals(
    layout.stages.map((s) => [s.label, s.matrices.map((m) => m.name)]),
    [
      ["features", ["emb.weight"]],
      ["encoder 1", ["enc.0.w1", "enc.0.w2"]],
      ["encoder 2", ["enc.1.w1"]],
      ["output", ["out"]],
    ],
  );
  assertEquals(layout.stages[1].matrices[0].shape, [128, 384]);
  assertEquals(
    layoutParameters(layout),
    16 * 66 + 2 * 128 * 384 + 128 * 128 + 21 * 128,
  );
});

Deno.test("layoutFromNames orders blocks without inferring matrix axes or execution order", () => {
  // Lexical sorting can put "10" before "2" and "decoder" before "encoder";
  // within a block the supplied order is not necessarily execution order.
  const layout = layoutFromNames([
    ["decoder.layers.0.fc.weight", { shape: [8, 8] }],
    ["encoder.layers.10.fc.weight", { shape: [8, 8] }],
    ["encoder.layers.2.fc.weight", { shape: [8, 8] }],
    ["encoder.layers.2.norm.weight", { shape: [8] }],
    // Conv1D stores [in, out]; it stays after fc despite alphabetical order.
    ["encoder.layers.2.attn.c_attn.weight", { shape: [8, 24] }],
    ["lm_head.weight", { shape: [100, 8] }],
    ["model.embed_tokens.weight", { shape: [100, 8] }],
  ]);
  assertEquals(layout.stages.map((s) => s.label), [
    "embeddings",
    "encoder.layers 2",
    "encoder.layers 10",
    "decoder.layers 0",
    "head",
  ]);
  assertEquals(layout.stages[0].matrices[0].shape, [100, 8]);
  assertEquals(layout.stages[1].matrices, [
    { name: "encoder.layers.2.fc.weight", shape: [8, 8] },
    { name: "encoder.layers.2.attn.c_attn.weight", shape: [8, 24] },
  ]);
});

Deno.test("readSafetensorsHeader reads shapes without the data section", async () => {
  const bytes = await Deno.readFile(
    new URL("./fixtures/proteinmpnn_v_48_020.safetensors", import.meta.url),
  );
  const length = safetensorsHeaderLength(bytes.subarray(0, 8));
  // Only the header bytes: no tensor data at all.
  const header = readSafetensorsHeader(bytes.subarray(0, 8 + length));
  const full = parseSafetensors(bytes);
  assertEquals([...header.keys()], [...full.keys()]);
  for (const [name, entry] of header) {
    assertEquals(entry.shape, full.get(name)!.shape, name);
    assertEquals(entry.dtype, "F16");
  }
  assertThrows(() => readSafetensorsHeader(bytes.subarray(0, 8 + length - 1)));
  assertThrows(() => safetensorsHeaderLength(bytes.subarray(0, 7)));
});

Deno.test("layoutFromNames collapses experts, drops scales and unpacks FP4", () => {
  // Shapes from DeepSeek-V4-Pro (I8 + F8_E8M0 scale) and Kimi-K3.1-Pro
  // (U8 weight_packed + weight_scale) headers.
  const tensors: [string, { shape: number[]; dtype: string }][] = [];
  for (let e = 0; e < 3; e++) {
    tensors.push(
      [`layers.5.ffn.experts.${e}.w1.weight`, {
        shape: [3072, 3584],
        dtype: "I8",
      }],
      [`layers.5.ffn.experts.${e}.w1.scale`, {
        shape: [3072, 224],
        dtype: "F8_E8M0",
      }],
      [
        `lm.layers.5.moe.experts.${e}.w2.weight_packed`,
        { shape: [7168, 1536], dtype: "U8" },
      ],
      [`lm.layers.5.moe.experts.${e}.w2.weight_scale`, {
        shape: [7168, 96],
        dtype: "U8",
      }],
    );
  }
  tensors.push(
    [`layers.5.attn.wq_a.weight`, { shape: [1536, 7168], dtype: "F8_E4M3" }],
    [`layers.5.attn.wq_a.scale`, { shape: [12, 56], dtype: "F8_E8M0" }],
    // A byte tensor without a matching scale keeps its stored shape.
    [`layers.5.mask`, { shape: [4, 4], dtype: "U8" }],
  );
  const layout = layoutFromNames(tensors);
  const matrices = layout.stages.flatMap((s) => s.matrices);
  assertEquals(
    matrices.map((m) => [m.name, m.shape, m.count ?? 1, m.dtype]),
    [
      ["layers.5.ffn.experts.*.w1.weight", [3072, 7168], 3, "I8 (FP4 packed)"],
      ["layers.5.attn.wq_a.weight", [1536, 7168], 1, "F8_E4M3"],
      ["layers.5.mask", [4, 4], 1, "U8"],
      [
        "lm.layers.5.moe.experts.*.w2.weight_packed",
        [7168, 3072],
        3,
        "U8 (FP4 packed)",
      ],
    ],
  );
  assertEquals(
    layoutParameters(layout),
    3 * 3072 * 7168 + 1536 * 7168 + 16 + 3 * 7168 * 3072,
  );
  // Value-backed views need checkpoint keys, not wildcard display names.
  const exact = layoutFromNames(tensors, { collapseCopies: false });
  assertEquals(
    exact.stages[0].matrices.slice(0, 3).map((m) => [m.name, m.shape, m.count]),
    [
      ["layers.5.ffn.experts.0.w1.weight", [3072, 7168], undefined],
      ["layers.5.ffn.experts.1.w1.weight", [3072, 7168], undefined],
      ["layers.5.ffn.experts.2.w1.weight", [3072, 7168], undefined],
    ],
  );
  assertEquals(layoutParameters(exact), layoutParameters(layout));
});
