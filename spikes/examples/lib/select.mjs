// Selections as VALUES (CONCEPT 2), not tree nodes.
//
// A selection is (domain, sorted index buffer, stable key). The domain matters:
// atoms, residues and bonds have different cardinality, and a selection is only
// meaningful against the domain it was built for.
//
// The `key` exists so geometry can memoize on selection identity without
// deep-comparing index arrays.

/** @typedef {{domain:'atom'|'residue'|'bond', indices:Uint32Array, key:string}} Selection */

const sel = (domain, indices, key) => ({ domain, indices, key });

export const all = (table) =>
  sel('atom', Uint32Array.from({ length: table.count }, (_, i) => i), 'all');

/** Build from a per-atom predicate. Runs once at selection time, never per frame. */
export function where(table, key, predicate) {
  const out = [];
  for (let i = 0; i < table.count; i++) if (predicate(i, table)) out.push(i);
  return sel('atom', Uint32Array.from(out), key);
}

export const element = (table, e) => where(table, `element=${e}`, (i, t) => t.element[i] === e);

/** Set ops are cheap because a selection is just a sorted index list. */
export function union(a, b) {
  assertSameDomain(a, b);
  const s = new Set([...a.indices, ...b.indices]);
  return sel(a.domain, Uint32Array.from([...s].sort((x, y) => x - y)), `(${a.key}|${b.key})`);
}
export function intersect(a, b) {
  assertSameDomain(a, b);
  const s = new Set(b.indices);
  return sel(a.domain, a.indices.filter((i) => s.has(i)), `(${a.key}&${b.key})`);
}
export function difference(a, b) {
  assertSameDomain(a, b);
  const s = new Set(b.indices);
  return sel(a.domain, a.indices.filter((i) => !s.has(i)), `(${a.key}\\${b.key})`);
}

function assertSameDomain(a, b) {
  if (a.domain !== b.domain) {
    throw new Error(`selection domain mismatch: ${a.domain} vs ${b.domain}`);
  }
}

// ---- structure-aware predicates -------------------------------------------
// These are the ones that actually matter for molecular work, and they only
// became expressible once the table carried residue and backbone columns.

import { BACKBONE } from './table.mjs';

export const backbone = (table) =>
  where(table, 'backbone', (i, t) => t.backbone[i] !== BACKBONE.SIDECHAIN);

export const sidechain = (table) =>
  where(table, 'sidechain', (i, t) => t.backbone[i] === BACKBONE.SIDECHAIN);

/** Residues by author sequence id, e.g. resi(table, [1, 7, 23]). */
export function resi(table, seqs) {
  const want = new Set(seqs);
  const keep = new Set();
  for (let r = 0; r < table.residues.count; r++) {
    if (want.has(table.residues.seq[r])) keep.add(r);
  }
  return where(table, `resi(${seqs.join(',')})`, (i, t) => keep.has(t.residue[i]));
}

/** Residues by name, e.g. resn(table, ['CYS']). */
export function resn(table, names) {
  const want = new Set(names);
  const keep = new Set();
  for (let r = 0; r < table.residues.count; r++) {
    if (want.has(table.residues.name[r])) keep.add(r);
  }
  return where(table, `resn(${names.join(',')})`, (i, t) => keep.has(t.residue[i]));
}

/** Everything within `cutoff` Angstrom of any atom in `of`. */
export function within(table, cutoff, of) {
  const c2 = cutoff * cutoff;
  const seeds = of.indices;
  return where(table, `within(${cutoff},${of.key})`, (i, t) => {
    for (const j of seeds) {
      const dx = t.positions[i*3] - t.positions[j*3];
      const dy = t.positions[i*3+1] - t.positions[j*3+1];
      const dz = t.positions[i*3+2] - t.positions[j*3+2];
      if (dx*dx + dy*dy + dz*dz <= c2) return true;
    }
    return false;
  });
}
