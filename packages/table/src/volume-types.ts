// Scalar/vector volume samples and their affine grid geometry.
/** Summary statistics over every stored sample of a volume. */
export interface VolumeStats {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  /** Population standard deviation about `mean`. */
  readonly sigma: number;
}

/** Input to `createVolume` / `validateVolume`. */
export interface VolumeInput {
  /**
   * Samples laid out x-fastest: grid point `(i, j, k)` is at
   * `i + dims[0] * (j + dims[1] * k)`, times `components` when interleaved.
   */
  readonly values: Float32Array;
  readonly dims: readonly [number, number, number];
  /** Column-major 4×4 affine from grid index to Å; may rotate and shear. */
  readonly transform: ArrayLike<number>;
  /** Interleaved components per sample. Default 1. */
  readonly components?: 1 | 3;
  /** Unit label for the values, e.g. "e/Å³" or "kT/e". */
  readonly unit?: string;
}

/**
 * The geometry of a volume without its samples: what a GPU sampler bakes in.
 * Every `VolumeData` is a `VolumeGrid`; a computed volume (whose samples live
 * only on the GPU) publishes just this.
 */
export interface VolumeGrid {
  readonly dims: readonly [number, number, number];
  /** Column-major 4×4 affine from grid index to Å. */
  readonly transform: Float32Array;
  readonly components: 1 | 3;
  readonly unit?: string;
}

/** A validated, immutable grid of samples with its index-to-world affine. */
export interface VolumeData {
  readonly values: Float32Array;
  readonly dims: readonly [number, number, number];
  /** Column-major 4×4 affine from grid index to Å. */
  readonly transform: Float32Array;
  readonly stats: VolumeStats;
  readonly components: 1 | 3;
  readonly unit?: string;
}

/** An absolute isovalue, or `{ sigma: k }` for `mean + k * sigma`. */
export type VolumeLevel = number | { readonly sigma: number };
