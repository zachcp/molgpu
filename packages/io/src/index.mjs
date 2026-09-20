import { CIF } from 'molstar/lib/mol-io/reader/cif.js';
import { createStructure } from '@molgpu/table';

const ELEMENT = { H: 1, C: 6, N: 7, O: 8, P: 15, S: 16, SE: 34, FE: 26 };
const RADIUS = { 1: 1.1, 6: 1.7, 7: 1.55, 8: 1.52, 15: 1.8, 16: 1.8, 26: 2.05, 34: 1.9 };
const clean = value => value === '.' || value === '?' ? '' : value;
const field = (category, name) => category.getField(name);
const str = (category, name, row, fallback = '') => clean(field(category, name)?.str(row) ?? fallback);
const num = (category, name, row, fallback = 0) => field(category, name)?.float(row) ?? fallback;

/** Lower a BinaryCIF mmCIF block to renderer-independent owned table columns. */
export async function structureFromBcif(bytes) {
  const parsed = await CIF.parseBinary(bytes).run();
  if (parsed.isError) throw new Error(parsed.message);
  const atom = parsed.result.blocks[0]?.categories.atom_site;
  if (!atom) throw new TypeError('BCIF has no atom_site category');
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
  return createStructure({ positions, topology: {
    atoms: { count: atom.rowCount, id: ids, name: names, altloc, residue: atomResidue, element, occupancy, bfactor, radius },
    residues: { count: residueCount, chain: Uint32Array.from(residues, r => r.chain), labelSeq: Int32Array.from(residues, r => r.seq), authSeq: residues.map(r => r.authSeq), insertionCode: residues.map(r => r.insertion), comp: residues.map(r => r.comp), polymer: new Array(residueCount).fill('other') },
    chains: { count: chainCount, model: Int32Array.from(chains, c => c.model), labelId: chains.map(c => c.labelId), authId: chains.map(c => c.authId) },
    bonds: { count: 0, a: new Uint32Array(), b: new Uint32Array(), order: new Uint8Array(), source: [] },
    instances: { count: chainCount, chain: Uint32Array.from({ length: chainCount }, (_, i) => i), operatorId: new Array(chainCount).fill('identity'), transform: Float64Array.from({ length: chainCount * 16 }, (_, i) => i % 16 === 0 || i % 16 === 5 || i % 16 === 10 || i % 16 === 15 ? 1 : 0) },
  }});
}
