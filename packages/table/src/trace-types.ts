// Polymer traces and per-sample secondary-structure annotations.
/** Segmented polymer trace: guide points, per-sample frames, and CSR-style run offsets. */
export interface Trace {
  readonly count: number;
  readonly guide: Float32Array;
  readonly tangent: Float32Array;
  readonly normal: Float32Array;
  readonly binormal: Float32Array;
  /** Source residue row per sample (sample-to-residue mapping / retained residue IDs). */
  readonly residue: Uint32Array;
  /** Run r spans [runs[r], runs[r + 1]); length is runCount + 1. */
  readonly runs: Uint32Array;
  readonly runKind: readonly ("protein" | "rna" | "dna")[];
}

/** Per-sample direction vectors + secondary-structure labels/block-boundary flags over an existing Trace. */
export interface SecondaryStructureTrace {
  readonly count: number;
  readonly direction: Float32Array;
  readonly kind: readonly ("helix" | "sheet" | "coil")[];
  /** 1 where a sample starts/ends a stable-frame block (run boundary or an SS-kind change), else 0. */
  readonly first: Uint8Array;
  readonly last: Uint8Array;
}
