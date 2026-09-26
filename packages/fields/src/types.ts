// Public types for @molgpu/fields. Fields are opaque: build them with the constructors.
import type { StructureData, VolumeData } from "@molgpu/table";

export type Domain = "atom" | "residue";
export type Overflow = "clamp" | "wrap" | "fail";

export interface ValueType {
  readonly kind: "scalar" | "color" | "string";
  readonly components: number;
  readonly wgsl: string | null;
}

/** A typed per-row value description. Opaque: build with the constructors. */
export interface Field {
  readonly kind: string;
  readonly type: ValueType;
  /** 'atom' | 'residue', or 'any' for a broadcast constant/curve. */
  readonly domain: Domain | "any";
}

export type Scalar = number;
export type Color = readonly [number, number, number, number];

export interface EvalContext {
  t?: number;
  domain?: Domain;
}

export type Target = "raw" | "link";

/** A GPU input the compiled shader needs, with a pure function to fill it. */
export interface Binding {
  readonly id: string;
  readonly binding: number;
  readonly kind: "buffer" | "uniform";
  readonly wgslType: string;
  /** Name of the WGSL accessor for this input (`@link fn` in the link target). */
  readonly accessor: string;
  /** buffer: fill(data) -> Float32Array; uniform: fill({ t }) -> Float32Array. */
  readonly fill: (source: StructureData | { t?: number }) => Float32Array;
  /** For a `volume:<n>` buffer: the volume whose samples fill it. */
  readonly volume?: VolumeData;
}

export interface Compiled {
  readonly valueType: ValueType;
  /** 'any' when a broadcast field (constant/curve) is compiled without `options.domain`. */
  readonly domain: Domain | "any";
  readonly target: Target;
  /** Entry name: `evalField` (raw) or `getField` (link). */
  readonly entry: string;
  readonly bindings: readonly Binding[];
  /**
   * Self-contained WGSL. `raw` uses `@group(0)` bindings and a plain `evalField`;
   * `link` uses `@link fn` accessors (bound in `bindings` order) and `@export fn
   * getField`. No ShaderSource either way.
   */
  readonly wgsl: string;
}

// Identity-keyed annotation joins.

export interface ResidueIdentity {
  model: number;
  chainLabel: string;
  chainAuth: string;
  labelSeq: number;
  authSeq: string;
  insCode: string;
  comp: string;
}
export interface ChainIdentity {
  model: number;
  chainLabel: string;
  chainAuth: string;
}
export type IdentityField = keyof ResidueIdentity;

/** `R` is the caller's record shape (inferred from `records`). */
export interface JoinOptions<R = unknown> {
  /**
   * Domain the records key to. Defaults to 'residue'. `'chain'` requires
   * `lift: true` (annotations exist only on atom/residue domains).
   */
  domain?: "residue" | "chain";
  /** Identity fields to match on; must include a chain field. */
  fields: readonly IdentityField[];
  /** Extract a record's value; defaults to reading `record.value`. */
  value?: (record: R) => number | Color;
  type?: ValueType;
  policy?: "fallback" | "fail";
  fallback?: number | Color;
  duplicate?: "error" | "first" | "last";
  /** Lift a residue/chain annotation onto atoms. Defaults to true. */
  lift?: boolean;
}
