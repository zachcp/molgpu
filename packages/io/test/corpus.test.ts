import { assert, assertEquals, assertStrictEquals } from '@std/assert';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { activeAtoms } from '@molgpu/table';
import { structureFromBcif } from '../src/index.ts';
import { corpus } from './corpus.ts';
import { cifCategories, num, str, type CifCategory } from './cif.ts';


function primaryOracle(atom: CifCategory): Uint32Array {
  const residueRows = new Map<string, number>(), residueForRow = new Uint32Array(atom.rowCount);
  const modelForRow = new Int32Array(atom.rowCount), altloc: string[] = [], occupancy: number[] = [];
  for (let i = 0; i < atom.rowCount; i++) {
    const model = Math.trunc(num(atom, 'pdbx_PDB_model_num', i, 1));
    const chain = str(atom, 'label_asym_id', i);
    const seq = Math.trunc(num(atom, 'label_seq_id', i, -1));
    const authSeq = str(atom, 'auth_seq_id', i, String(seq));
    const key = `${model}:${chain}:${seq}:${authSeq}:${str(atom, 'pdbx_PDB_ins_code', i)}:${str(atom, 'label_comp_id', i, 'UNK')}`;
    let residue = residueRows.get(key);
    if (residue === undefined) { residue = residueRows.size; residueRows.set(key, residue); }
    residueForRow[i] = residue; modelForRow[i] = model;
    altloc[i] = str(atom, 'label_alt_id', i); occupancy[i] = num(atom, 'occupancy', i, 1);
  }
  const scores = new Map<number, Map<string, number>>();
  for (let i = 0; i < atom.rowCount; i++) {
    if (!altloc[i]) continue;
    const byLabel = scores.get(residueForRow[i]) ?? new Map();
    byLabel.set(altloc[i], (byLabel.get(altloc[i]) ?? 0) + occupancy[i]);
    scores.set(residueForRow[i], byLabel);
  }
  const choice = new Map([...scores].map(([residue, labels]) => [residue,
    [...labels].sort(([a, av], [b, bv]) => bv - av || a.localeCompare(b))[0][0]]));
  const firstModel = modelForRow[0], rows: number[] = [];
  for (let i = 0; i < atom.rowCount; i++) {
    if (modelForRow[i] !== firstModel) continue;
    if (altloc[i] && altloc[i] !== choice.get(residueForRow[i])) continue;
    rows.push(i);
  }
  return Uint32Array.from(rows);
}

for (const fixture of corpus) Deno.test(`${fixture.id}: preserve Mol* atom_site rows and policy selection`, async () => {
  const bytes = new Uint8Array(await readFile(new URL(`./fixtures/${fixture.id}.bcif`, import.meta.url)));
  assertStrictEquals(createHash('sha256').update(bytes).digest('hex'), fixture.sha256, 'fixture bytes are pinned');
  const atom = (await cifCategories(bytes)).atom_site;
  const data = await structureFromBcif(bytes);
  assertStrictEquals(atom.rowCount, fixture.atoms);
  assertStrictEquals(data.topology.atoms.count, fixture.atoms);
  assertStrictEquals(new Set(Array.from({ length: atom.rowCount }, (_, i) => Math.trunc(num(atom, 'pdbx_PDB_model_num', i, 1)))).size, fixture.models);

  // Ordering is intentionally source atom_site order; coordinates are f32-owned
  // columns, so identity strings are exact and positions use a 1e-5 Å tolerance.
  for (let i = 0; i < atom.rowCount; i++) {
    assertStrictEquals(data.topology.atoms.id[i], str(atom, 'id', i, String(i + 1)));
    assertStrictEquals(data.topology.atoms.name[i], str(atom, 'label_atom_id', i));
    assertStrictEquals(data.topology.atoms.altloc[i], str(atom, 'label_alt_id', i));
    for (const [offset, field] of ['Cartn_x', 'Cartn_y', 'Cartn_z'].entries()) {
      assert(Math.abs(data.positions[i * 3 + offset] - num(atom, field, i)) <= 1e-5, `row ${i} ${field}`);
    }
  }
  assertEquals(activeAtoms(data, { model: 'first', altloc: 'primary' }), primaryOracle(atom));
  assertStrictEquals(activeAtoms(data, { model: 'all', altloc: 'all' }).length, fixture.atoms);
});
