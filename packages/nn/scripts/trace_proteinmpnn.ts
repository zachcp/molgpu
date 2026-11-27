// Run one ProteinMPNN forward pass on Deno's WebGPU and write its trace as
// JSON: the protein input, every recorded step (stage, weights, shape, value
// statistics, optionally all [L, C] values) and the output log-probabilities.
// This replays exactly what the site's forward-pass view shows.
//   deno run -A packages/nn/scripts/trace_proteinmpnn.ts 1crn out.json [--values]
//   deno run -A packages/nn/scripts/trace_proteinmpnn.ts path/to/x.bcif out.json
import { structureFromBcif } from "@molgpu/io";
import {
  NnRuntime,
  parseSafetensors,
  PROTEIN_MPNN_ALPHABET,
  ProteinMpnn,
  proteinMpnnInput,
  ProteinMpnnTrace,
} from "../src/index.ts";

const args = Deno.args.filter((a) => !a.startsWith("--"));
const withValues = Deno.args.includes("--values");
const [source, out] = args;
if (!source || !out) {
  console.error(
    "usage: trace_proteinmpnn.ts <fixture|file.bcif> <out.json> [--values]",
  );
  Deno.exit(2);
}
const path = source.endsWith(".bcif")
  ? source
  : new URL(`../../io/test/fixtures/${source}.bcif`, import.meta.url);
const input = proteinMpnnInput(
  await structureFromBcif(await Deno.readFile(path)),
);

const adapter = await navigator.gpu?.requestAdapter();
if (!adapter) throw new Error("no WebGPU adapter");
const runtime = new NnRuntime(await adapter.requestDevice());
try {
  const checkpoint = parseSafetensors(
    await Deno.readFile(
      new URL(
        "../test/fixtures/proteinmpnn_v_48_020.safetensors",
        import.meta.url,
      ),
    ),
  );
  const model = new ProteinMpnn(runtime, runtime.uploadWeights(checkpoint));
  const trace = new ProteinMpnnTrace(runtime);
  const encoding = model.encode(input, { trace });
  model.decode(encoding, "all-but-self", input.sequence, { trace });
  const values = await trace.read();
  const steps = trace.steps.map((step, i) => {
    const v = values[i];
    let sum = 0, squares = 0, min = Infinity, max = -Infinity;
    for (const x of v) {
      sum += x;
      squares += x * x;
      min = Math.min(min, x);
      max = Math.max(max, x);
    }
    const mean = sum / v.length;
    return {
      index: step.index,
      stage: step.stage,
      layer: step.layer,
      name: step.name,
      weights: step.weights,
      shape: step.shape,
      stats: {
        mean,
        std: Math.sqrt(squares / v.length - mean * mean),
        min,
        max,
      },
      ...(withValues ? { values: Array.from(v) } : {}),
    };
  });
  const sequence = Array.from(input.sequence, (a) => PROTEIN_MPNN_ALPHABET[a])
    .join("");
  await Deno.writeTextFile(
    out,
    JSON.stringify({
      source: String(source),
      length: input.sequence.length,
      k: encoding.graph.k,
      sequence,
      decode: "all-but-self",
      steps,
      logProbs: Array.from(values.at(-1)!),
    }),
  );
  console.log(
    `${source}: ${input.sequence.length} residues, ${steps.length} steps → ${out}`,
  );
} finally {
  runtime.destroy();
}
