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

Deno.test("layoutFromNames orders blocks numerically, embeddings first, decoders after encoders", () => {
  // Alphabetical, as safetensors headers store names: "10" sorts before "2"
  // and "decoder" before "encoder".
  const layout = layoutFromNames([
    ["decoder.layers.0.fc.weight", { shape: [8, 8] }],
    ["encoder.layers.10.fc.weight", { shape: [8, 8] }],
    ["encoder.layers.2.fc.weight", { shape: [8, 8] }],
    ["encoder.layers.2.norm.weight", { shape: [8] }],
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
