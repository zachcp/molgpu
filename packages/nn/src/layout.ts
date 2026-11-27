// A model's physical layout: its weight matrices grouped into stages in the
// order the forward pass reads them. Renderer-free and data-free, so the same
// value describes a model whose weights are on the GPU, or one known only from
// a safetensors header.

/** One 2-D weight matrix, PyTorch layout [out, in]. */
export interface LayoutMatrix {
  /** Checkpoint tensor name; `*` stands for the index of repeated copies. */
  readonly name: string;
  /** Logical [out, in], after unpacking packed FP4 storage. */
  readonly shape: readonly [number, number];
  /** Identical copies, such as the experts of a mixture-of-experts layer; 1 when absent. */
  readonly count?: number;
  /** Storage dtype when known, such as `"BF16"` or `"U8 (FP4 packed)"`. */
  readonly dtype?: string;
}

/** A group of matrices read together, such as one transformer block. */
export interface LayoutStage {
  readonly label: string;
  readonly matrices: readonly LayoutMatrix[];
}

/** Stages in forward order; every matrix appears exactly once. */
export interface ModelLayout {
  readonly stages: readonly LayoutStage[];
}

/** A recorded step: the part of the model it ran in and the weights it read. */
export interface LayoutStep {
  readonly stage: string;
  /** Layer within the stage, or -1. */
  readonly layer: number;
  readonly weights: readonly string[];
}

const matrix = (
  name: string,
  t: { readonly shape: readonly number[] } | undefined,
): LayoutMatrix | null =>
  t?.shape.length === 2 ? { name, shape: [t.shape[0], t.shape[1]] } : null;

/**
 * Layout from a recorded forward pass (such as `ProteinMpnnTrace.steps`):
 * each (stage, layer) becomes a stage and each 2-D weight joins the stage
 * that first reads it, in reading order. Weights never read are left out.
 */
export function layoutFromSteps(
  steps: readonly LayoutStep[],
  shapes: ReadonlyMap<string, { readonly shape: readonly number[] }>,
  label: (stage: string, layer: number) => string = (stage, layer) =>
    layer >= 0 ? `${stage} ${layer + 1}` : stage,
): ModelLayout {
  const stages: { label: string; matrices: LayoutMatrix[] }[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const title = label(step.stage, step.layer);
    for (const name of step.weights) {
      if (seen.has(name)) continue;
      const m = matrix(name, shapes.get(name));
      if (!m) continue;
      seen.add(name);
      let stage = stages.at(-1);
      if (stage?.label !== title) {
        stages.push(stage = { label: title, matrices: [] });
      }
      stage.matrices.push(m);
    }
  }
  return { stages };
}

const LAYER = /^(.*?)\.(\d+)\./;
const EMBEDDING = /embed|wte|wpe|word_|position_|token_type/i;
// Quantization side tensors (block scales, zero points), not weights.
const QUANT =
  /\.(weight_)?scale(_inv)?$|\.(input_scale|weight_global_scale|weight_zero_point|zero_point)$/;
// MX / FP4 formats scale groups of 32 values.
const MX_GROUP = 32;

/** Logical [out, in] of a stored 2-D tensor: packed FP4 holds two values per byte. */
function logical(
  name: string,
  t: { readonly shape: readonly number[]; readonly dtype?: string },
  all: ReadonlyMap<
    string,
    { readonly shape: readonly number[]; readonly dtype?: string }
  >,
): { shape: [number, number]; dtype?: string } {
  const [rows, cols] = t.shape;
  if (t.dtype === "I8" || t.dtype === "U8") {
    const base = name.replace(/\.weight(_packed)?$/, "");
    for (const suffix of [".scale", ".weight_scale", ".weight_scale_inv"]) {
      const scale = all.get(base + suffix);
      // One scale per 32 values: 2 * cols values = 32 * scale columns.
      if (scale?.shape.length === 2 && 2 * cols === MX_GROUP * scale.shape[1]) {
        return { shape: [rows, 2 * cols], dtype: `${t.dtype} (FP4 packed)` };
      }
    }
  }
  return t.dtype
    ? { shape: [rows, cols], dtype: t.dtype }
    : { shape: [rows, cols] };
}

/**
 * Layout from weight names alone, for checkpoints that cannot be run here.
 * Names with a numbered block (`model.layers.3.mlp.up_proj.weight`) group
 * into one stage per block, in numeric order; vision towers and projectors
 * come first and families named like decoders after the others. Embeddings
 * lead and remaining weights (final norms, heads) close. Within a block,
 * numbered copies of one shape (`ffn.experts.17.w1.weight`) collapse into one
 * matrix named with `*` and a `count`. Quantization scales are dropped and,
 * given `dtype`, FP4 weights packed two per byte report their logical shape.
 * Set `collapseCopies: false` to keep exact tensor names when binding values.
 * Order within a block is the input order, which for safetensors is
 * alphabetical, not the forward order.
 */
export function layoutFromNames(
  tensors: Iterable<
    readonly [
      string,
      { readonly shape: readonly number[]; readonly dtype?: string },
    ]
  >,
  options: { readonly collapseCopies?: boolean } = {},
): ModelLayout {
  const all = new Map(tensors);
  const first: LayoutMatrix[] = [], last: LayoutMatrix[] = [];
  const blocks = new Map<
    string,
    {
      family: string;
      index: number;
      matrices: LayoutMatrix[];
      repeated: Map<string, { count: number }>;
    }
  >();
  const families: string[] = [];
  for (const [name, t] of all) {
    if (t.shape.length !== 2 || QUANT.test(name)) continue;
    const m: LayoutMatrix = { name, ...logical(name, t, all) };
    const block = LAYER.exec(name);
    if (!block) {
      (EMBEDDING.test(name) ? first : last).push(m);
      continue;
    }
    const [prefix, family, index] = block;
    if (!families.includes(family)) families.push(family);
    const key = `${family}.${index}`;
    let entry = blocks.get(key);
    if (!entry) {
      blocks.set(
        key,
        entry = {
          family,
          index: Number(index),
          matrices: [],
          repeated: new Map(),
        },
      );
    }
    // A second numbered segment inside the block: one of several copies.
    const copy = /^(.*?)\.\d+\.(.*)$/.exec(name.slice(prefix.length));
    if (!copy || options.collapseCopies === false) {
      entry.matrices.push(m);
      continue;
    }
    const pattern = `${prefix}${copy[1]}.*.${copy[2]}`;
    const id = `${pattern} ${m.shape.join("x")}`;
    const seen = entry.repeated.get(id);
    if (seen) seen.count++;
    else {
      const collapsed = { ...m, name: pattern, count: 1 };
      entry.repeated.set(id, collapsed);
      entry.matrices.push(collapsed);
    }
  }
  const n = families.length;
  const rank = (family: string) =>
    (/vision|visual|image|patch/i.test(family)
      ? -2 * n
      : /projector/i.test(family)
      ? -n
      : /decod|mtp/i.test(family)
      ? n
      : 0) + families.indexOf(family);
  const grouped = [...blocks.values()].sort((a, b) =>
    rank(a.family) - rank(b.family) || a.index - b.index
  );
  const stages: LayoutStage[] = [];
  if (first.length) stages.push({ label: "embeddings", matrices: first });
  for (const { family, index, matrices } of grouped) {
    // The last two name segments: "model.layers 7", not "language_model.model.layers 7".
    const short = family.split(".").slice(-2).join(".");
    stages.push({ label: `${short} ${index}`, matrices });
  }
  if (last.length) stages.push({ label: "head", matrices: last });
  return { stages };
}

/** Number of weights in a layout's matrices, counting every copy. */
export function layoutParameters(layout: ModelLayout): number {
  let total = 0;
  for (const stage of layout.stages) {
    for (const { shape, count = 1 } of stage.matrices) {
      total += shape[0] * shape[1] * count;
    }
  }
  return total;
}
