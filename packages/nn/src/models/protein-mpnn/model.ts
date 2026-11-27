// ProteinMPNN forward pass (dauparas/ProteinMPNN protein_mpnn_utils.py) as
// NnRuntime ops. Weights are the checkpoint's state_dict tensors under their
// PyTorch names, so every buffer a view binds is one the forward pass reads.
// The encoder keeps each layer's node embeddings for display.
import type { GpuTensor, NnRuntime } from "../../runtime.ts";
import { indexTensor, tensor } from "../../tensor.ts";
import {
  PROTEIN_MPNN_POSITIONS,
  type ProteinMpnnGraph,
  proteinMpnnGraph,
} from "./features.ts";
import type { ProteinMpnnInput } from "./input.ts";
import type { ProteinMpnnStage, ProteinMpnnTrace } from "./trace.ts";

const SCALE = 30;
const LAYERS = 3;

/** Encoder results: the graph, final node and edge embeddings, and each layer's nodes. */
export interface ProteinMpnnEncoding {
  readonly input: ProteinMpnnInput;
  readonly graph: ProteinMpnnGraph;
  /** [L, K] neighbour indices on the GPU. */
  readonly neighbors: GpuTensor;
  /** [L, H] node embeddings after each encoder layer; the last is the encoder output. */
  readonly layers: readonly GpuTensor[];
  /** [L, K, H] edge embeddings after the last encoder layer. */
  readonly edges: GpuTensor;
}

/**
 * Which neighbours' amino acids each position sees while decoding:
 * `"none"` gives the structure-only distribution (upstream
 * `unconditional_probs`); `"all-but-self"` shows every other position's
 * native residue (the pseudo-likelihood, one pass); an array is a decoding
 * order, and a position sees the residues decoded before it (upstream
 * `forward`).
 */
export type ProteinMpnnVisibility = "none" | "all-but-self" | readonly number[];

/** Options for `encode` and `decode`. */
export interface ProteinMpnnRunOptions {
  /** Record every activation of the call into this trace (same runtime). */
  readonly trace?: ProteinMpnnTrace;
}

/** ProteinMPNN on an `NnRuntime`, reading weights named as in the PyTorch state_dict. */
export class ProteinMpnn {
  readonly runtime: NnRuntime;
  readonly weights: ReadonlyMap<string, GpuTensor>;
  #trace: ProteinMpnnTrace | null = null;
  #stage: ProteinMpnnStage = "features";
  #layer = -1;

  constructor(runtime: NnRuntime, weights: ReadonlyMap<string, GpuTensor>) {
    this.runtime = runtime;
    this.weights = weights;
  }

  /** Featurize on the CPU, then run the three encoder layers on the GPU. */
  encode(
    input: ProteinMpnnInput,
    options: ProteinMpnnRunOptions = {},
  ): ProteinMpnnEncoding {
    this.#begin(options.trace);
    try {
      return this.#encode(input);
    } finally {
      this.#trace = null;
    }
  }

  #encode(input: ProteinMpnnInput): ProteinMpnnEncoding {
    const rt = this.runtime, w = this.#w, note = this.#note;
    this.#at("features", -1);
    const graph = proteinMpnnGraph(input);
    const { length: l, k } = graph;
    const neighbors = rt.uploadIndex(
      indexTensor([l, k], graph.neighbors),
      "mpnn-neighbors",
    );
    const onehot = tensor([l, k, PROTEIN_MPNN_POSITIONS]);
    graph.positional.forEach((p, e) =>
      onehot.data[e * PROTEIN_MPNN_POSITIONS + p] = 1
    );
    const temps: GpuTensor[] = [];
    const t = (x: GpuTensor) => (temps.push(x), x);
    const position = t(note(
      "positional embedding",
      ["features.embeddings.linear.weight", "features.embeddings.linear.bias"],
      rt.linear(
        t(note("positional one-hot", [], rt.upload(onehot))),
        w("features.embeddings.linear.weight"),
        w("features.embeddings.linear.bias"),
      ),
    ));
    const rbf = t(note(
      "RBF distances",
      [],
      rt.upload({
        shape: [l, k, graph.rbf.length / (l * k)],
        data: graph.rbf,
      }),
    ));
    const embedded = t(note(
      "edge embedding",
      ["features.edge_embedding.weight"],
      rt.linear(
        t(rt.concat(position, rbf)),
        w("features.edge_embedding.weight"),
      ),
    ));
    const normed = t(note(
      "edge norm",
      ["features.norm_edges.weight", "features.norm_edges.bias"],
      rt.layerNorm(
        embedded,
        w("features.norm_edges.weight"),
        w("features.norm_edges.bias"),
      ),
    ));
    let edges = note(
      "W_e → h_E",
      ["W_e.weight", "W_e.bias"],
      rt.linear(normed, w("W_e.weight"), w("W_e.bias")),
    );
    let nodes = t(rt.zeros([l, edges.shape[2]], "mpnn-h_V"));
    const layers: GpuTensor[] = [];
    for (let i = 0; i < LAYERS; i++) {
      const p = `encoder_layers.${i}.`;
      this.#at("encoder", i);
      const message = t(this.#message(p, nodes, edges, neighbors));
      nodes = this.#nodeUpdate(p, nodes, message);
      layers.push(nodes);
      const edgeMessage = t(this.#message(p, nodes, edges, neighbors, "1"));
      temps.push(edges);
      edges = note(
        "norm3 → h_E",
        [p + "norm3.weight", p + "norm3.bias"],
        rt.layerNorm(
          edgeMessage,
          w(p + "norm3.weight"),
          w(p + "norm3.bias"),
          { residual: edges },
        ),
      );
    }
    rt.release(...temps);
    return { input, graph, neighbors, layers, edges };
  }

  /** [L, 21] log-probabilities of every amino acid at every position. */
  decode(
    encoding: ProteinMpnnEncoding,
    visible: ProteinMpnnVisibility,
    sequence: Uint8Array = encoding.input.sequence,
    options: ProteinMpnnRunOptions = {},
  ): GpuTensor {
    this.#begin(options.trace);
    try {
      return this.#decode(encoding, visible, sequence);
    } finally {
      this.#trace = null;
    }
  }

  #decode(
    encoding: ProteinMpnnEncoding,
    visible: ProteinMpnnVisibility,
    sequence: Uint8Array,
  ): GpuTensor {
    const rt = this.runtime, w = this.#w, note = this.#note;
    const { graph, neighbors, edges } = encoding;
    const encoded = encoding.layers[encoding.layers.length - 1];
    const { length: l, k } = graph;
    const temps: GpuTensor[] = [];
    const t = (x: GpuTensor) => (temps.push(x), x);
    // Encoder-only neighbour features: [h_E, 0, h_V_j].
    const encoderOnly = t(rt.concat(
      t(rt.concat(edges, t(rt.zeros(edges.shape)))),
      t(rt.gatherRows(encoded, neighbors)),
    ));
    const mask = visibility(graph, visible);
    let withSequence: GpuTensor | null = null, maskGpu: GpuTensor | null = null;
    if (mask) {
      if (sequence.length !== l) {
        throw new Error(
          `decode: sequence has ${sequence.length} residues, expected ${l}`,
        );
      }
      this.#at("sequence", -1);
      const residues = t(note(
        "sequence embedding W_s[s]",
        ["W_s.weight"],
        rt.gatherRows(
          w("W_s.weight"),
          t(rt.uploadIndex(indexTensor([l], sequence))),
        ),
      ));
      withSequence = t(rt.concat(edges, t(rt.gatherRows(residues, neighbors))));
      maskGpu = t(rt.upload(tensor([l, k], mask)));
    }
    let nodes = encoded;
    for (let i = 0; i < LAYERS; i++) {
      const p = `decoder_layers.${i}.`;
      this.#at("decoder", i);
      const context = withSequence && maskGpu
        ? t(rt.mix(
          t(rt.concat(withSequence, t(rt.gatherRows(nodes, neighbors)))),
          encoderOnly,
          maskGpu,
        ))
        : encoderOnly;
      const input = t(note(
        mask
          ? "message input [h_V, h_E, h_S_j or 0, h_V_j]"
          : "message input [h_V, h_E, 0, h_V_j]",
        [],
        rt.concat(nodes, context),
      ));
      const message = t(this.#messageMlp(p, input));
      const next = this.#nodeUpdate(p, nodes, message);
      if (nodes !== encoded) temps.push(nodes);
      nodes = next;
    }
    temps.push(nodes);
    this.#at("output", -1);
    const logits = t(note(
      "W_out logits",
      ["W_out.weight", "W_out.bias"],
      rt.linear(nodes, w("W_out.weight"), w("W_out.bias")),
    ));
    const logProbs = note("log-softmax", [], rt.logSoftmax(logits));
    rt.release(...temps);
    return logProbs;
  }

  /** Release an encoding's GPU tensors. */
  release(encoding: ProteinMpnnEncoding): void {
    this.runtime.release(
      encoding.neighbors,
      encoding.edges,
      ...encoding.layers,
    );
  }

  #begin(trace: ProteinMpnnTrace | undefined): void {
    if (trace && trace.runtime !== this.runtime) {
      throw new Error("ProteinMpnn: trace belongs to another runtime");
    }
    this.#trace = trace ?? null;
  }

  #at(stage: ProteinMpnnStage, layer: number): void {
    this.#stage = stage;
    this.#layer = layer;
  }

  /** Record x into the active trace, if any, and return it. */
  #note = (name: string, weights: string[], x: GpuTensor): GpuTensor => {
    this.#trace?.record(this.#stage, this.#layer, name, weights, x);
    return x;
  };

  #w = (name: string): GpuTensor => {
    const weight = this.weights.get(name);
    if (!weight) throw new Error(`ProteinMpnn: missing weight ${name}`);
    return weight;
  };

  /** W3(gelu(W2(gelu(W1(x))))), or W13/W12/W11 for the edge update. */
  #messageMlp(prefix: string, x: GpuTensor, edge = ""): GpuTensor {
    const rt = this.runtime, w = this.#w;
    const layer = (j: number, h: GpuTensor, activation: "gelu" | "none") => {
      const name = `${prefix}W${edge}${j}`;
      return this.#note(
        `${edge ? "edge " : ""}message W${edge}${j}${
          activation === "gelu" ? " (GELU)" : ""
        }`,
        [`${name}.weight`, `${name}.bias`],
        rt.linear(h, w(`${name}.weight`), w(`${name}.bias`), activation),
      );
    };
    const h1 = layer(1, x, "gelu");
    const h2 = layer(2, h1, "gelu");
    const out = layer(3, h2, "none");
    rt.release(h1, h2);
    return out;
  }

  /** Encoder message: the MLP of [h_V_i, h_E_ij, h_V_j]. */
  #message(
    prefix: string,
    nodes: GpuTensor,
    edges: GpuTensor,
    neighbors: GpuTensor,
    edge = "",
  ): GpuTensor {
    const rt = this.runtime;
    const gathered = rt.gatherRows(nodes, neighbors);
    const pair = rt.concat(edges, gathered);
    const input = this.#note(
      `${edge ? "edge " : ""}message input [h_V, h_E, h_V_j]`,
      [],
      rt.concat(nodes, pair),
    );
    const out = this.#messageMlp(prefix, input, edge);
    rt.release(gathered, pair, input);
    return out;
  }

  /** norm1(h_V + sum_k(message) / 30), then norm2(h + FFN(h)). */
  #nodeUpdate(prefix: string, nodes: GpuTensor, message: GpuTensor): GpuTensor {
    const rt = this.runtime, w = this.#w, note = this.#note;
    const names = (part: string) => [
      `${prefix}${part}.weight`,
      `${prefix}${part}.bias`,
    ];
    const sum = note(
      `message sum / ${SCALE}`,
      [],
      rt.neighborSum(message, { scale: SCALE }),
    );
    const h = note(
      "norm1 (h_V + messages)",
      names("norm1"),
      rt.layerNorm(sum, w(prefix + "norm1.weight"), w(prefix + "norm1.bias"), {
        residual: nodes,
      }),
    );
    const hidden = note(
      "dense.W_in (GELU)",
      names("dense.W_in"),
      rt.linear(
        h,
        w(prefix + "dense.W_in.weight"),
        w(prefix + "dense.W_in.bias"),
        "gelu",
      ),
    );
    const ff = note(
      "dense.W_out",
      names("dense.W_out"),
      rt.linear(
        hidden,
        w(prefix + "dense.W_out.weight"),
        w(prefix + "dense.W_out.bias"),
      ),
    );
    const out = note(
      "norm2 → h_V",
      names("norm2"),
      rt.layerNorm(ff, w(prefix + "norm2.weight"), w(prefix + "norm2.bias"), {
        residual: h,
      }),
    );
    rt.release(sum, h, hidden, ff);
    return out;
  }
}

/** [L, K] 1 where position i sees neighbour j's amino acid, or null for none. */
function visibility(
  graph: ProteinMpnnGraph,
  visible: ProteinMpnnVisibility,
): Float32Array | null {
  if (visible === "none") return null;
  const { length: l, k, neighbors } = graph;
  const rank = new Int32Array(l);
  if (visible === "all-but-self") rank.fill(-1);
  else {
    if (visible.length !== l) {
      throw new Error(
        `decode: order has ${visible.length} positions, expected ${l}`,
      );
    }
    rank.fill(-1);
    visible.forEach((position, step) => rank[position] = step);
    if (rank.includes(-1)) {
      throw new Error("decode: order is not a permutation");
    }
  }
  const mask = new Float32Array(l * k);
  for (let i = 0; i < l; i++) {
    for (let e = 0; e < k; e++) {
      const j = neighbors[i * k + e];
      mask[i * k + e] = visible === "all-but-self"
        ? (j !== i ? 1 : 0)
        : (rank[j] < rank[i] ? 1 : 0);
    }
  }
  return mask;
}
