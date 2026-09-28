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
