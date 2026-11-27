// A model's physical layout: its weight matrices grouped into stages in the
// order the forward pass reads them. Renderer-free and data-free, so the same
// value describes a model whose weights are on the GPU, or one known only from
// a safetensors header.

/** One 2-D weight matrix, PyTorch layout [out, in]. */
export interface LayoutMatrix {
  /** Checkpoint tensor name. */
  readonly name: string;
  readonly shape: readonly [number, number];
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

/**
 * Layout from weight names alone, for checkpoints that cannot be run here.
 * Names with a numbered block (`model.layers.3.mlp.up_proj.weight`) group
 * into one stage per block, in numeric order; families named like decoders
 * follow the others. Embeddings come first and remaining weights (final
 * norms, heads) last. Order within a block is the input order, which for
 * safetensors is alphabetical, not the forward order.
 */
export function layoutFromNames(
  tensors: Iterable<readonly [string, { readonly shape: readonly number[] }]>,
): ModelLayout {
  const first: LayoutMatrix[] = [], last: LayoutMatrix[] = [];
  const blocks = new Map<
    string,
    { family: string; index: number; matrices: LayoutMatrix[] }
  >();
  const families: string[] = [];
  for (const [name, t] of tensors) {
    const m = matrix(name, t);
    if (!m) continue;
    const block = LAYER.exec(name);
    if (block) {
      const [, family, index] = block;
      if (!families.includes(family)) families.push(family);
      const key = `${family}.${index}`;
      let entry = blocks.get(key);
      if (!entry) {
        blocks.set(key, entry = { family, index: Number(index), matrices: [] });
      }
      entry.matrices.push(m);
    } else (EMBEDDING.test(name) ? first : last).push(m);
  }
  const rank = (family: string) =>
    (/decod/i.test(family) ? families.length : 0) + families.indexOf(family);
  const grouped = [...blocks.values()].sort((a, b) =>
    rank(a.family) - rank(b.family) || a.index - b.index
  );
  const stages: LayoutStage[] = [];
  if (first.length) stages.push({ label: "embeddings", matrices: first });
  for (const { family, index, matrices } of grouped) {
    stages.push({ label: `${family} ${index}`, matrices });
  }
  if (last.length) stages.push({ label: "head", matrices: last });
  return { stages };
}

/** Number of weights in a layout's matrices. */
export function layoutParameters(layout: ModelLayout): number {
  let total = 0;
  for (const stage of layout.stages) {
    for (const { shape } of stage.matrices) total += shape[0] * shape[1];
  }
  return total;
}
