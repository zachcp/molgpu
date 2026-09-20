// @molgpu/select — pure selection queries and dataset-bound resolved selections.
//
// Two concepts, kept deliberately apart (see the Phase 2 architecture review):
//
//   SelectionQuery  a reusable, structure-independent recipe. Building one
//                   touches no dataset, so the same query resolves against many
//                   structures independently.
//   Selection       the result of resolving a query against one StructureData.
//                   It carries that dataset's identity, its domain, the sorted
//                   unique in-range indices, the dependency REVISIONS it read,
//                   and a library-owned id. Caller strings are labels, never the
//                   cache key: identity is derived from resolved content.
//
// Set operations and conversions act on RESOLVED selections and reject mixing
// datasets, domains, or inconsistent revisions. There is no string parser and no
// arbitrary WGSL promise here — this package is pure CPU index math.

const fail = (field, message) => { throw new TypeError(`@molgpu/select ${field}: ${message}`); };

const DOMAINS = ['atom', 'residue', 'bond'];
const assertDomain = (domain) => { if (!DOMAINS.includes(domain)) fail('domain', `expected one of ${DOMAINS.join('/')}, got ${domain}`); };

/** A StructureData is anything this module was handed that carries table identity. */
const assertStructure = (data) => {
  if (!data || typeof data !== 'object' || !data.identity || !data.revision || !data.topology)
    fail('data', 'expected a StructureData from @molgpu/table');
};

// Stable, library-owned ordinal per dataset identity, so two datasets never share
// a selection id even when a caller reuses the same query label for both.
const datasetOrdinals = new WeakMap();
let nextOrdinal = 0;
const datasetToken = (data) => {
  let token = datasetOrdinals.get(data.identity);
  if (token === undefined) datasetOrdinals.set(data.identity, token = nextOrdinal++);
  return token;
};

const DOMAIN_COUNT = {
  atom: (data) => data.topology.atoms.count,
  residue: (data) => data.topology.residues.count,
  bond: (data) => data.topology.bonds.count, // bond selections operate over declared topology rows
};

// ---- SelectionQuery builders (pure) ---------------------------------------

const query = (node) => Object.freeze(node);

/** Every row of a domain. */
export const all = (domain = 'atom') => { assertDomain(domain); return query({ type: 'all', domain, label: `all:${domain}`, deps: ['topology'] }); };

/**
 * A predicate over the rows of `domain`. `test(data, row)` runs once at resolve
 * time, never per frame. `deps` names the revision streams the predicate reads
 * so staleness can be detected; default is structural (topology + attributes).
 */
export const where = (domain, label, test, deps = ['topology', 'attributes']) => {
  assertDomain(domain);
  if (typeof test !== 'function') fail('where.test', 'expected a predicate function');
  if (typeof label !== 'string' || !label) fail('where.label', 'expected a non-empty label');
  return query({ type: 'where', domain, label, test, deps: Object.freeze([...deps]) });
};

/** Atoms of a given atomic number. */
export const element = (z) => where('atom', `element=${z}`, (data, i) => data.topology.atoms.element[i] === z);

/** Residues by chemical component name, e.g. comp(['CYS']). */
export const comp = (names) => {
  const want = new Set(names);
  return where('residue', `comp(${[...want].join(',')})`, (data, r) => want.has(data.topology.residues.comp[r]));
};

/**
 * Atoms within `cutoff` Angstrom of any atom of the inner selection query.
 * Position-dependent, so it declares a positions dependency and goes stale when
 * coordinates advance.
 */
export const within = (cutoff, of) => {
  if (!Number.isFinite(cutoff) || cutoff < 0) fail('within.cutoff', 'expected a non-negative distance');
  if (!of || of.type === undefined) fail('within.of', 'expected a SelectionQuery');
  return query({ type: 'within', domain: 'atom', cutoff, of, label: `within(${cutoff},${of.label})`, deps: ['topology', 'positions'] });
};

// ---- resolution ------------------------------------------------------------

const sortedUnique = (rows, count, field) => {
  const seen = new Uint8Array(count);
  for (const i of rows) {
    if (!Number.isInteger(i) || i < 0 || i >= count) fail(field, `index ${i} out of range for ${count} rows`);
    seen[i] = 1;
  }
  const out = [];
  for (let i = 0; i < count; i++) if (seen[i]) out.push(i);
  return Uint32Array.from(out);
};

// FNV-1a over the index bytes: a content hash so equal membership yields equal id
// and changed membership yields a different one, independent of the caller label.
const hashIndices = (indices) => {
  let h = 0x811c9dc5;
  for (let k = 0; k < indices.length; k++) {
    h ^= indices[k];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

const dependency = (data, deps) => {
  const out = {};
  for (const key of deps) {
    if (data.revision[key] === undefined) fail('deps', `unknown revision stream ${key}`);
    out[key] = data.revision[key];
  }
  return Object.freeze(out);
};

const makeSelection = (domain, data, rawRows, deps, label, source) => {
  const count = DOMAIN_COUNT[domain](data);
  const indices = sortedUnique(rawRows, count, `${domain} indices`);
  const revisions = dependency(data, deps);
  const token = datasetToken(data);
  const revString = Object.keys(revisions).sort().map((k) => `${k}=${revisions[k]}`).join(',');
  return Object.freeze({
    domain,
    dataset: data.identity,
    indices,
    deps: revisions,
    label,
    id: `${domain}@${token}#${revString}:${indices.length}:${hashIndices(indices)}`,
    source: source ?? null,
  });
};

/** Collapse a query's dep list plus its resolved children into one dep set. */
const mergeDeps = (...lists) => [...new Set(lists.flat())];

const evalQuery = (node, data) => {
  if (!node || node.type === undefined) fail('query', 'expected a SelectionQuery');
  switch (node.type) {
    case 'all': {
      const count = DOMAIN_COUNT[node.domain](data);
      return { domain: node.domain, rows: Uint32Array.from({ length: count }, (_, i) => i), deps: node.deps };
    }
    case 'where': {
      const count = DOMAIN_COUNT[node.domain](data);
      const rows = [];
      for (let i = 0; i < count; i++) if (node.test(data, i)) rows.push(i);
      return { domain: node.domain, rows, deps: node.deps };
    }
    case 'within': {
      const inner = evalQuery(node.of, data);
      const seeds = toAtomRows(inner.domain, inner.rows, data);
      const c2 = node.cutoff * node.cutoff;
      const rows = [];
      for (let i = 0; i < data.topology.atoms.count; i++) {
        for (const j of seeds) {
          const dx = data.positions[i * 3] - data.positions[j * 3];
          const dy = data.positions[i * 3 + 1] - data.positions[j * 3 + 1];
          const dz = data.positions[i * 3 + 2] - data.positions[j * 3 + 2];
          if (dx * dx + dy * dy + dz * dz <= c2) { rows.push(i); break; }
        }
      }
      return { domain: 'atom', rows, deps: mergeDeps(node.deps, inner.deps) };
    }
    default:
      fail('query', `unknown query type ${node.type}`);
  }
};

/** Resolve a SelectionQuery against one dataset into a Selection. */
export function resolve(selectionQuery, data) {
  assertStructure(data);
  const { domain, rows, deps } = evalQuery(selectionQuery, data);
  return makeSelection(domain, data, rows, deps, selectionQuery.label, null);
}

// ---- set operations over resolved selections ------------------------------

const assertSelection = (sel, field) => {
  if (!sel || !sel.id || !sel.domain || !sel.dataset) fail(field, 'expected a resolved Selection');
};

const assertCombinable = (a, b) => {
  assertSelection(a, 'left'); assertSelection(b, 'right');
  if (a.dataset !== b.dataset) fail('dataset', 'selections come from different datasets');
  if (a.domain !== b.domain) fail('domain', `set operation across domains ${a.domain} and ${b.domain}`);
  for (const key of Object.keys(a.deps)) {
    if (key in b.deps && a.deps[key] !== b.deps[key])
      fail('revision', `selections read ${key} at revisions ${a.deps[key]} and ${b.deps[key]}`);
  }
};

// A resolved selection knows its domain count from the largest in-range index it
// could hold; set ops re-derive it from the shared dataset via the recorded token
// only for validation, so they rebuild the sorted set directly on the indices.
const combine = (a, b, label, keep) => {
  assertCombinable(a, b);
  const inA = new Set(a.indices);
  const inB = new Set(b.indices);
  const rows = [];
  for (const i of a.indices) if (keep(inA.has(i), inB.has(i))) rows.push(i);
  for (const i of b.indices) if (!inA.has(i) && keep(inA.has(i), inB.has(i))) rows.push(i);
  rows.sort((x, y) => x - y);
  const deps = Object.freeze({ ...b.deps, ...a.deps });
  const revString = Object.keys(deps).sort().map((k) => `${k}=${deps[k]}`).join(',');
  const indices = Uint32Array.from(rows);
  const token = datasetOrdinals.get(a.dataset);
  return Object.freeze({
    domain: a.domain, dataset: a.dataset, indices, deps, label,
    id: `${a.domain}@${token}#${revString}:${indices.length}:${hashIndices(indices)}`, source: null,
  });
};

export const union = (a, b) => combine(a, b, `(${a.label}|${b.label})`, (x, y) => x || y);
export const intersect = (a, b) => combine(a, b, `(${a.label}&${b.label})`, (x, y) => x && y);
export const difference = (a, b) => combine(a, b, `(${a.label}\\${b.label})`, (x, y) => x && !y);

// ---- domain conversions ----------------------------------------------------

const assertOwns = (sel, data, field = 'data') => {
  assertSelection(sel, 'selection'); assertStructure(data);
  if (sel.dataset !== data.identity) fail(field, 'selection does not belong to this dataset');
};

/** Map rows of any supported domain to the underlying atom rows. */
function toAtomRows(domain, rows, data) {
  if (domain === 'atom') return rows;
  if (domain === 'residue') {
    const want = new Set(rows);
    const out = [];
    const residue = data.topology.atoms.residue;
    for (let i = 0; i < data.topology.atoms.count; i++) if (want.has(residue[i])) out.push(i);
    return out;
  }
  if (domain === 'bond') {
    const { a, b } = data.topology.bonds;
    const out = [];
    for (const r of rows) { out.push(a[r], b[r]); }
    return out;
  }
  fail('domain', `cannot expand ${domain} to atoms`);
}

/**
 * Expand a selection to atoms. A residue->atom expansion retains a source map:
 * `source.rows[k]` is the residue row that atom `indices[k]` came from, so picking
 * and field lookup can walk back to the originating identity.
 */
export function toAtoms(sel, data) {
  assertOwns(sel, data);
  if (sel.domain === 'atom') return sel;
  if (sel.domain === 'residue') {
    const want = new Set(sel.indices);
    const residue = data.topology.atoms.residue;
    const rows = [], srcRows = [];
    for (let i = 0; i < data.topology.atoms.count; i++) if (want.has(residue[i])) { rows.push(i); srcRows.push(residue[i]); }
    const selection = makeSelection('atom', data, rows, Object.keys(sel.deps), `atoms(${sel.label})`,
      Object.freeze({ domain: 'residue', rows: Uint32Array.from(srcRows) }));
    return selection;
  }
  // bond -> atoms: union of both endpoints
  const rows = toAtomRows('bond', sel.indices, data);
  return makeSelection('atom', data, rows, Object.keys(sel.deps), `atoms(${sel.label})`, null);
}

/** Collapse an atom (or residue) selection to the residues it touches. */
export function toResidues(sel, data) {
  assertOwns(sel, data);
  if (sel.domain === 'residue') return sel;
  const atoms = toAtoms(sel, data).indices;
  const residue = data.topology.atoms.residue;
  const rows = [];
  for (const i of atoms) rows.push(residue[i]);
  return makeSelection('residue', data, rows, mergeDeps(Object.keys(sel.deps), ['topology']), `residues(${sel.label})`, null);
}

/**
 * Bonds incident on a selection. `endpoints: 'both'` keeps only bonds whose two
 * endpoints are both selected; `'either'` keeps any touched bond. Uses the
 * table's declared/inferred topology via selectBonds, and retains a source map
 * of the endpoint atom rows per bond.
 */
export function toBonds(sel, data, { endpoints = 'both' } = {}) {
  assertOwns(sel, data);
  if (!['both', 'either'].includes(endpoints)) fail('endpoints', 'expected both or either');
  const atoms = toAtoms(sel, data).indices;
  const { bonds } = data.topology;
  const selected = new Set(atoms);
  const rows = [], srcA = [], srcB = [];
  for (let r = 0; r < bonds.count; r++) {
    const hitA = selected.has(bonds.a[r]), hitB = selected.has(bonds.b[r]);
    if (endpoints === 'both' ? hitA && hitB : hitA || hitB) { rows.push(r); srcA.push(bonds.a[r]); srcB.push(bonds.b[r]); }
  }
  return makeSelection('bond', data, rows, mergeDeps(Object.keys(sel.deps), ['topology']), `bonds:${endpoints}(${sel.label})`,
    Object.freeze({ domain: 'atom', a: Uint32Array.from(srcA), b: Uint32Array.from(srcB) }));
}

// ---- staleness & helpers ---------------------------------------------------

/** True once any revision stream the selection read has advanced on `data`. */
export function isStale(sel, data) {
  assertOwns(sel, data);
  return Object.keys(sel.deps).some((key) => data.revision[key] !== sel.deps[key]);
}

export const isEmpty = (sel) => { assertSelection(sel, 'selection'); return sel.indices.length === 0; };
export const count = (sel) => { assertSelection(sel, 'selection'); return sel.indices.length; };
