// Public types for @molgpu/fields. Fields are opaque: build them with the constructors.
import type { StructureData, VolumeData } from "@molgpu/table";

/** Atom or residue row domain for a field. */
export type Domain = "atom" | "residue";
export type Overflow = "clamp" | "wrap" | "fail";

/** Scalar, RGBA colour or string layout; `wgsl` is null for CPU-only labels. */
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

/** RGBA tuple; conventionally each component is in the range 0–1. */
export type Color = readonly [number, number, number, number];

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

// Identity-keyed annotation joins.

/** Model, chain and residue identifiers available for annotation joins. */
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
/** One identity key accepted by `joinAnnotation`. */
export type IdentityField = keyof ResidueIdentity;
