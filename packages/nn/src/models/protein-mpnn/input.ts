// ProteinMPNN's input: N, CA, C and O of each protein residue with a complete
// backbone, plus residue index, chain and native sequence. Read from any
// structure with molgpu's topology layout, typed structurally so this package
// stays free of a @molgpu/table dependency.

/** ProteinMPNN's 21-letter alphabet; index 20 (X) is unknown. */
export const PROTEIN_MPNN_ALPHABET = "ACDEFGHIKLMNPQRSTVWYX";

const ONE_LETTER: Readonly<Record<string, string>> = {
  ALA: "A",
  CYS: "C",
  ASP: "D",
  GLU: "E",
  PHE: "F",
  GLY: "G",
  HIS: "H",
  ILE: "I",
  LYS: "K",
  LEU: "L",
  MET: "M",
  MSE: "M",
  ASN: "N",
  PRO: "P",
  GLN: "Q",
  ARG: "R",
  SER: "S",
  THR: "T",
  VAL: "V",
  TRP: "W",
  TYR: "Y",
};
const BACKBONE = ["N", "CA", "C", "O"];

/** Backbone arrays for L residues, in structure order. */
export interface ProteinMpnnInput {
  /** [L, 4, 3] coordinates of N, CA, C, O in Å. */
  readonly backbone: Float32Array;
  /** Position along the chain; only differences within one chain matter. */
  readonly residueIndex: Int32Array;
  /** Chain label per residue; residues with equal labels share a chain. */
  readonly chain: Int32Array;
  /** Native amino acid per residue as an index into `PROTEIN_MPNN_ALPHABET`. */
  readonly sequence: Uint8Array;
  /** Source residue row of each model position. */
  readonly residues: Uint32Array;
}

/** The structure columns `proteinMpnnInput` reads (molgpu's `StructureData` fits). */
export interface BackboneSource {
  readonly positions: ArrayLike<number>;
  readonly topology: {
    readonly atoms: {
      readonly count: number;
      readonly name: readonly string[];
      readonly residue: ArrayLike<number>;
    };
    readonly residues: {
      readonly count: number;
      readonly chain: ArrayLike<number>;
      readonly labelSeq: ArrayLike<number>;
      readonly comp: readonly string[];
      readonly polymer: readonly string[];
    };
    readonly chains: { readonly model: ArrayLike<number> };
  };
}

/**
 * Protein residues of the first model that have all of N, CA, C and O (the
 * first atom of each name wins, so the first alternate location is used).
 * MSE reads as M and other non-standard residues as X.
 */
export function proteinMpnnInput(structure: BackboneSource): ProteinMpnnInput {
  const { atoms, residues, chains } = structure.topology;
  const slots = new Int32Array(residues.count * 4).fill(-1);
  for (let atom = 0; atom < atoms.count; atom++) {
    const slot = BACKBONE.indexOf(atoms.name[atom]);
    const at = 4 * atoms.residue[atom] + slot;
    if (slot >= 0 && slots[at] < 0) slots[at] = atom;
  }
  let firstModel: number | undefined;
  const kept: number[] = [];
  for (let r = 0; r < residues.count; r++) {
    if (residues.polymer[r] !== "protein") continue;
    const model = chains.model[residues.chain[r]];
    firstModel ??= model;
    if (model !== firstModel) continue;
    if ([0, 1, 2, 3].every((s) => slots[4 * r + s] >= 0)) kept.push(r);
  }
  const length = kept.length;
  const backbone = new Float32Array(length * 12);
  const residueIndex = new Int32Array(length);
  const chain = new Int32Array(length);
  const sequence = new Uint8Array(length);
  kept.forEach((r, i) => {
    for (let s = 0; s < 4; s++) {
      const atom = slots[4 * r + s];
      for (let d = 0; d < 3; d++) {
        backbone[12 * i + 3 * s + d] = structure.positions[3 * atom + d];
      }
    }
    chain[i] = residues.chain[r];
    const seq = residues.labelSeq[r];
    residueIndex[i] = seq >= 0
      ? seq
      : i > 0 && chain[i - 1] === chain[i]
      ? residueIndex[i - 1] + 1
      : 0;
    const letter = ONE_LETTER[residues.comp[r]] ?? "X";
    sequence[i] = PROTEIN_MPNN_ALPHABET.indexOf(letter);
  });
  return {
    backbone,
    residueIndex,
    chain,
    sequence,
    residues: Uint32Array.from(kept),
  };
}
