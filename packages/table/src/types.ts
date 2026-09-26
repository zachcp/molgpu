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
  /** mmCIF pdbx_formal_charge; a missing value reads 0. Absent when the source has no charges. */
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
  /** Imported annotation (mmCIF struct_conf/struct_sheet_range) when the source provided one; absent otherwise. */
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
/** Private nominal brand for dataset identity; deliberately not exported. */
declare const brand: unique symbol;
export interface StructureData extends StructureInput {
  readonly identity: { readonly [brand]: true };
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
