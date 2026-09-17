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
