// Residue classification tables shared by the BCIF and PQR readers.
type PolymerKind = "protein" | "rna" | "dna" | "other";

// Chemical-component name sets ported from Mol* 5.11.0's MIT-licensed
// mol-model/structure/model/types.js (AminoAcidNamesL/D, RnaBaseNames,
// DnaBaseNames), used to classify each residue by its `comp` (label_comp_id)
// so trace/cartoon consumers can pick guide atoms without re-deriving this.
export const AMINO_ACID_NAMES = new Set([
  "HIS",
  "ARG",
  "LYS",
  "ILE",
  "PHE",
  "LEU",
  "TRP",
  "ALA",
  "MET",
  "PRO",
  "CYS",
  "ASN",
  "VAL",
  "GLY",
  "SER",
  "GLN",
  "TYR",
  "ASP",
  "GLU",
  "THR",
  "SEC",
  "PYL",
  "UNK",
  "MSE",
  "SEP",
  "TPO",
  "PTR",
  "PCA",
  "HYP",
  "HSD",
  "HSE",
  "HSP",
  "LSN",
  "ASPP",
  "GLUP",
  "HID",
  "HIE",
  "HIP",
  "LYN",
  "ASH",
  "GLH",
  "DAL",
  "DAR",
  "DSG",
  "DAS",
  "DCY",
  "DGL",
  "DGN",
  "DHI",
  "DIL",
  "DLE",
  "DLY",
  "MED",
  "DPN",
  "DPR",
  "DSN",
  "DTH",
  "DTR",
  "DTY",
  "DVA",
  "DNE",
]);
const RNA_BASE_NAMES = new Set(["A", "C", "T", "G", "I", "U", "N"]);
const DNA_BASE_NAMES = new Set(["DA", "DC", "DT", "DG", "DI", "DU", "DN"]);
export const polymerKind = (comp: string): PolymerKind => {
  const name = comp.toUpperCase();
  if (AMINO_ACID_NAMES.has(name)) return "protein";
  if (RNA_BASE_NAMES.has(name)) return "rna";
  if (DNA_BASE_NAMES.has(name)) return "dna";
  return "other";
};
