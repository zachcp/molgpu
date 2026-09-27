import {
  BOND_FLAGS,
  createStructure,
  createVolume,
  elementRadius,
  type Links,
  type StructureData,
  withAttributes,
} from "@molgpu/table";
import type {
  BcifErrorCode,
  SurfaceField,
  SurfaceFieldAtoms,
  SurfaceFieldErrorCode,
  SurfaceFieldOptions,
} from "./types.ts";
import { ELEMENT, polymerKind } from "./residues.ts";

export type * from "./types.ts";
export { volumeFromCcp4, VolumeParseError } from "./ccp4.ts";
export { applyPqr, PqrParseError, structureFromPqr } from "./pqr.ts";
export {
  byteSource,
  MAX_FULL_DOWNLOAD,
  TrajectoryParseError,
  urlByteSource,
} from "./byte-source.ts";
export { AKMA_PS, trajectoryFromDcd } from "./dcd.ts";
export { trajectoryFromXtc } from "./xtc.ts";
export { trajectoryFromTrr } from "./trr.ts";
export { openTrajectory, trajectoryFormat } from "./trajectory.ts";
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
  ): {
    str(row: number): string;
    float(row: number): number;
    /** Mol* Column.ValueKind: 0 present, 1 not present ('.'), 2 unknown ('?'). */
    valueKind(row: number): number;
  } | undefined;
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
    // The caller (e.g. the viewer's grid budget) has already bounded the grid,
    // so the VolumeData default ceiling does not apply here.
    const volume = createVolume({
      values,
      dims: [nx, ny, nz],
      transform: Float32Array.from(result.transform),
    }, { maxSamples: Infinity });
    return Object.freeze({
      ...volume,
      resolution: result.resolution,
      maxRadius: result.maxRadius,
      level: probeRadius,
    });
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
/**
 * Source-declared bonds, typed the way Mol* types them
 * (mol-model-formats/structure/property/bonds): chem_comp_bond templates applied
 * to each residue's atoms (covalent, plus aromatic for pdbx_aromatic_flag Y or
 * order delo), and struct_conn records resolved by label_asym_id, auth_seq_id
 * (else label_seq_id), insertion code, atom name and altloc in the first model.
 */
function readLinks(
  categories: Categories,
  atoms: {
    readonly name: readonly string[];
    readonly altloc: readonly string[];
    readonly comp: readonly string[];
    readonly residue: Uint32Array;
  },
  residues: readonly ResidueRow[],
  chains: readonly ChainRow[],
): Links | undefined {
  const templates = categories.chem_comp_bond, conn = categories.struct_conn;
  if (!templates && !conn) return undefined;
  const a: number[] = [], b: number[] = [], order: number[] = [];
  const flags: number[] = [], source: ("component" | "struct_conn")[] = [];
  const add = (
    x: number,
    y: number,
    o: number,
    f: number,
    from: "component" | "struct_conn",
  ) => {
    a.push(x);
    b.push(y);
    order.push(o);
    flags.push(f);
    source.push(from);
  };
  const compatible = (x: number, y: number) =>
    !atoms.altloc[x] || !atoms.altloc[y] || atoms.altloc[x] === atoms.altloc[y];

  // Atoms of each residue by name.
  const byName = residues.map(() => new Map<string, number[]>());
  for (let i = 0; i < atoms.residue.length; i++) {
    const names = byName[atoms.residue[i]];
    const list = names.get(atoms.name[i]);
    if (list) list.push(i);
    else names.set(atoms.name[i], [i]);
  }

  const bonds = new Map<string, [string, string, number, number][]>();
  for (let k = 0; templates && k < templates.rowCount; k++) {
    const comp = str(templates, "comp_id", k);
    const value = str(templates, "value_order", k).toLowerCase();
    let f: number = BOND_FLAGS.covalent, o = 1;
    if (str(templates, "pdbx_aromatic_flag", k).toUpperCase() === "Y") {
      f |= BOND_FLAGS.aromatic;
    }
    if (value === "delo") f |= BOND_FLAGS.aromatic;
    else if (value === "doub") o = 2;
    else if (value === "trip") o = 3;
    else if (value === "quad") o = 4;
    const list = bonds.get(comp) ?? [];
    list.push([
      str(templates, "atom_id_1", k),
      str(templates, "atom_id_2", k),
      o,
      f,
    ]);
    bonds.set(comp, list);
  }
  for (let r = 0; bonds.size && r < residues.length; r++) {
    const names = byName[r];
    const comps = new Set<string>();
    for (const list of names.values()) {
      for (const i of list) comps.add(atoms.comp[i]);
    }
    for (const comp of comps) {
      for (const [nameA, nameB, o, f] of bonds.get(comp) ?? []) {
        for (const x of names.get(nameA) ?? []) {
          if (atoms.comp[x] !== comp) continue;
          for (const y of names.get(nameB) ?? []) {
            if (atoms.comp[y] === comp && x !== y && compatible(x, y)) {
              add(x, y, o, f, "component");
            }
          }
        }
      }
    }
  }

  if (conn && chains.length) {
    const firstModel = chains[0].model;
    const residueAt = new Map<string, number>();
    residues.forEach((row, r) => {
      const chain = chains[row.chain];
      if (chain.model !== firstModel) return;
      const key = (seq: string) => `${chain.labelId}|${seq}|${row.insertion}`;
      if (!residueAt.has(key(row.authSeq))) residueAt.set(key(row.authSeq), r);
      if (!residueAt.has(`label:${key(String(row.seq))}`)) {
        residueAt.set(`label:${key(String(row.seq))}`, r);
      }
    });
    const partner = (row: number, p: 1 | 2): number => {
      const asym = str(conn, `ptnr${p}_label_asym_id`, row);
      const name = str(conn, `ptnr${p}_label_atom_id`, row);
      if (!asym || !name) return -1;
      const ins = str(conn, `pdbx_ptnr${p}_PDB_ins_code`, row);
      const auth = str(conn, `ptnr${p}_auth_seq_id`, row);
      const r = auth ? residueAt.get(`${asym}|${auth}|${ins}`) : residueAt.get(
        `label:${asym}|${str(conn, `ptnr${p}_label_seq_id`, row)}|${ins}`,
      );
      if (r === undefined) return -1;
      const alt = str(conn, `pdbx_ptnr${p}_label_alt_id`, row);
      const candidates = byName[r].get(name) ?? [];
      return candidates.find((i) => !alt || atoms.altloc[i] === alt) ?? -1;
    };
    for (let k = 0; k < conn.rowCount; k++) {
      const x = partner(k, 1), y = partner(k, 2);
      if (x < 0 || y < 0 || x === y) continue;
      const type = str(conn, "conn_type_id", k);
      const f = type === "covale"
        ? BOND_FLAGS.covalent
        : type === "disulf"
        ? BOND_FLAGS.covalent | BOND_FLAGS.disulfide
        : type === "hydrog"
        ? BOND_FLAGS.hydrogen
        : type === "metalc"
        ? BOND_FLAGS.metallic
        : 0;
      const value = str(conn, "pdbx_value_order", k);
      add(
        x,
        y,
        value === "doub" ? 2 : value === "trip" ? 3 : 1,
        f,
        "struct_conn",
      );
    }
  }
  if (!a.length) return undefined;
  return {
    count: a.length,
    a: Uint32Array.from(a),
    b: Uint32Array.from(b),
    order: Uint8Array.from(order),
    flags: Uint8Array.from(flags),
    source,
  };
}

/**
 * Entity subtypes the way Mol* assigns them (mol-model-formats/structure/basic/
 * entities.js): entity_poly.type, then pdbx_entity_branch.type, then Mol*'s
 * getEntitySubtype of the entity's first atom's component and its chem_comp
 * type; "other" when nothing applies.
 */
async function readEntitySubtypes(
  categories: Categories,
  atom: CifCategory,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (
    const [name, idField] of [["entity_poly", "entity_id"], [
      "pdbx_entity_branch",
      "entity_id",
    ]] as const
  ) {
    const cat = categories[name];
    for (let i = 0; cat && i < cat.rowCount; i++) {
      const type = str(cat, "type", i);
      if (type) out.set(str(cat, idField, i), type);
    }
  }
  const compType = new Map<string, string>();
  const chemComp = categories.chem_comp;
  for (let i = 0; chemComp && i < chemComp.rowCount; i++) {
    compType.set(str(chemComp, "id", i), str(chemComp, "type", i));
  }
  const firstComp = new Map<string, string>();
  for (let i = 0; i < atom.rowCount; i++) {
    const id = str(atom, "label_entity_id", i);
    if (!out.has(id) && !firstComp.has(id)) {
      firstComp.set(id, str(atom, "label_comp_id", i));
    }
  }
  if (firstComp.size) {
    const { getEntitySubtype } = await import(
      "molstar/lib/mol-model/structure/model/types.js"
    );
    for (const [id, comp] of firstComp) {
      // Mol*'s component type sets are lower case ("l-peptide linking").
      const type = (compType.get(comp) || "other").toLowerCase();
      out.set(
        id,
        getEntitySubtype(comp, type as Parameters<typeof getEntitySubtype>[1]),
      );
    }
  }
  return out;
}

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
    atomResidue = new Uint32Array(atom.rowCount),
    atomComp: string[] = [];
  let microheterogeneous = false;
  // Optional columns are only emitted when the file carries their source field.
  const charge = field(atom, "pdbx_formal_charge");
  // Mol* reads '?' and '.' as 0; the column only counts as imported when at
  // least one row carries a value.
  let chargeImported = false;
  const hasGroup = !!field(atom, "group_PDB"),
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
    // Like Mol*, the component is not part of residue identity, so a
    // microheterogeneous position (PRO/SER at one seq id) stays one residue;
    // atoms keep their own component in atoms.comp.
    const residueKey = `${chain}:${seq}:${authSeq}:${
      str(atom, "pdbx_PDB_ins_code", i)
    }`;
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
    atomComp.push(comp);
    if (comp !== residues[residue].comp) microheterogeneous = true;
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
    if (charge && charge.valueKind(i) === 0) {
      formalCharge[i] = Math.trunc(charge.float(i));
      chargeImported = true;
    }
  }
  const residueCount = residues.length, chainCount = chains.length;
  const links = readLinks(
    categories,
    {
      name: names,
      altloc,
      comp: atomComp,
      residue: atomResidue,
    },
    residues,
    chains,
  );
  const entityTypes = new Map<string, string>();
  const entity = categories.entity;
  for (let i = 0; entity && i < entity.rowCount; i++) {
    entityTypes.set(str(entity, "id", i), str(entity, "type", i).toLowerCase());
  }
  const entitySubtypes = hasEntity
    ? await readEntitySubtypes(categories, atom)
    : new Map<string, string>();
  const secondaryStructure = readSecondaryStructure(
    categories,
    residues,
    chains,
  );
  // Mol* always has model secondary structure for mmCIF: the annotation, or
  // all none when the file has neither category.
  const ssAnnotated = !!(categories.struct_conf ||
    categories.struct_sheet_range);
  const data = createStructure({
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
        ...(microheterogeneous ? { comp: atomComp } : {}),
      },
      residues: {
        count: residueCount,
        chain: Uint32Array.from(residues, (r) => r.chain),
        labelSeq: Int32Array.from(residues, (r) => r.seq),
        authSeq: residues.map((r) => r.authSeq),
        insertionCode: residues.map((r) => r.insertion),
        comp: residues.map((r) => r.comp),
        polymer: residues.map((r) => polymerKind(r.comp)),
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
            entitySubtype: chains.map((c) =>
              entitySubtypes.get(c.entityId) ?? "other"
            ),
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
      ...(links ? { links } : {}),
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
  // Every io structure resolves formalCharge, as in Mol*: imported values, or
  // zeros marked 'default' when the file has none.
  return withAttributes(data, {
    formalCharge: {
      domain: "atom",
      kind: "code",
      values: formalCharge,
      provenance: chargeImported ? "imported:mmcif" : "default",
    },
    ssCode: {
      domain: "residue",
      kind: "code",
      // ssCode codes: helix H (1), sheet E (3), coil 0.
      values: Uint8Array.from(
        secondaryStructure,
        (k) => k === "helix" ? 1 : k === "sheet" ? 3 : 0,
      ),
      provenance: ssAnnotated ? "imported:mmcif" : "default",
    },
  });
}
