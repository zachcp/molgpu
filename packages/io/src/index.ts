import {
  createStructure,
  elementRadius,
  type StructureData,
} from "@molgpu/table";
import type {
  BcifErrorCode,
  SurfaceField,
  SurfaceFieldAtoms,
  SurfaceFieldErrorCode,
  SurfaceFieldOptions,
} from "./types.ts";

export type * from "./types.ts";
export {
  parseSelection,
  type ParseSelectionOptions,
  type SelectionExpr,
  type SelectionLanguage,
  SelectionParseError,
} from "./selection.ts";

/** The slice of a Mol* CIF category this module reads. */
interface CifCategory {
  readonly rowCount: number;
  getField(
    name: string,
  ): { str(row: number): string; float(row: number): number } | undefined;
}
type Categories = Readonly<Record<string, CifCategory | undefined>>;
type PolymerKind = "protein" | "rna" | "dna" | "other";
type SecondaryStructure = "helix" | "sheet" | "coil";
interface ResidueRow {
  chain: number;
  seq: number;
  authSeq: string;
  insertion: string;
  comp: string;
  het: number;
}
interface ChainRow {
  model: number;
  entityId: string;
  labelId: string;
  authId: string;
}

// Upper-cased mmCIF type_symbol -> atomic number, ported from Mol* 5.11.0's
// MIT-licensed AtomicNumbers (mol-model/structure/model/properties/atomic/
// measures.js); D and T are hydrogen. Unlisted symbols read 0 (unknown).
const ELEMENT: Readonly<Record<string, number>> = {
  H: 1,
  D: 1,
  T: 1,
  HE: 2,
  LI: 3,
  BE: 4,
  B: 5,
  C: 6,
  N: 7,
  O: 8,
  F: 9,
  NE: 10,
  NA: 11,
  MG: 12,
  AL: 13,
  SI: 14,
  P: 15,
  S: 16,
  CL: 17,
  AR: 18,
  K: 19,
  CA: 20,
  SC: 21,
  TI: 22,
  V: 23,
  CR: 24,
  MN: 25,
  FE: 26,
  CO: 27,
  NI: 28,
  CU: 29,
  ZN: 30,
  GA: 31,
  GE: 32,
  AS: 33,
  SE: 34,
  BR: 35,
  KR: 36,
  RB: 37,
  SR: 38,
  Y: 39,
  ZR: 40,
  NB: 41,
  MO: 42,
  TC: 43,
  RU: 44,
  RH: 45,
  PD: 46,
  AG: 47,
  CD: 48,
  IN: 49,
  SN: 50,
  SB: 51,
  TE: 52,
  I: 53,
  XE: 54,
  CS: 55,
  BA: 56,
  LA: 57,
  CE: 58,
  PR: 59,
  ND: 60,
  PM: 61,
  SM: 62,
  EU: 63,
  GD: 64,
  TB: 65,
  DY: 66,
  HO: 67,
  ER: 68,
  TM: 69,
  YB: 70,
  LU: 71,
  HF: 72,
  TA: 73,
  W: 74,
  RE: 75,
  OS: 76,
  IR: 77,
  PT: 78,
  AU: 79,
  HG: 80,
  TL: 81,
  PB: 82,
  BI: 83,
  PO: 84,
  AT: 85,
  RN: 86,
  FR: 87,
  RA: 88,
  AC: 89,
  TH: 90,
  PA: 91,
  U: 92,
  NP: 93,
  PU: 94,
  AM: 95,
  CM: 96,
  BK: 97,
  CF: 98,
  ES: 99,
  FM: 100,
  MD: 101,
  NO: 102,
  LR: 103,
  RF: 104,
  DB: 105,
  SG: 106,
  BH: 107,
  HS: 108,
  MT: 109,
};

// Chemical-component name sets ported from Mol* 5.11.0's MIT-licensed
// mol-model/structure/model/types.js (AminoAcidNamesL/D, RnaBaseNames,
// DnaBaseNames), used to classify each residue by its `comp` (label_comp_id)
// so trace/cartoon consumers can pick guide atoms without re-deriving this.
const AMINO_ACID_NAMES = new Set([
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
const polymerKind = (comp: string): PolymerKind => {
  const name = comp.toUpperCase();
  if (AMINO_ACID_NAMES.has(name)) return "protein";
  if (RNA_BASE_NAMES.has(name)) return "rna";
  if (DNA_BASE_NAMES.has(name)) return "dna";
  return "other";
};
const clean = (value: string): string =>
  value === "." || value === "?" ? "" : value;
const field = (category: CifCategory, name: string) => category.getField(name);
const str = (
  category: CifCategory,
  name: string,
  row: number,
  fallback = "",
): string => clean(field(category, name)?.str(row) ?? fallback);
const num = (
  category: CifCategory,
  name: string,
  row: number,
  fallback = 0,
): number => field(category, name)?.float(row) ?? fallback;

/** A machine-readable failure at the BCIF/Mol* import boundary. */
export class BcifParseError extends Error {
  override readonly name: "BcifParseError";
  readonly code: BcifErrorCode;
  constructor(message: string, code: BcifErrorCode, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BcifParseError";
    this.code = code;
  }
}

async function parseBcif(
  bytes: Uint8Array,
): Promise<{ blocks: readonly { categories: Categories }[] }> {
  if (!(bytes instanceof Uint8Array)) {
    throw new BcifParseError(
      "BCIF input must be a Uint8Array",
      "INVALID_INPUT",
    );
  }
  try {
    // Keep the sole Mol* dependency behind the call boundary: consumers that
    // only use @molgpu/table never load this parser or its transitive chunks.
    const { CIF } = await import("molstar/lib/mol-io/reader/cif.js");
    const parsed = await CIF.parseBinary(bytes).run();
    if (parsed.isError) {
      throw new BcifParseError(parsed.message, "INVALID_BCIF");
    }
    return parsed.result as unknown as {
      blocks: readonly { categories: Categories }[];
    };
  } catch (error) {
    if (error instanceof BcifParseError) throw error;
    throw new BcifParseError(
      "Unable to load the optional Mol* BCIF parser",
      "PARSER_UNAVAILABLE",
      error,
    );
  }
}

/** A machine-readable failure computing a molecular surface scalar field. */
export class SurfaceFieldError extends Error {
  override readonly name: "SurfaceFieldError";
  readonly code: SurfaceFieldErrorCode;
  constructor(message: string, code: SurfaceFieldErrorCode, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SurfaceFieldError";
    this.code = code;
  }
}

/**
 * Solvent-excluded-surface scalar field over a set of atoms, via Mol*'s
 * calcMolecularSurface — kept behind this runtime import boundary exactly
 * like parseBcif, so consumers of @molgpu/table/@molgpu/geo alone never
 * load it. `atoms` is plain owned columns (x/y/z/radius Float32Array[count]),
 * never a Mol* Structure/Unit. `values` is x-fastest
 * (values[i + nx * (j + ny * k)]), the layout @molgpu/geo's marchingCubes
 * reads, so the field feeds it directly.
 * `transform` is a column-major scale+translate Mat4 — read its diagonal as
 * `spacing` and its translation row as `origin` — and `level` is the isovalue
 * (the solvent-excluded-surface convention: the probe radius itself).
 */
export async function molecularSurfaceField(
  atoms: SurfaceFieldAtoms,
  options: SurfaceFieldOptions = {},
): Promise<SurfaceField> {
  const { probeRadius = 1.4, resolution = 0.5, probePositions = 36 } = options;
  const { x, y, z, radius, count } = atoms;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new SurfaceFieldError(
      "atoms.count must be a nonnegative safe integer",
      "INVALID_INPUT",
    );
  }
  if (
    ![x, y, z, radius].every((a) =>
      a instanceof Float32Array && a.length === count
    )
  ) {
    throw new SurfaceFieldError(
      "atoms.x/y/z/radius must each be a Float32Array[count]",
      "INVALID_INPUT",
    );
  }
  if (count === 0) {
    throw new SurfaceFieldError(
      "atoms must contain at least one atom",
      "EMPTY_INPUT",
    );
  }
  try {
    const [{ calcMolecularSurface }, { getFastBoundary }, { OrderedSet }] =
      await Promise.all([
        import("molstar/lib/mol-math/geometry/molecular-surface.js"),
        import("molstar/lib/mol-math/geometry/boundary.js"),
        import("molstar/lib/mol-data/int/ordered-set.js"),
      ]);
    const id = Uint32Array.from({ length: count }, (_, i) => i);
    const indices = OrderedSet.ofBounds(0, count);
    // The boundary is computed from the plain van der Waals radii; maxRadius
    // is their max, unmodified. calcMolecularSurface itself, though, expects
    // each atom's SEARCH radius to already include the probe — Mol*'s own
    // callers (mol-repr/.../util/molecular-surface.js) build exactly this
    // `r + probeRadius` array before calling it. Skipping that (as an
    // earlier version of this function, and the s3 spike, both did) starves
    // the internal neighbor search near convex/protruding regions, so the
    // "unvisited" (-1001 sentinel) region reaches much closer to the true
    // isosurface than expected — producing a sparse, fragmented mesh instead
    // of a closed surface, not a marching-cubes artifact.
    const boundary = getFastBoundary({ x, y, z, radius, id, indices });
    let maxRadius = 0;
    const searchRadius = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      if (radius[i] > maxRadius) maxRadius = radius[i];
      searchRadius[i] = radius[i] + probeRadius;
    }
    const position = { x, y, z, id, indices, radius: searchRadius };
    // calcMolecularSurface only ever touches ctx.shouldUpdate/ctx.update; a
    // stub stands in for mol-task's RuntimeContext (a type-only import, erased at runtime).
    const stubContext = { shouldUpdate: false, update: async () => {} };
    const result = await calcMolecularSurface(
      stubContext as unknown as Parameters<typeof calcMolecularSurface>[0],
      position,
      boundary,
      maxRadius,
      null,
      { probeRadius, resolution, probePositions },
    );
    // Mol*'s tensor stores the grid in its own axis order (z fastest). Lower
    // it to the x-fastest layout @molgpu/geo's marchingCubes reads, reading
    // through space.get so this stays correct whatever Mol*'s order is.
    const { space, data } = result.field;
    const [nx, ny, nz] = space.dimensions as unknown as [
      number,
      number,
      number,
    ];
    const values = new Float32Array(nx * ny * nz);
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          values[i + nx * (j + ny * k)] = space.get(data, i, j, k);
        }
      }
    }
    return {
      values,
      dims: [nx, ny, nz],
      transform: Float32Array.from(result.transform),
      resolution: result.resolution,
      maxRadius: result.maxRadius,
      level: probeRadius,
    };
  } catch (error) {
    if (error instanceof SurfaceFieldError) throw error;
    throw new SurfaceFieldError(
      "Unable to compute the molecular surface field",
      "FIELD_UNAVAILABLE",
      error,
    );
  }
}

/**
 * Mark residues [begSeq, endSeq] on chain `chainLabel` with `kind`, by
 * label_seq_id (the compact, gap-aware numbering already used for
 * residues.labelSeq — no auth/insertion-code ambiguity to resolve here).
 */
function markSecondaryStructure(
  secondaryStructure: SecondaryStructure[],
  residues: readonly ResidueRow[],
  chains: readonly ChainRow[],
  chainLabel: string,
  begSeq: number,
  endSeq: number,
  kind: SecondaryStructure,
): void {
  for (let r = 0; r < residues.length; r++) {
    if (chains[residues[r].chain].labelId !== chainLabel) continue;
    if (residues[r].seq < begSeq || residues[r].seq > endSeq) continue;
    secondaryStructure[r] = kind;
  }
}

/**
 * Imported secondary-structure annotation from mmCIF struct_conf (helices)
 * and struct_sheet_range (beta strands), by label_seq_id range per chain.
 * Every residue defaults to 'coil': this project does not (yet) compute
 * secondary structure from geometry when a file carries no annotation —
 * see molgpu-sept-0sj.2's notes for that documented scope boundary.
 */
function readSecondaryStructure(
  categories: Categories,
  residues: readonly ResidueRow[],
  chains: readonly ChainRow[],
): SecondaryStructure[] {
  const secondaryStructure = new Array<SecondaryStructure>(residues.length)
    .fill("coil");
  const conf = categories.struct_conf;
  for (let i = 0; conf && i < conf.rowCount; i++) {
    if (!str(conf, "conf_type_id", i).toUpperCase().startsWith("HELX")) {
      continue;
    }
    markSecondaryStructure(
      secondaryStructure,
      residues,
      chains,
      str(conf, "beg_label_asym_id", i),
      Math.trunc(num(conf, "beg_label_seq_id", i, NaN)),
      Math.trunc(num(conf, "end_label_seq_id", i, NaN)),
      "helix",
    );
  }
  const sheet = categories.struct_sheet_range;
  for (let i = 0; sheet && i < sheet.rowCount; i++) {
    markSecondaryStructure(
      secondaryStructure,
      residues,
      chains,
      str(sheet, "beg_label_asym_id", i),
      Math.trunc(num(sheet, "beg_label_seq_id", i, NaN)),
      Math.trunc(num(sheet, "end_label_seq_id", i, NaN)),
      "sheet",
    );
  }
  return secondaryStructure;
}

/** Lower a BinaryCIF mmCIF block to renderer-independent owned table columns. */
export async function structureFromBcif(
  bytes: Uint8Array,
): Promise<StructureData> {
  const parsed = await parseBcif(bytes);
  const categories = parsed.blocks[0]?.categories ?? {};
  const atom = categories.atom_site;
  if (!atom) {
    throw new BcifParseError(
      "BCIF has no atom_site category",
      "MISSING_ATOM_SITE",
    );
  }
  const positions = new Float32Array(atom.rowCount * 3),
    ids: string[] = [],
    names: string[] = [],
    altloc: string[] = [],
    element = new Uint8Array(atom.rowCount);
  const occupancy = new Float32Array(atom.rowCount),
    bfactor = new Float32Array(atom.rowCount),
    radius = new Float32Array(atom.rowCount),
    formalCharge = new Int8Array(atom.rowCount),
    atomResidue = new Uint32Array(atom.rowCount);
  // Optional columns are only emitted when the file carries their source field.
  const hasCharge = !!field(atom, "pdbx_formal_charge"),
    hasGroup = !!field(atom, "group_PDB"),
    hasEntity = !!field(atom, "label_entity_id");
  const residueRows = new Map<string, number>(),
    residues: ResidueRow[] = [],
    chainRows = new Map<string, number>(),
    chains: ChainRow[] = [];
  for (let i = 0; i < atom.rowCount; i++) {
    const model = Math.trunc(num(atom, "pdbx_PDB_model_num", i, 1));
    const chainId = str(atom, "label_asym_id", i, "");
    const chainKey = `${model}:${chainId}`;
    let chain = chainRows.get(chainKey);
    if (chain === undefined) {
      chain = chains.length;
      chainRows.set(chainKey, chain);
      chains.push({
        model,
        entityId: str(atom, "label_entity_id", i, ""),
        labelId: chainId,
        authId: str(atom, "auth_asym_id", i, chainId),
      });
    }
    const seq = Math.trunc(num(atom, "label_seq_id", i, -1)),
      comp = str(atom, "label_comp_id", i, "UNK");
    // label_seq_id is intentionally absent for non-polymer entities. Include
    // author numbering so consecutive waters and ligands remain distinct rows.
    const authSeq = str(atom, "auth_seq_id", i, String(seq));
    const residueKey = `${chain}:${seq}:${authSeq}:${
      str(atom, "pdbx_PDB_ins_code", i)
    }:${comp}`;
    let residue = residueRows.get(residueKey);
    if (residue === undefined) {
      residue = residues.length;
      residueRows.set(residueKey, residue);
      residues.push({
        chain,
        seq,
        authSeq,
        insertion: str(atom, "pdbx_PDB_ins_code", i),
        comp,
        // Mol* reads is-het from the residue's first atom record.
        het: str(atom, "group_PDB", i) === "ATOM" ? 0 : 1,
      });
    }
    atomResidue[i] = residue;
    ids.push(str(atom, "id", i, String(i + 1)));
    names.push(str(atom, "label_atom_id", i, ""));
    altloc.push(str(atom, "label_alt_id", i));
    const atomic = ELEMENT[str(atom, "type_symbol", i).toUpperCase()] ?? 0;
    element[i] = atomic;
    radius[i] = elementRadius(atomic);
    positions[i * 3] = num(atom, "Cartn_x", i);
    positions[i * 3 + 1] = num(atom, "Cartn_y", i);
    positions[i * 3 + 2] = num(atom, "Cartn_z", i);
    occupancy[i] = num(atom, "occupancy", i, 1);
    bfactor[i] = num(atom, "B_iso_or_equiv", i, 0);
    formalCharge[i] = Math.trunc(num(atom, "pdbx_formal_charge", i, 0));
  }
  const residueCount = residues.length, chainCount = chains.length;
  const entityTypes = new Map<string, string>();
  const entity = categories.entity;
  for (let i = 0; entity && i < entity.rowCount; i++) {
    entityTypes.set(str(entity, "id", i), str(entity, "type", i).toLowerCase());
  }
  const secondaryStructure = readSecondaryStructure(
    categories,
    residues,
    chains,
  );
  return createStructure({
    positions,
    topology: {
      atoms: {
        count: atom.rowCount,
        id: ids,
        name: names,
        altloc,
        residue: atomResidue,
        element,
        occupancy,
        bfactor,
        radius,
        ...(hasCharge ? { formalCharge } : {}),
      },
      residues: {
        count: residueCount,
        chain: Uint32Array.from(residues, (r) => r.chain),
        labelSeq: Int32Array.from(residues, (r) => r.seq),
        authSeq: residues.map((r) => r.authSeq),
        insertionCode: residues.map((r) => r.insertion),
        comp: residues.map((r) => r.comp),
        polymer: residues.map((r) => polymerKind(r.comp)),
        secondaryStructure,
        ...(hasGroup ? { het: Uint8Array.from(residues, (r) => r.het) } : {}),
      },
      chains: {
        count: chainCount,
        model: Int32Array.from(chains, (c) => c.model),
        labelId: chains.map((c) => c.labelId),
        authId: chains.map((c) => c.authId),
        ...(hasEntity
          ? {
            entityId: chains.map((c) => c.entityId),
            entityType: chains.map((c) => entityTypes.get(c.entityId) ?? ""),
          }
          : {}),
      },
      bonds: {
        count: 0,
        a: new Uint32Array(),
        b: new Uint32Array(),
        order: new Uint8Array(),
        source: [],
      },
      instances: {
        count: chainCount,
        chain: Uint32Array.from({ length: chainCount }, (_, i) => i),
        operatorId: new Array(chainCount).fill("identity"),
        transform: Float64Array.from(
          { length: chainCount * 16 },
          (_, i) =>
            i % 16 === 0 || i % 16 === 5 || i % 16 === 10 || i % 16 === 15
              ? 1
              : 0,
        ),
      },
    },
  });
}
