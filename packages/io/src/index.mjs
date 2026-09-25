import { createStructure } from '@molgpu/table';

const ELEMENT = { H: 1, C: 6, N: 7, O: 8, P: 15, S: 16, SE: 34, FE: 26 };
const RADIUS = { 1: 1.1, 6: 1.7, 7: 1.55, 8: 1.52, 15: 1.8, 16: 1.8, 26: 2.05, 34: 1.9 };

// Chemical-component name sets ported from Mol* 5.11.0's MIT-licensed
// mol-model/structure/model/types.js (AminoAcidNamesL/D, RnaBaseNames,
// DnaBaseNames), used to classify each residue by its `comp` (label_comp_id)
// so trace/cartoon consumers can pick guide atoms without re-deriving this.
const AMINO_ACID_NAMES = new Set([
  'HIS', 'ARG', 'LYS', 'ILE', 'PHE', 'LEU', 'TRP', 'ALA', 'MET', 'PRO', 'CYS',
  'ASN', 'VAL', 'GLY', 'SER', 'GLN', 'TYR', 'ASP', 'GLU', 'THR', 'SEC', 'PYL',
  'UNK', 'MSE', 'SEP', 'TPO', 'PTR', 'PCA', 'HYP',
  'HSD', 'HSE', 'HSP', 'LSN', 'ASPP', 'GLUP',
  'HID', 'HIE', 'HIP', 'LYN', 'ASH', 'GLH',
  'DAL', 'DAR', 'DSG', 'DAS', 'DCY', 'DGL', 'DGN', 'DHI', 'DIL', 'DLE',
  'DLY', 'MED', 'DPN', 'DPR', 'DSN', 'DTH', 'DTR', 'DTY', 'DVA', 'DNE',
]);
const RNA_BASE_NAMES = new Set(['A', 'C', 'T', 'G', 'I', 'U', 'N']);
const DNA_BASE_NAMES = new Set(['DA', 'DC', 'DT', 'DG', 'DI', 'DU', 'DN']);
const polymerKind = comp => {
  const name = comp.toUpperCase();
  if (AMINO_ACID_NAMES.has(name)) return 'protein';
  if (RNA_BASE_NAMES.has(name)) return 'rna';
  if (DNA_BASE_NAMES.has(name)) return 'dna';
  return 'other';
};
const clean = value => value === '.' || value === '?' ? '' : value;
const field = (category, name) => category.getField(name);
const str = (category, name, row, fallback = '') => clean(field(category, name)?.str(row) ?? fallback);
const num = (category, name, row, fallback = 0) => field(category, name)?.float(row) ?? fallback;

/** A machine-readable failure at the BCIF/Mol* import boundary. */
export class BcifParseError extends Error {
  constructor(message, code, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'BcifParseError';
    this.code = code;
  }
}

async function parseBcif(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new BcifParseError('BCIF input must be a Uint8Array', 'INVALID_INPUT');
  }
  try {
    // Keep the sole Mol* dependency behind the call boundary: consumers that
    // only use @molgpu/table never load this parser or its transitive chunks.
    const { CIF } = await import('molstar/lib/mol-io/reader/cif.js');
    const parsed = await CIF.parseBinary(bytes).run();
    if (parsed.isError) throw new BcifParseError(parsed.message, 'INVALID_BCIF');
    return parsed.result;
  } catch (error) {
    if (error instanceof BcifParseError) throw error;
    throw new BcifParseError('Unable to load the optional Mol* BCIF parser', 'PARSER_UNAVAILABLE', error);
  }
}

/** A machine-readable failure computing a molecular surface scalar field. */
export class SurfaceFieldError extends Error {
  constructor(message, code, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SurfaceFieldError';
    this.code = code;
  }
}

/**
 * Solvent-excluded-surface scalar field over a set of atoms, via Mol*'s
 * calcMolecularSurface — kept behind this runtime import boundary exactly
 * like parseBcif, so consumers of @molgpu/table/@molgpu/geo alone never
 * load it. `atoms` is plain owned columns (x/y/z/radius Float32Array[count]),
 * never a Mol* Structure/Unit. `values` keeps Mol*'s z-fastest layout
 * (values[k + nz * (j + ny * i)]); @molgpu/geo's marchingCubes reads an
 * x-fastest grid, so it is NOT a drop-in input for it without reordering.
 * `transform` is a column-major scale+translate Mat4 — read its diagonal as
 * `spacing` and its translation row as `origin` — and `level` is the isovalue
 * (the solvent-excluded-surface convention: the probe radius itself).
 */
export async function molecularSurfaceField(atoms, { probeRadius = 1.4, resolution = 0.5, probePositions = 36 } = {}) {
  const { x, y, z, radius, count } = atoms;
  if (!Number.isSafeInteger(count) || count < 0) throw new SurfaceFieldError('atoms.count must be a nonnegative safe integer', 'INVALID_INPUT');
  if (![x, y, z, radius].every(a => a instanceof Float32Array && a.length === count)) {
    throw new SurfaceFieldError('atoms.x/y/z/radius must each be a Float32Array[count]', 'INVALID_INPUT');
  }
  if (count === 0) throw new SurfaceFieldError('atoms must contain at least one atom', 'EMPTY_INPUT');
  try {
    const [{ calcMolecularSurface }, { getFastBoundary }, { OrderedSet }] = await Promise.all([
      import('molstar/lib/mol-math/geometry/molecular-surface.js'),
      import('molstar/lib/mol-math/geometry/boundary.js'),
      import('molstar/lib/mol-data/int/ordered-set.js'),
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
    for (let i = 0; i < count; i++) { if (radius[i] > maxRadius) maxRadius = radius[i]; searchRadius[i] = radius[i] + probeRadius; }
    const position = { x, y, z, id, indices, radius: searchRadius };
    // calcMolecularSurface only ever touches ctx.shouldUpdate/ctx.update; a
    // stub stands in for mol-task's RuntimeContext (a type-only import, erased at runtime).
    const stubContext = { shouldUpdate: false, update: async () => {} };
    const result = await calcMolecularSurface(stubContext, position, boundary, maxRadius, null, { probeRadius, resolution, probePositions });
    const values = result.field.data instanceof Float32Array ? result.field.data.slice() : Float32Array.from(result.field.data);
    return {
      values, dims: [...result.field.space.dimensions], transform: Float32Array.from(result.transform),
      resolution: result.resolution, maxRadius: result.maxRadius, level: probeRadius,
    };
  } catch (error) {
    if (error instanceof SurfaceFieldError) throw error;
    throw new SurfaceFieldError('Unable to compute the molecular surface field', 'FIELD_UNAVAILABLE', error);
  }
}

/**
 * Mark residues [begSeq, endSeq] on chain `chainLabel` with `kind`, by
 * label_seq_id (the compact, gap-aware numbering already used for
 * residues.labelSeq — no auth/insertion-code ambiguity to resolve here).
 */
function markSecondaryStructure(secondaryStructure, residues, chains, chainLabel, begSeq, endSeq, kind) {
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
function readSecondaryStructure(categories, residues, chains) {
  const secondaryStructure = new Array(residues.length).fill('coil');
  const conf = categories.struct_conf;
  for (let i = 0; conf && i < conf.rowCount; i++) {
    if (!str(conf, 'conf_type_id', i).toUpperCase().startsWith('HELX')) continue;
    markSecondaryStructure(secondaryStructure, residues, chains,
      str(conf, 'beg_label_asym_id', i), Math.trunc(num(conf, 'beg_label_seq_id', i, NaN)),
      Math.trunc(num(conf, 'end_label_seq_id', i, NaN)), 'helix');
  }
  const sheet = categories.struct_sheet_range;
  for (let i = 0; sheet && i < sheet.rowCount; i++) {
    markSecondaryStructure(secondaryStructure, residues, chains,
      str(sheet, 'beg_label_asym_id', i), Math.trunc(num(sheet, 'beg_label_seq_id', i, NaN)),
      Math.trunc(num(sheet, 'end_label_seq_id', i, NaN)), 'sheet');
  }
  return secondaryStructure;
}

/** Lower a BinaryCIF mmCIF block to renderer-independent owned table columns. */
export async function structureFromBcif(bytes) {
  const parsed = await parseBcif(bytes);
  const categories = parsed.blocks[0]?.categories ?? {};
  const atom = categories.atom_site;
  if (!atom) throw new BcifParseError('BCIF has no atom_site category', 'MISSING_ATOM_SITE');
  const positions = new Float32Array(atom.rowCount * 3), ids = [], names = [], altloc = [], element = new Uint8Array(atom.rowCount);
  const occupancy = new Float32Array(atom.rowCount), bfactor = new Float32Array(atom.rowCount), radius = new Float32Array(atom.rowCount), atomResidue = new Uint32Array(atom.rowCount);
  const residueRows = new Map(), residues = [], chainRows = new Map(), chains = [];
  for (let i = 0; i < atom.rowCount; i++) {
    const model = Math.trunc(num(atom, 'pdbx_PDB_model_num', i, 1));
    const chainId = str(atom, 'label_asym_id', i, '');
    const chainKey = `${model}:${chainId}`;
    let chain = chainRows.get(chainKey);
    if (chain === undefined) { chain = chains.length; chainRows.set(chainKey, chain); chains.push({ model, labelId: chainId, authId: str(atom, 'auth_asym_id', i, chainId) }); }
    const seq = Math.trunc(num(atom, 'label_seq_id', i, -1)), comp = str(atom, 'label_comp_id', i, 'UNK');
    // label_seq_id is intentionally absent for non-polymer entities. Include
    // author numbering so consecutive waters and ligands remain distinct rows.
    const authSeq = str(atom, 'auth_seq_id', i, String(seq));
    const residueKey = `${chain}:${seq}:${authSeq}:${str(atom, 'pdbx_PDB_ins_code', i)}:${comp}`;
    let residue = residueRows.get(residueKey);
    if (residue === undefined) { residue = residues.length; residueRows.set(residueKey, residue); residues.push({ chain, seq, authSeq, insertion: str(atom, 'pdbx_PDB_ins_code', i), comp }); }
    atomResidue[i] = residue; ids.push(str(atom, 'id', i, String(i + 1))); names.push(str(atom, 'label_atom_id', i, ''));
    altloc.push(str(atom, 'label_alt_id', i));
    const atomic = ELEMENT[str(atom, 'type_symbol', i).toUpperCase()] ?? 0; element[i] = atomic; radius[i] = RADIUS[atomic] ?? 1.7;
    positions[i * 3] = num(atom, 'Cartn_x', i); positions[i * 3 + 1] = num(atom, 'Cartn_y', i); positions[i * 3 + 2] = num(atom, 'Cartn_z', i);
    occupancy[i] = num(atom, 'occupancy', i, 1); bfactor[i] = num(atom, 'B_iso_or_equiv', i, 0);
  }
  const residueCount = residues.length, chainCount = chains.length;
  const secondaryStructure = readSecondaryStructure(categories, residues, chains);
  return createStructure({ positions, topology: {
    atoms: { count: atom.rowCount, id: ids, name: names, altloc, residue: atomResidue, element, occupancy, bfactor, radius },
    residues: { count: residueCount, chain: Uint32Array.from(residues, r => r.chain), labelSeq: Int32Array.from(residues, r => r.seq), authSeq: residues.map(r => r.authSeq), insertionCode: residues.map(r => r.insertion), comp: residues.map(r => r.comp), polymer: residues.map(r => polymerKind(r.comp)), secondaryStructure },
    chains: { count: chainCount, model: Int32Array.from(chains, c => c.model), labelId: chains.map(c => c.labelId), authId: chains.map(c => c.authId) },
    bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
    instances: { count: chainCount, chain: Uint32Array.from({ length: chainCount }, (_, i) => i), operatorId: new Array(chainCount).fill('identity'), transform: Float64Array.from({ length: chainCount * 16 }, (_, i) => i % 16 === 0 || i % 16 === 5 || i % 16 === 10 || i % 16 === 15 ? 1 : 0) },
  }});
}
