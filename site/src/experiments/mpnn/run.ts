// Runs ProteinMPNN with @molgpu/nn on the page's GPUDevice and keeps every
// tensor the views draw (weights, encoder layers, log-probabilities and the
// recorded forward pass) alive on the GPU until the runtime is destroyed.
import {
  type GpuTensor,
  layoutFromSteps,
  type ModelLayout,
  NnRuntime,
  parseSafetensors,
  PROTEIN_MPNN_ALPHABET,
  ProteinMpnn,
  type ProteinMpnnEncoding,
  type ProteinMpnnInput,
  proteinMpnnInput,
  ProteinMpnnTrace,
  type Tensor,
} from "@molgpu/nn";
import type { StructureData } from "@molgpu/table";
import { oneHot } from "./flow.ts";

/** A GPU matrix a heatmap can bind, with its display scale. */
export interface MatrixView {
  readonly label: string;
  /** Checkpoint tensor name; absent for matrices derived from weights. */
  readonly name?: string;
  readonly tensor: GpuTensor;
  /** CPU copy of the values, for readouts. */
  readonly values: Float32Array;
  /** Largest |value|, for the diverging palette. */
  readonly scale: number;
}

/** One decoder output: GPU log-probabilities and a CPU copy for the panel. */
export interface Decoded {
  readonly tensor: GpuTensor;
  readonly logProbs: Float32Array;
}

export interface MpnnRun {
  readonly runtime: NnRuntime;
  readonly input: ProteinMpnnInput;
  readonly encoding: ProteinMpnnEncoding;
  /** Decoder with no sequence: P(aa | backbone). */
  readonly structureOnly: Decoded;
  /** Decoder seeing every other native residue: P(aa | backbone, rest of sequence). */
  readonly conditional: Decoded;
  /** Matrices in forward order, as the traced pass read them. */
  readonly layout: ModelLayout;
  /** Every 2-D checkpoint weight in forward order, after amino-acid similarity maps derived on the GPU. */
  readonly matrices: readonly MatrixView[];
  /** The conditional forward pass (encode, then decode seeing the native sequence), step by step. */
  readonly trace: ProteinMpnnTrace;
  /** [L, 21] one-hot native sequence on the GPU, the decoder's sequence input. */
  readonly oneHot: GpuTensor;
  /** CPU copy of each trace step's [L, C] values. */
  readonly traceValues: readonly Float32Array[];
  /** Display scale per trace step: the 98th percentile of |value|. */
  readonly traceScales: readonly number[];
  /** Model position of each structure residue row, or -1. */
  readonly position: Int32Array;
  /** Fraction of positions whose structure-only argmax is the native residue. */
  readonly recovery: number;
  readonly milliseconds: number;
}

const maxAbs = (values: ArrayLike<number>) => {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    max = Math.max(max, Math.abs(values[i]));
  }
  return max || 1;
};

/** Display titles of the trace's stages. */
export const STAGE_TITLES = {
  features: "Edge features",
  encoder: "Encoder",
  sequence: "Sequence",
  decoder: "Decoder",
  output: "Output",
} as const;

let weights: Promise<Map<string, Tensor>> | null = null;
const loadWeights = (url: string) =>
  weights ??= fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`weights: HTTP ${response.status}`);
    return parseSafetensors(new Uint8Array(await response.arrayBuffer()));
  });

export async function runProteinMpnn(
  device: GPUDevice,
  data: StructureData,
  weightsUrl: string,
): Promise<MpnnRun> {
  const cpuWeights = await loadWeights(weightsUrl);
  const started = performance.now();
  const runtime = new NnRuntime(device);
  try {
    const gpuWeights = runtime.uploadWeights(cpuWeights);
    const model = new ProteinMpnn(runtime, gpuWeights);
    const input = proteinMpnnInput(data);
    if (input.sequence.length < 2) {
      throw new Error("ProteinMPNN needs at least two protein residues");
    }
    const trace = new ProteinMpnnTrace(runtime);
    const encoding = model.encode(input, { trace });
    const decode = async (visible: "none" | "all-but-self") => {
      // Only the conditional decode is recorded, so the trace is one full pass.
      const tensor = model.decode(encoding, visible, input.sequence, {
        trace: visible === "all-but-self" ? trace : undefined,
      });
      return {
        tensor,
        logProbs: await runtime.read(tensor) as Float32Array,
      };
    };
    const structureOnly = await decode("none");
    const conditional = await decode("all-but-self");

    const traceValues = await trace.read();
    const traceScales = traceValues.map((values) => {
      const sorted = Float32Array.from(values, Math.abs).sort();
      return sorted[Math.floor(0.98 * (sorted.length - 1))] || 1;
    });

    // safetensors stores names alphabetically; the trace gives forward order.
    const layout = layoutFromSteps(
      trace.steps,
      cpuWeights,
      (stage, layer) => {
        const title = STAGE_TITLES[stage as keyof typeof STAGE_TITLES];
        return layer >= 0 ? `${title} ${layer + 1}` : title;
      },
    );
    const matrices: MatrixView[] = [];
    for (const { name } of layout.stages.flatMap((s) => s.matrices)) {
      const weight = cpuWeights.get(name)!;
      matrices.push({
        label: `${name} [${weight.shape.join(" × ")}]`,
        name,
        tensor: gpuWeights.get(name)!,
        values: weight.data,
        scale: maxAbs(weight.data),
      });
    }
    // Amino-acid similarity, computed by the runtime from the same buffers.
    for (
      const [name, label] of [
        ["W_s.weight", "W_s · W_sᵀ: input embedding similarity [21 × 21]"],
        [
          "W_out.weight",
          "W_out · W_outᵀ: output projection similarity [21 × 21]",
        ],
      ]
    ) {
      const w = gpuWeights.get(name)!;
      const gram = runtime.linear(w, w);
      const values = await runtime.read(gram) as Float32Array;
      matrices.unshift({ label, tensor: gram, values, scale: maxAbs(values) });
    }

    const position = new Int32Array(data.topology.residues.count).fill(-1);
    input.residues.forEach((row, i) => position[row] = i);
    let native = 0;
    const l = input.sequence.length, a = PROTEIN_MPNN_ALPHABET.length;
    for (let i = 0; i < l; i++) {
      const row = structureOnly.logProbs.subarray(i * a, i * a + a);
      if (row.indexOf(Math.max(...row)) === input.sequence[i]) native++;
    }
    return {
      runtime,
      input,
      encoding,
      structureOnly,
      conditional,
      layout,
      matrices,
      trace,
      oneHot: runtime.upload(
        {
          shape: [input.sequence.length, PROTEIN_MPNN_ALPHABET.length],
          data: oneHot(input.sequence),
        },
        "one-hot",
      ),
      traceValues,
      traceScales,
      position,
      recovery: native / l,
      milliseconds: performance.now() - started,
    };
  } catch (error) {
    runtime.destroy();
    throw error;
  }
}
