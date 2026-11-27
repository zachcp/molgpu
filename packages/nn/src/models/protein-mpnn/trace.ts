// A recording of one ProteinMPNN forward pass: every intermediate activation,
// in dispatch order, named by the step that produced it and the checkpoint
// weights that step read. The trace owns copies, so the model still frees its
// temporaries and a renderer can bind a step's buffer for as long as it needs.
import type { GpuTensor, NnRuntime } from "../../runtime.ts";

/** Part of the network a step belongs to. */
export type ProteinMpnnStage =
  | "features"
  | "encoder"
  | "sequence"
  | "decoder"
  | "output";

/** One recorded activation. */
export interface ProteinMpnnStep {
  /** Position in the trace, from 0. */
  readonly index: number;
  readonly stage: ProteinMpnnStage;
  /** Encoder or decoder layer from 0; -1 outside the layers. */
  readonly layer: number;
  /** What the step computes, such as `"message W2"` or `"norm1"`. */
  readonly name: string;
  /** Checkpoint tensors the step read, by state_dict name. */
  readonly weights: readonly string[];
  /** Shape of the activation the model computed: [L, C] or [L, K, C]. */
  readonly shape: readonly number[];
  /**
   * [L, C] values per residue: the activation itself, or for an [L, K, C]
   * edge activation its mean over the K neighbours.
   */
  readonly values: GpuTensor;
}

/**
 * Pass to `ProteinMpnn.encode` and `decode` to record their activations.
 * One trace can record an encode followed by a decode; `release` frees every
 * recorded buffer.
 */
export class ProteinMpnnTrace {
  readonly runtime: NnRuntime;
  #steps: ProteinMpnnStep[] = [];

  constructor(runtime: NnRuntime) {
    this.runtime = runtime;
  }

  /** Recorded steps in forward-pass order. */
  get steps(): readonly ProteinMpnnStep[] {
    return this.#steps;
  }

  /** Record x as the next step; called by `ProteinMpnn` while it runs. */
  record(
    stage: ProteinMpnnStage,
    layer: number,
    name: string,
    weights: readonly string[],
    x: GpuTensor,
  ): void {
    if (x.shape.length !== 2 && x.shape.length !== 3) {
      throw new Error(`trace: ${name} has rank ${x.shape.length}`);
    }
    const values = x.shape.length === 3
      ? this.runtime.neighborSum(x, { scale: x.shape[1] })
      : this.runtime.copy(x, `trace:${name}`);
    this.#steps.push({
      index: this.#steps.length,
      stage,
      layer,
      name,
      weights: [...weights],
      shape: [...x.shape],
      values,
    });
  }

  /** CPU copies of every step's [L, C] values, in step order. */
  async read(): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const step of this.#steps) {
      out.push(await this.runtime.read(step.values) as Float32Array);
    }
    return out;
  }

  /** Destroy every recorded buffer and empty the trace. */
  release(): void {
    this.runtime.release(...this.#steps.map((step) => step.values));
    this.#steps = [];
  }
}
