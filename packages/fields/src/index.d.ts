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
export function attribute(name: 'element' | 'occupancy' | 'bfactor' | 'radius' | 'residue' | 'labelSeq' | 'chain'): Field;
export function categorical(input: Field, cases: Record<number, number | Color>, fallback: number | Color): Field;
export function linear(input: Field, options: { domain: readonly [number, number]; range?: readonly [number, number]; overflow?: Overflow }): Field;
export function colormap(input: Field, stops: ReadonlyArray<readonly [number, Color]>): Field;
export function annotation(domain: Domain, type: ValueType, values: ArrayLike<number>, options?: { missing?: ArrayLike<number> | null; policy?: 'fallback' | 'fail'; fallback?: number | Color }): Field;
export function curve(stops: ReadonlyArray<readonly [number, number]>, options?: { overflow?: 'clamp' | 'wrap' }): Field;

export interface EvalContext { t?: number; domain?: Domain; }
/** Numeric fields return a packed Float32Array; string fields return strings. */
export function evaluate(field: Field, data: StructureData, ctx?: EvalContext): Float32Array | string[];

/** A GPU input the compiled shader needs, with a pure function to fill it. */
export interface Binding {
  readonly id: string;
  readonly binding: number;
  readonly kind: 'buffer' | 'uniform';
  readonly wgslType: string;
  /** buffer: fill(data) -> Float32Array; uniform: fill({ t }) -> Float32Array. */
  readonly fill: (source: StructureData | { t?: number }) => Float32Array;
}

export interface Compiled {
  readonly valueType: ValueType;
  readonly domain: Domain;
  readonly bindings: readonly Binding[];
  /** Self-contained WGSL exposing `fn evalField(row: u32) -> <type>`. No ShaderSource. */
  readonly wgsl: string;
}
export function compile(field: Field, options?: { domain?: Domain }): Compiled;

export function fieldDomain(field: Field): Domain | 'any';
