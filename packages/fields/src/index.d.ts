import type { StructureData } from '@molgpu/table';

export type Domain = 'atom' | 'residue';
export type Overflow = 'clamp' | 'wrap' | 'fail';

export interface ValueType { readonly kind: 'scalar' | 'color' | 'string'; readonly components: number; readonly wgsl: string | null; }
export const SCALAR: ValueType;
export const COLOR: ValueType;
export const STRING: ValueType;

/** A typed per-row value description. Opaque: build with the constructors. */
export interface Field {
  readonly kind: string;
  readonly type: ValueType;
  /** 'atom' | 'residue', or 'any' for a broadcast constant/curve. */
  readonly domain: Domain | 'any';
}

export type Scalar = number;
export type Color = readonly [number, number, number, number];

export function constant(value: number | string | Color): Field;
/**
 * `atomChain` is a derived per-atom chain index (atom -> residue -> chain);
 * `labelSeq` and `chain` live on the residue domain, the rest on atoms.
 */
export function attribute(name: 'element' | 'occupancy' | 'bfactor' | 'radius' | 'residue' | 'atomChain' | 'labelSeq' | 'chain'): Field;
export function categorical(input: Field, cases: Record<number, number | Color>, fallback: number | Color): Field;
export function linear(input: Field, options: { domain: readonly [number, number]; range?: readonly [number, number]; overflow?: Overflow }): Field;
export function colormap(input: Field, stops: ReadonlyArray<readonly [number, Color]>): Field;
export function annotation(domain: Domain, type: ValueType, values: ArrayLike<number>, options?: { missing?: ArrayLike<number> | null; policy?: 'fallback' | 'fail'; fallback?: number | Color }): Field;
export function curve(stops: ReadonlyArray<readonly [number, number]>, options?: { overflow?: 'clamp' | 'wrap' }): Field;

export interface EvalContext { t?: number; domain?: Domain; }
/** Numeric fields return a packed Float32Array; string fields return strings. */
export function evaluate(field: Field, data: StructureData, ctx?: EvalContext): Float32Array | string[];

export type Target = 'raw' | 'link';

/** A GPU input the compiled shader needs, with a pure function to fill it. */
export interface Binding {
  readonly id: string;
  readonly binding: number;
  readonly kind: 'buffer' | 'uniform';
  readonly wgslType: string;
  /** Name of the WGSL accessor for this input (`@link fn` in the link target). */
  readonly accessor: string;
  /** buffer: fill(data) -> Float32Array; uniform: fill({ t }) -> Float32Array. */
  readonly fill: (source: StructureData | { t?: number }) => Float32Array;
}

export interface Compiled {
  readonly valueType: ValueType;
  /** 'any' when a broadcast field (constant/curve) is compiled without `options.domain`. */
  readonly domain: Domain | 'any';
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
export function compile(field: Field, options?: { domain?: Domain; target?: Target }): Compiled;

/**
 * Min/max of an attribute column (any name `attribute` accepts) over a dataset,
 * for auto-ranging a domain. Returns [0, 1] for an empty column and [v, v+1]
 * for a constant one; throws on an unknown column.
 */
export function columnRange(data: StructureData, name: string): [number, number];

// Built-in colour presets (a closed set) composed from the primitives.
/** CPK colour by element; unlisted elements take `fallback`. */
export function byElement(fallback?: Color): Field;
/** B-factor on a cool-to-warm ramp over `domain` (default [0, 100]). */
export function byBfactor(options?: { domain?: readonly [number, number]; stops?: ReadonlyArray<readonly [number, Color]> }): Field;
/** Residue index on a rainbow ramp over `domain` (default [0, 1]; pass `columnRange(data, 'residue')`). */
export function bySeq(options?: { domain?: readonly [number, number]; stops?: ReadonlyArray<readonly [number, Color]> }): Field;
/** Chain index from a cyclic `palette`; chains beyond it take `fallback`. */
export function byChain(options?: { palette?: ReadonlyArray<Color>; fallback?: Color }): Field;

// ---- identity-keyed annotation joins --------------------------------------

export interface ResidueIdentity {
  model: number; chainLabel: string; chainAuth: string;
  labelSeq: number; authSeq: string; insCode: string; comp: string;
}
export interface ChainIdentity { model: number; chainLabel: string; chainAuth: string; }
export type IdentityField = keyof ResidueIdentity;

export function residueIdentity(data: StructureData, row: number): ResidueIdentity;
export function chainIdentity(data: StructureData, row: number): ChainIdentity;

/** `R` is the caller's record shape (inferred from `records`). */
export interface JoinOptions<R = unknown> {
  /**
   * Domain the records key to. Defaults to 'residue'. `'chain'` requires
   * `lift: true` (annotations exist only on atom/residue domains).
   */
  domain?: 'residue' | 'chain';
  /** Identity fields to match on; must include a chain field. */
  fields: readonly IdentityField[];
  /** Extract a record's value; defaults to reading `record.value`. */
  value?: (record: R) => number | Color;
  type?: ValueType;
  policy?: 'fallback' | 'fail';
  fallback?: number | Color;
  duplicate?: 'error' | 'first' | 'last';
  /** Lift a residue/chain annotation onto atoms. Defaults to true. */
  lift?: boolean;
}

/**
 * Join external records onto the table by identity and return an annotation
 * Field. Each record carries the identity fields named in `options.fields` plus
 * a value (see `JoinOptions.value`).
 */
export function joinAnnotation<R>(data: StructureData, records: readonly R[], options: JoinOptions<R>): Field;
