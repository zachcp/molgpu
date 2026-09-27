// Public data types for @molgpu/table. Columns are owned, read-only by contract.
/** Owned CPU columns, read-only by contract. Never modify typed arrays in place. */
export interface Atoms {
  readonly count: number;
  readonly id: readonly string[];
  readonly name: readonly string[];
  readonly altloc: readonly string[];
  readonly residue: Uint32Array;
  /** Atomic number; 0 denotes unknown. */
  readonly element: Uint8Array;
  readonly occupancy: Float32Array;
  readonly bfactor: Float32Array;
  readonly radius?: Float32Array;
  /** Per-atom chemical component, present only when some residue mixes components (microheterogeneity); residues.comp is then the residue's first atom's. */
  readonly comp?: readonly string[];
  /**
   * Formal charge on hand-built structures; resolves as `formalCharge` with
   * provenance `legacy`. @deprecated Set the derived `formalCharge` attribute
   * with `withAttributes`; `@molgpu/io` no longer writes this column.
   */
  readonly formalCharge?: Int8Array;
}
export interface Residues {
  readonly count: number;
  readonly chain: Uint32Array;
  /** -1 denotes missing label_seq_id. */
  readonly labelSeq: Int32Array;
  readonly authSeq: readonly string[];
  readonly insertionCode: readonly string[];
  readonly comp: readonly string[];
  readonly polymer: readonly ("protein" | "rna" | "dna" | "other")[];
  /**
   * 3-state secondary structure on hand-built structures; resolves as `ssCode`
   * (helix H, sheet E) with provenance `legacy`. @deprecated Set the derived
   * `ssCode` attribute with `withAttributes`; `@molgpu/io` no longer writes
   * this column.
   */
  readonly secondaryStructure?: readonly ("helix" | "sheet" | "coil")[];
  /** 1 when the residue's first atom is not a group_PDB ATOM record (a HETATM). Absent when the source has no group_PDB. */
  readonly het?: Uint8Array;
}
export interface Chains {
  readonly count: number;
  readonly model: Int32Array;
  readonly labelId: readonly string[];
  readonly authId: readonly string[];
  /** mmCIF label_entity_id. Absent when the source has none. */
  readonly entityId?: readonly string[];
  /** mmCIF _entity.type of the chain's entity, lower-cased ("polymer", "non-polymer", "water", "branched", ...); "" when unlisted. Absent with entityId. */
  readonly entityType?: readonly string[];
  /** Entity subtype as Mol* assigns it (entity_poly / pdbx_entity_branch type, else derived from the component: "polypeptide(L)", "oligosaccharide", "other", ...). Absent with entityId. */
  readonly entitySubtype?: readonly string[];
}
export interface Bonds {
  readonly count: number;
  readonly a: Uint32Array;
  readonly b: Uint32Array;
  /** 0 unknown, 1/2/3 multiplicity, 4 aromatic. */
  readonly order: Uint8Array;
  readonly source: readonly ("explicit" | "inferred")[];
  /** Bond type bits (see `BOND_FLAGS`); 0 is unknown. Inferred bonds are covalent | computed. */
  readonly flags?: Uint8Array;
}
/**
 * Bonds the source declares in its chemistry annotations (mmCIF chem_comp_bond
 * templates applied to residues, and struct_conn records), with type flags.
 * Unlike `bonds` they add to inferred connectivity instead of replacing it, and
 * renderers do not draw them; selections read them (bond types, metal and
 * hydrogen-bond links).
 */
export interface Links {
  readonly count: number;
  readonly a: Uint32Array;
  readonly b: Uint32Array;
  /** 0 unknown, 1/2/3/4 multiplicity. */
  readonly order: Uint8Array;
  /** Bond type bits (see `BOND_FLAGS`); 0 is unknown. */
  readonly flags: Uint8Array;
  /** Where the link came from: a chem_comp_bond template, or a struct_conn record. */
  readonly source: readonly ("component" | "struct_conn")[];
}
/** A row expands one chain with one column-major affine assembly operator. */
export interface Instances {
  readonly count: number;
  readonly chain: Uint32Array;
  readonly operatorId: readonly string[];
  readonly transform: Float64Array;
}
export interface Topology {
  readonly atoms: Atoms;
  readonly residues: Residues;
  readonly chains: Chains;
  readonly bonds: Bonds;
  readonly instances: Instances;
  readonly links?: Links;
}
export interface StructureInput {
  readonly topology: Topology;
  readonly positions: Float32Array;
}
export type AttributeDomain = "atom" | "residue";
export type AttributeValues =
  | Float32Array
  | Int8Array
  | Uint8Array
  | Int32Array
  | Uint32Array;
export type AttributeProvenance =
  | "legacy"
  | "default"
  | "user"
  | `imported:${string}`
  | `template:${string}`
  | `computed:${string}`
  | `gpu:${string}`;
export interface AttributeColumnInput {
  readonly domain: AttributeDomain;
  readonly values: AttributeValues;
  readonly provenance: AttributeProvenance;
  readonly kind: "scalar" | "code";
}
export interface AttributeColumn extends AttributeColumnInput {
  readonly name: string;
}
/** Private nominal brand for dataset identity; deliberately not exported. */
declare const brand: unique symbol;
export interface StructureData extends StructureInput {
  readonly identity: { readonly [brand]: true };
  readonly attributes?: Readonly<Record<string, AttributeColumn>>;
  readonly revision: {
    readonly topology: number;
    readonly positions: number;
    readonly attributes: number;
  };
}
export interface ViewPolicy {
  readonly model?: "first" | "all" | number;
  readonly altloc?: "primary" | "all";
}
export interface BondPolicy {
  readonly padding?: number;
  readonly interChain?: boolean;
}
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

/** One decoded trajectory frame. Immutable by contract; sources may share it. */
export interface TrajectoryFrame {
  /** x, y, z per trajectory atom in Å, in trajectory atom order. */
  readonly positions: Float32Array;
  /** Column-major 3×3 box vectors in Å (a, b, c as columns); absent if none. */
  readonly box?: Float32Array;
  /** Å/ps in the layout of `positions`; only when a reader was asked for them. */
  readonly velocities?: Float32Array;
}
/** Decodes frames on demand, so a trajectory never has to fit in memory. */
export interface FrameSource {
  /** Decode frame `index`. Rejects with an `AbortError` when `signal` aborts. */
  read(index: number, signal?: AbortSignal): Promise<TrajectoryFrame>;
}
/**
 * Time axis of a trajectory: picoseconds, integrator steps, or plain frame
 * indices when the source records no time (NMR models).
 */
export type TrajectoryTimeUnit = "ps" | "step" | "index";
/** Input to `createTrajectory`: in-memory `frames`, or a `source` and `frameCount`. */
export interface TrajectoryInput {
  readonly atomCount: number;
  readonly frames?: readonly TrajectoryFrame[];
  readonly source?: FrameSource;
  readonly frameCount?: number;
  /** Per-frame time, nondecreasing. Default: the frame index, unit "index". */
  readonly time?: ArrayLike<number>;
  readonly timeUnit?: TrajectoryTimeUnit;
  /** Topology row of each trajectory atom, for trajectories over a subset. */
  readonly atomMap?: ArrayLike<number>;
}
/** A validated, immutable trajectory: coordinates only; topology is the structure's. */
export interface TrajectoryData {
  /** Atoms per frame. */
  readonly atomCount: number;
  readonly frameCount: number;
  readonly time: Float64Array;
  readonly timeUnit: TrajectoryTimeUnit;
  /** Trajectory atom `i` moves topology row `atomMap[i]`; other rows keep upstream coordinates. */
  readonly atomMap?: Uint32Array;
  readonly source: FrameSource;
}
