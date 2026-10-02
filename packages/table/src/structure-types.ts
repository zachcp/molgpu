// Molecular topology, structure revisions, and derived per-atom/per-residue columns.
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
 * Unlike `bonds` they add to inferred connectivity instead of replacing it,
 * and renderers do not draw them; selections read them (bond types, metal and
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
/** `topology` marks a built-in view of a topology column. */
export type AttributeProvenance =
  | "topology"
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
export interface BondPolicy {
  readonly padding?: number;
  readonly interChain?: boolean;
}
