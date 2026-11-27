// GPU parity for @molgpu/nn: every kernel against its CPU reference on Deno's
// built-in WebGPU (no browser), plus buffer ownership. Shapes are deliberately
// not multiples of the 64-thread workgroup. Run with `deno task test:nn:gpu`.
import { assert, assertEquals, assertLessOrEqual } from "@std/assert";
import {
  gatherRows,
  type GpuTensor,
  indexTensor,
  layerNorm,
  layoutFromSteps,
  linear,
  logSoftmax,
  neighborSum,
  NnRuntime,
  parseSafetensors,
  ProteinMpnn,
  proteinMpnnInput,
  ProteinMpnnTrace,
  type Tensor,
  tensor,
} from "../src/index.ts";

const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) throw new Error("no WebGPU adapter: these tests need a GPU");
const device = await adapter.requestDevice();
const errors: string[] = [];
device.addEventListener("uncapturederror", (event) => {
  errors.push((event as GPUUncapturedErrorEvent).error.message);
});

let seed = 12345;
const random = (shape: number[], scale = 1): Tensor => {
  const t = tensor(shape);
  for (let i = 0; i < t.data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    t.data[i] = (seed / 2 ** 32 * 2 - 1) * scale;
  }
  return t;
};

async function expectParity(
  rt: NnRuntime,
  gpu: GpuTensor,
  cpu: Tensor,
  tolerance: number,
): Promise<void> {
  assertEquals(gpu.shape, cpu.shape);
  const out = await rt.read(gpu);
  let worst = 0;
  for (let i = 0; i < cpu.data.length; i++) {
    worst = Math.max(worst, Math.abs(out[i] - cpu.data[i]));
  }
  assertLessOrEqual(worst, tolerance);
}

Deno.test("nn GPU kernels match the CPU references", async (t) => {
  const rt = new NnRuntime(device);
  try {
    await t.step("linear with bias and GELU", async () => {
      const x = random([37, 130]), w = random([21, 130], 0.2);
      const b = random([21]);
      const [gx, gw, gb] = [x, w, b].map((v) => rt.upload(v));
      await expectParity(rt, rt.linear(gx, gw, gb), linear(x, w, b), 1e-5);
      await expectParity(
        rt,
        rt.linear(gx, gw, undefined, "gelu"),
        linear(x, w, undefined, "gelu"),
        1e-5,
      );
    });
    await t.step("GELU across [-8, 8]", async () => {
      const x = tensor(
        [161, 1],
        Array.from({ length: 161 }, (_, i) => -8 + i / 10),
      );
      const w = tensor([1, 1], [1]);
      await expectParity(
        rt,
        rt.linear(rt.upload(x), rt.upload(w), undefined, "gelu"),
        linear(x, w, undefined, "gelu"),
        1e-6,
      );
    });
    await t.step("layerNorm with residual", async () => {
      const x = random([67, 128], 3), r = random([67, 128]);
      const gamma = random([128]), beta = random([128]);
      await expectParity(
        rt,
        rt.layerNorm(rt.upload(x), rt.upload(gamma), rt.upload(beta), {
          residual: rt.upload(r),
        }),
        layerNorm(x, gamma, beta, { residual: r }),
        1e-5,
      );
    });
    await t.step("gatherRows from a [L, K] neighbour index", async () => {
      const x = random([50, 7]);
      const index = indexTensor(
        [50, 9],
        Array.from({ length: 450 }, (_, i) => (i * 37 + 11) % 50),
      );
      await expectParity(
        rt,
        rt.gatherRows(rt.upload(x), rt.uploadIndex(index)),
        gatherRows(x, index),
        0,
      );
    });
    await t.step("neighborSum with mask and scale", async () => {
      const x = random([23, 48, 5]);
      const mask = tensor(
        [23, 48],
        Array.from({ length: 23 * 48 }, (_, i) => i % 3 ? 1 : 0),
      );
      await expectParity(
        rt,
        rt.neighborSum(rt.upload(x), { mask: rt.upload(mask), scale: 30 }),
        neighborSum(x, { mask, scale: 30 }),
        1e-6,
      );
    });
    await t.step("logSoftmax over 21 letters", async () => {
      const x = random([97, 21], 20);
      await expectParity(rt, rt.logSoftmax(rt.upload(x)), logSoftmax(x), 1e-5);
    });
    await t.step("chained ops stay on the GPU until read", async () => {
      const x = random([19, 16]), w = random([16, 16], 0.3), b = random([16]);
      const gamma = random([16]), beta = random([16]);
      const [gx, gw, gb, gg, gbeta] = [x, w, b, gamma, beta].map((v) =>
        rt.upload(v)
      );
      const gpu = rt.logSoftmax(
        rt.layerNorm(rt.linear(gx, gw, gb, "gelu"), gg, gbeta, {
          residual: gx,
        }),
      );
      const cpu = logSoftmax(
        layerNorm(linear(x, w, b, "gelu"), gamma, beta, { residual: x }),
      );
      await expectParity(rt, gpu, cpu, 1e-5);
    });
  } finally {
    rt.destroy();
  }
  await device.queue.onSubmittedWorkDone();
  assertEquals(errors, [], "uncaptured WebGPU errors");
});

Deno.test("nn runtime owns its tensors and leaves wrapped buffers alone", async () => {
  const usage = 0x0080 | 0x0004 | 0x0008; // STORAGE | COPY_SRC | COPY_DST
  const external = device.createBuffer({ size: 16, usage });
  device.queue.writeBuffer(external, 0, new Float32Array([1, 2, 3, 4]));
  const rt = new NnRuntime(device);
  const weights = rt.uploadWeights(new Map([["w", tensor([1, 2], [2, -1])]]));
  const w = weights.get("w")!;
  assert(w.owned && w.buffer.label === "molgpu:nn:w");
  // The buffer a renderer would bind is the one the matmul reads.
  const y = rt.linear(rt.wrap(external, [2, 2]), w);
  assertEquals([...await rt.read(y)], [0, 2]);
  rt.destroy();

  // The wrapped buffer survives the runtime and is still usable.
  const second = new NnRuntime(device);
  const copy = second.linear(
    second.wrap(external, [2, 2]),
    second.upload(tensor([1, 2], [1, 0])),
  );
  assertEquals([...await second.read(copy)], [1, 3]);
  second.destroy();
  external.destroy();
  await device.queue.onSubmittedWorkDone();
  assertEquals(errors, [], "uncaptured WebGPU errors");
});

Deno.test("ProteinMPNN matches upstream PyTorch on three structures", async (t) => {
  const { structureFromBcif } = await import("@molgpu/io");
  const fixtures = new URL("./fixtures/", import.meta.url);
  const reference = JSON.parse(
    await Deno.readTextFile(new URL("proteinmpnn-reference.json", fixtures)),
  );
  const rt = new NnRuntime(device);
  const weights = parseSafetensors(
    await Deno.readFile(new URL("proteinmpnn_v_48_020.safetensors", fixtures)),
  );
  const model = new ProteinMpnn(rt, rt.uploadWeights(weights));
  try {
    for (const name of ["1crn", "1ema", "1a4y"]) {
      await t.step(name, async () => {
        const expected = reference[name];
        const input = proteinMpnnInput(
          await structureFromBcif(
            await Deno.readFile(
              new URL(`../../io/test/fixtures/${name}.bcif`, import.meta.url),
            ),
          ),
        );
        const encoding = model.encode(input);
        assertEquals([...encoding.graph.neighbors], expected.neighbors);
        const worst: Record<string, number> = {};
        for (
          const [mode, visible, key] of [
            ["structure", "none", "none"],
            ["order", expected.order, "order_log_probs"],
            ["all-but-self", "all-but-self", "all_but_self"],
          ] as const
        ) {
          const logProbs = model.decode(encoding, visible);
          const out = await rt.read(logProbs);
          rt.release(logProbs);
          let max = 0;
          for (let i = 0; i < out.length; i++) {
            max = Math.max(max, Math.abs(out[i] - expected[key][i]));
          }
          worst[mode] = max;
        }
        model.release(encoding);
        console.log(name, input.sequence.length, worst);
        for (const max of Object.values(worst)) assertLessOrEqual(max, 1e-3);
      });
    }
  } finally {
    rt.destroy();
  }
  await device.queue.onSubmittedWorkDone();
  assertEquals(errors, [], "uncaptured WebGPU errors");
});

Deno.test("ProteinMPNN trace records every step of the forward pass", async () => {
  const { structureFromBcif } = await import("@molgpu/io");
  const fixtures = new URL("./fixtures/", import.meta.url);
  const rt = new NnRuntime(device);
  const checkpoint = parseSafetensors(
    await Deno.readFile(new URL("proteinmpnn_v_48_020.safetensors", fixtures)),
  );
  const model = new ProteinMpnn(rt, rt.uploadWeights(checkpoint));
  try {
    const input = proteinMpnnInput(
      await structureFromBcif(
        await Deno.readFile(
          new URL("../../io/test/fixtures/1crn.bcif", import.meta.url),
        ),
      ),
    );
    const l = input.sequence.length;
    const plain = model.encode(input);
    const untraced = await rt.read(model.decode(plain, "all-but-self"));
    model.release(plain);

    const trace = new ProteinMpnnTrace(rt);
    const encoding = model.encode(input, { trace });
    const logProbs = model.decode(
      encoding,
      "all-but-self",
      input.sequence,
      { trace },
    );
    const traced = await rt.read(logProbs);
    assertEquals(traced, untraced, "tracing changes the result");

    const { steps } = trace;
    // 6 feature steps, 14 per encoder layer, the sequence embedding, 9 per
    // decoder layer, logits and log-softmax.
    assertEquals(steps.length, 6 + 3 * 14 + 1 + 3 * 9 + 2);
    const stages = ["features", "encoder", "sequence", "decoder", "output"];
    for (let i = 1; i < steps.length; i++) {
      const [a, b] = [steps[i - 1], steps[i]];
      const order = stages.indexOf(b.stage) - stages.indexOf(a.stage);
      assert(order > 0 || (order === 0 && b.layer >= a.layer), b.name);
    }
    for (const step of steps) {
      assertEquals(step.values.shape, [l, step.shape[step.shape.length - 1]]);
      for (const name of step.weights) assert(checkpoint.has(name), name);
    }
    // The traced layout holds every 2-D checkpoint weight exactly once, in
    // the stages that read them: features, 3 encoder layers, the sequence
    // embedding, 3 decoder layers, output.
    const layout = layoutFromSteps(steps, checkpoint);
    const names = layout.stages.flatMap((s) => s.matrices.map((m) => m.name));
    const matrices = [...checkpoint].filter(([, w]) => w.shape.length === 2);
    assertEquals(names.length, matrices.length);
    assertEquals(new Set(names), new Set(matrices.map(([name]) => name)));
    assertEquals(layout.stages.map((s) => s.label), [
      "features",
      "encoder 1",
      "encoder 2",
      "encoder 3",
      "sequence",
      "decoder 1",
      "decoder 2",
      "decoder 3",
      "output",
    ]);

    const values = await trace.read();
    assertEquals(steps.at(-1)!.name, "log-softmax");
    assertEquals(values.at(-1), traced);
    const outputs = steps.filter((s) => s.name === "norm2 → h_V");
    for (let i = 0; i < 3; i++) {
      assertEquals(values[outputs[i].index], await rt.read(encoding.layers[i]));
    }
    // Edge activations are kept as their mean over the K neighbours.
    const lastEdges = steps.findLast((s) => s.name === "norm3 → h_E")!;
    const [, k, c] = encoding.edges.shape;
    const edges = await rt.read(encoding.edges);
    let worst = 0;
    for (let i = 0; i < l; i++) {
      for (let j = 0; j < c; j++) {
        let sum = 0;
        for (let e = 0; e < k; e++) sum += edges[(i * k + e) * c + j];
        worst = Math.max(
          worst,
          Math.abs(sum / k - values[lastEdges.index][i * c + j]),
        );
      }
    }
    assertLessOrEqual(worst, 1e-5);

    trace.release();
    assertEquals(trace.steps.length, 0);
    rt.release(logProbs);
    model.release(encoding);
  } finally {
    rt.destroy();
  }
  await device.queue.onSubmittedWorkDone();
  assertEquals(errors, [], "uncaptured WebGPU errors");
});

Deno.test("ProteinMPNN reads its weights from the GPU buffers it exposes", async () => {
  const { structureFromBcif } = await import("@molgpu/io");
  const fixtures = new URL("./fixtures/", import.meta.url);
  const rt = new NnRuntime(device);
  const checkpoint = parseSafetensors(
    await Deno.readFile(new URL("proteinmpnn_v_48_020.safetensors", fixtures)),
  );
  const weights = rt.uploadWeights(checkpoint);
  const model = new ProteinMpnn(rt, weights);
  try {
    assertEquals(model.layers, { encoder: 3, decoder: 3 });
    // Every buffer holds exactly the checkpoint tensor under its name.
    for (const [name, cpu] of checkpoint) {
      const gpu = weights.get(name)!;
      assertEquals(gpu.shape, cpu.shape, name);
      assertEquals(await rt.read(gpu), cpu.data, name);
    }
    const input = proteinMpnnInput(
      await structureFromBcif(
        await Deno.readFile(
          new URL("../../io/test/fixtures/1crn.bcif", import.meta.url),
        ),
      ),
    );
    const l = input.sequence.length;
    const encoding = model.encode(input);
    const run = async (visible: "none" | "all-but-self") => {
      const t = model.decode(encoding, visible);
      const out = await rt.read(t) as Float32Array;
      rt.release(t);
      return out;
    };
    const write = (name: string, data: Float32Array) =>
      device.queue.writeBuffer(weights.get(name)!.buffer, 0, data);
    const baseline = {
      none: await run("none"),
      all: await run("all-but-self"),
    };

    // Raising W_out's bias for alanine on the GPU raises P(A) everywhere:
    // the output layer reads that buffer, not a copy.
    const bias = checkpoint.get("W_out.bias")!.data;
    write("W_out.bias", bias.map((v, a) => a === 0 ? v + 4 : v));
    const raised = await run("none");
    for (let i = 0; i < l; i++) {
      assert(raised[i * 21] > baseline.none[i * 21], `P(A) at ${i}`);
    }
    write("W_out.bias", bias);

    // Zeroing W_s (the sequence embedding) changes only sequence-conditioned
    // output: amino acids enter through that buffer and only in the decoder.
    write(
      "W_s.weight",
      new Float32Array(checkpoint.get("W_s.weight")!.data.length),
    );
    assertEquals(await run("none"), baseline.none);
    const blind = await run("all-but-self");
    let changed = 0;
    for (let i = 0; i < blind.length; i++) {
      changed = Math.max(changed, Math.abs(blind[i] - baseline.all[i]));
    }
    assert(changed > 0.1, `W_s zeroed changed log-probs by only ${changed}`);
    // Restoring the buffers restores the output bit for bit.
    write("W_s.weight", checkpoint.get("W_s.weight")!.data);
    assertEquals(await run("all-but-self"), baseline.all);
    model.release(encoding);
  } finally {
    rt.destroy();
  }
  await device.queue.onSubmittedWorkDone();
  assertEquals(errors, [], "uncaptured WebGPU errors");
});
