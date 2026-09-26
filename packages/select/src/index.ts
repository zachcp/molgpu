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
// datasets, domains, or inconsistent revisions. Queries can also be compiled from
// a SelectionExpr (the MolQL expression tree, see expr.ts). There is no string
// parser here (text front ends live in @molgpu/io) and no arbitrary WGSL
// promise — this package is pure CPU index math.

import { spatialGrid, type StructureData } from "@molgpu/table";
import {
  type CompiledExpr,
  compileExpr,
  type SelectionExpr,
  SUPPORTED_SYMBOLS,
} from "./expr.ts";

export type { SelectionExpr };

// Smallest grid cell for within(); a zero cutoff still needs a positive cell.
const MIN_CELL = 1;

export type Domain = "atom" | "residue" | "bond";
export type RevisionStream = "topology" | "positions" | "attributes";

/**
 * A pure, dataset-independent recipe. Build once, resolve against many datasets.
 *
 * Opaque: create queries only with `all`, `where`, `element`, `comp`,
 * `within` and `compile`, and pass them only to this package's functions. The four fields
 * below are the public surface. Runtime query objects carry further
 * per-kind fields (for example a `where` predicate or a `within` cutoff) that
 * are internal and may change in any release.
 */
export interface SelectionQuery {
  readonly type: string;
  readonly domain: Domain;
  readonly label: string;
  readonly deps: readonly RevisionStream[];
}

/** Mapping from a converted selection's rows back to the source domain rows. */
export type SourceMap =
  | { readonly domain: "residue"; readonly rows: Uint32Array }
  | {
    readonly domain: "atom";
    readonly a: Uint32Array;
    readonly b: Uint32Array;
  };

/** A query resolved against one dataset: identity-, domain-, and revision-bound. */
export interface Selection {
  readonly domain: Domain;
  /** The originating StructureData identity; compared by reference for set ops. */
  readonly dataset: StructureData["identity"];
  readonly indices: Uint32Array;
  /** Revision of each stream the resolution read, for staleness and set-op checks. */
  readonly deps: Readonly<Partial<Record<RevisionStream, number>>>;
  /** Human label from the query; NOT the cache key. */
  readonly label: string;
  /** Library-owned identity derived from dataset, revisions, and membership. */
  readonly id: string;
  readonly source: SourceMap | null;
}

type Revisions = Readonly<Partial<Record<RevisionStream, number>>>;
type Predicate = (data: StructureData, row: number) => boolean;

// The query node kinds. SelectionQuery is deliberately opaque in the public
// types (x24.11); only this module reads the per-kind fields.
type QueryNode =
  | (SelectionQuery & { readonly type: "all" })
  | (SelectionQuery & { readonly type: "where"; readonly test: Predicate })
  | (SelectionQuery & {
    readonly type: "within";
    readonly cutoff: number;
    readonly of: SelectionQuery;
  })
  | (SelectionQuery & { readonly type: "expr"; readonly expr: CompiledExpr });

/** An unresolved evaluation result: rows in some domain plus the streams read. */
interface Evaluated {
  readonly domain: Domain;
  readonly rows: ArrayLike<number> & Iterable<number>;
  readonly deps: readonly RevisionStream[];
}

const fail = (field: string, message: string): never => {
  throw new TypeError(`@molgpu/select ${field}: ${message}`);
};

const DOMAINS: readonly Domain[] = ["atom", "residue", "bond"];
const assertDomain = (domain: unknown): void => {
  if (!DOMAINS.includes(domain as Domain)) {
    fail("domain", `expected one of ${DOMAINS.join("/")}, got ${domain}`);
  }
};

/** A StructureData is anything this module was handed that carries table identity. */
const assertStructure = (data: unknown): void => {
  const d = data as Partial<StructureData> | null;
  if (
    !d || typeof d !== "object" || !d.identity || !d.revision || !d.topology
  ) {
    fail("data", "expected a StructureData from @molgpu/table");
  }
};

// Stable, library-owned ordinal per dataset identity, so two datasets never share
// a selection id even when a caller reuses the same query label for both.
const datasetOrdinals = new WeakMap<StructureData["identity"], number>();
let nextOrdinal = 0;
const datasetToken = (data: StructureData): number => {
  let token = datasetOrdinals.get(data.identity);
  if (token === undefined) {
    datasetOrdinals.set(data.identity, token = nextOrdinal++);
  }
  return token;
};

const DOMAIN_COUNT: Record<Domain, (data: StructureData) => number> = {
  atom: (data) => data.topology.atoms.count,
  residue: (data) => data.topology.residues.count,
  bond: (data) => data.topology.bonds.count, // bond selections operate over declared topology rows
};

// ---- SelectionQuery builders (pure) ---------------------------------------

const freezeQuery = (node: QueryNode): SelectionQuery => Object.freeze(node);

/** Every row of a domain. */
export function all(domain: Domain = "atom"): SelectionQuery {
  assertDomain(domain);
  return freezeQuery({
    type: "all",
    domain,
    label: `all:${domain}`,
    deps: ["topology"],
  });
}

/**
 * A predicate over the rows of `domain`. `test(data, row)` runs once at resolve
 * time, never per frame. `deps` names the revision streams the predicate reads
 * so staleness can be detected; default is structural (topology + attributes).
 */
export function where(
  domain: Domain,
  label: string,
  test: (data: StructureData, row: number) => boolean,
  deps: readonly RevisionStream[] = ["topology", "attributes"],
): SelectionQuery {
  assertDomain(domain);
  if (typeof test !== "function") {
    fail("where.test", "expected a predicate function");
  }
  if (typeof label !== "string" || !label) {
    fail("where.label", "expected a non-empty label");
  }
  return freezeQuery({
    type: "where",
    domain,
    label,
    test,
    deps: Object.freeze([...deps]),
  });
}

/** Atoms of a given atomic number. */
export function element(z: number): SelectionQuery {
  return where(
    "atom",
    `element=${z}`,
    (data, i) => data.topology.atoms.element[i] === z,
  );
}

/** Residues by chemical component name, e.g. comp(['CYS']). */
export function comp(names: readonly string[]): SelectionQuery {
  const want = new Set(names);
  return where(
    "residue",
    `comp(${[...want].join(",")})`,
    (data, r) => want.has(data.topology.residues.comp[r]),
  );
}

/**
 * Atoms within `cutoff` Angstrom of any atom of the inner selection query.
 * Position-dependent, so it declares a positions dependency and goes stale when
 * coordinates advance.
 */
export function within(cutoff: number, of: SelectionQuery): SelectionQuery {
  if (!Number.isFinite(cutoff) || cutoff < 0) {
    fail("within.cutoff", "expected a non-negative distance");
  }
  if (!of || of.type === undefined) {
    fail("within.of", "expected a SelectionQuery");
  }
  return freezeQuery({
    type: "within",
    domain: "atom",
    cutoff,
    of,
    label: `within(${cutoff},${of.label})`,
    deps: ["topology", "positions"],
  });
}

/**
 * Compile a SelectionExpr (a MolQL expression tree) into an atom-domain query.
 * Compilation is pure and dataset-independent; the label is the canonical
 * S-expression and the revision deps are inferred from the symbols used.
 * Throws a TypeError naming the symbol or argument for anything outside the
 * supported language (see `supportedSymbols`).
 */
export function compile(expr: SelectionExpr): SelectionQuery {
  const compiled = compileExpr(expr);
  return freezeQuery({
    type: "expr",
    domain: "atom",
    label: compiled.label,
    deps: compiled.deps,
    expr: compiled,
  });
}

/** The MolQL symbol names `compile` accepts, sorted. */
export const supportedSymbols: readonly string[] = SUPPORTED_SYMBOLS;

// ---- resolution ------------------------------------------------------------

const sortedUnique = (
  rows: Iterable<number>,
  count: number,
  field: string,
): Uint32Array => {
  const seen = new Uint8Array(count);
  for (const i of rows) {
    if (!Number.isInteger(i) || i < 0 || i >= count) {
      fail(field, `index ${i} out of range for ${count} rows`);
    }
    seen[i] = 1;
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (seen[i]) out.push(i);
  return Uint32Array.from(out);
};

// FNV-1a over the index bytes: a content hash so equal membership yields equal id
// and changed membership yields a different one, independent of the caller label.
const hashIndices = (indices: Uint32Array): string => {
  let h = 0x811c9dc5;
  for (let k = 0; k < indices.length; k++) {
    h ^= indices[k];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

const revisionString = (revisions: Revisions): string =>
  (Object.keys(revisions) as RevisionStream[]).sort().map((k) =>
    `${k}=${revisions[k]}`
  ).join(",");

const dependency = (
  data: StructureData,
  deps: readonly RevisionStream[],
): Revisions => {
  const out: Partial<Record<RevisionStream, number>> = {};
  for (const key of deps) {
    if (data.revision[key] === undefined) {
      fail("deps", `unknown revision stream ${key}`);
    }
    out[key] = data.revision[key];
  }
  return Object.freeze(out);
};

const makeSelection = (
  domain: Domain,
  data: StructureData,
  rawRows: Iterable<number>,
  deps: readonly RevisionStream[],
  label: string,
  source: SourceMap | null,
): Selection => {
  const count = DOMAIN_COUNT[domain](data);
  const indices = sortedUnique(rawRows, count, `${domain} indices`);
  const revisions = dependency(data, deps);
  const token = datasetToken(data);
  const revString = revisionString(revisions);
  return Object.freeze({
    domain,
    dataset: data.identity,
    indices,
    deps: revisions,
    label,
    id: `${domain}@${token}#${revString}:${indices.length}:${
      hashIndices(indices)
    }`,
    source: source ?? null,
  });
};

/** Collapse a query's dep list plus its resolved children into one dep set. */
const mergeDeps = (
  ...lists: (readonly RevisionStream[])[]
): RevisionStream[] => [...new Set(lists.flat())];

const evalQuery = (
  selectionQuery: SelectionQuery,
  data: StructureData,
): Evaluated => {
  if (!selectionQuery || selectionQuery.type === undefined) {
    fail("query", "expected a SelectionQuery");
  }
  const node = selectionQuery as QueryNode;
  switch (node.type) {
    case "all": {
      const count = DOMAIN_COUNT[node.domain](data);
      return {
        domain: node.domain,
        rows: Uint32Array.from({ length: count }, (_, i) => i),
        deps: node.deps,
      };
    }
    case "where": {
      const count = DOMAIN_COUNT[node.domain](data);
      const rows: number[] = [];
      for (let i = 0; i < count; i++) if (node.test(data, i)) rows.push(i);
      return { domain: node.domain, rows, deps: node.deps };
    }
    case "within": {
      const inner = evalQuery(node.of, data);
      const seeds = toAtomRows(inner.domain, inner.rows, data);
      const P = data.positions, c2 = node.cutoff * node.cutoff;
      const rows: number[] = [];
      // Cells at least one cutoff wide, so only neighbouring cells can match.
      const grid = seeds.length
        ? spatialGrid(P, seeds, Math.max(node.cutoff, MIN_CELL))
        : null;
      for (let i = 0; grid && i < data.topology.atoms.count; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const hit = grid.near(x, y, z, (j) => {
          const dx = x - P[j * 3], dy = y - P[j * 3 + 1], dz = z - P[j * 3 + 2];
          return dx * dx + dy * dy + dz * dz <= c2;
        });
        if (hit) rows.push(i);
      }
      return { domain: "atom", rows, deps: mergeDeps(node.deps, inner.deps) };
    }
    case "expr":
      return { domain: "atom", rows: node.expr.run(data), deps: node.deps };
    default:
      return fail(
        "query",
        `unknown query type ${(node as SelectionQuery).type}`,
      );
  }
};

/** Resolve a SelectionQuery against one dataset into a Selection. */
export function resolve(query: SelectionQuery, data: StructureData): Selection {
  assertStructure(data);
  const { domain, rows, deps } = evalQuery(query, data);
  return makeSelection(domain, data, rows, deps, query.label, null);
}

// ---- set operations over resolved selections ------------------------------

const assertSelection = (sel: unknown, field: string): void => {
  const s = sel as Partial<Selection> | null;
  if (!s || !s.id || !s.domain || !s.dataset) {
    fail(field, "expected a resolved Selection");
  }
};

const assertCombinable = (a: Selection, b: Selection): void => {
  assertSelection(a, "left");
  assertSelection(b, "right");
  if (a.dataset !== b.dataset) {
    fail("dataset", "selections come from different datasets");
  }
  if (a.domain !== b.domain) {
    fail("domain", `set operation across domains ${a.domain} and ${b.domain}`);
  }
  for (const key of Object.keys(a.deps) as RevisionStream[]) {
    if (key in b.deps && a.deps[key] !== b.deps[key]) {
      fail(
        "revision",
        `selections read ${key} at revisions ${a.deps[key]} and ${b.deps[key]}`,
      );
    }
  }
};

// A resolved selection knows its domain count from the largest in-range index it
// could hold; set ops re-derive it from the shared dataset via the recorded token
// only for validation, so they rebuild the sorted set directly on the indices.
const combine = (
  a: Selection,
  b: Selection,
  label: string,
  keep: (inA: boolean, inB: boolean) => boolean,
): Selection => {
  assertCombinable(a, b);
  const inA = new Set(a.indices);
  const inB = new Set(b.indices);
  const rows: number[] = [];
  for (const i of a.indices) if (keep(inA.has(i), inB.has(i))) rows.push(i);
  for (const i of b.indices) {
    if (!inA.has(i) && keep(inA.has(i), inB.has(i))) rows.push(i);
  }
  rows.sort((x, y) => x - y);
  const deps: Revisions = Object.freeze({ ...b.deps, ...a.deps });
  const revString = revisionString(deps);
  const indices = Uint32Array.from(rows);
  const token = datasetOrdinals.get(a.dataset);
  return Object.freeze({
    domain: a.domain,
    dataset: a.dataset,
    indices,
    deps,
    label,
    id: `${a.domain}@${token}#${revString}:${indices.length}:${
      hashIndices(indices)
    }`,
    source: null,
  });
};

export function union(a: Selection, b: Selection): Selection {
  return combine(a, b, `(${a.label}|${b.label})`, (x, y) => x || y);
}
export function intersect(a: Selection, b: Selection): Selection {
  return combine(a, b, `(${a.label}&${b.label})`, (x, y) => x && y);
}
export function difference(a: Selection, b: Selection): Selection {
  return combine(a, b, `(${a.label}\\${b.label})`, (x, y) => x && !y);
}

// ---- domain conversions ----------------------------------------------------

const assertOwns = (
  sel: Selection,
  data: StructureData,
  field = "data",
): void => {
  assertSelection(sel, "selection");
  assertStructure(data);
  if (sel.dataset !== data.identity) {
    fail(field, "selection does not belong to this dataset");
  }
};

/** Map rows of any supported domain to the underlying atom rows. */
function toAtomRows(
  domain: Domain,
  rows: ArrayLike<number> & Iterable<number>,
  data: StructureData,
): ArrayLike<number> & Iterable<number> {
  if (domain === "atom") return rows;
  if (domain === "residue") {
    const want = new Set(rows);
    const out: number[] = [];
    const residue = data.topology.atoms.residue;
    for (let i = 0; i < data.topology.atoms.count; i++) {
      if (want.has(residue[i])) out.push(i);
    }
    return out;
  }
  if (domain === "bond") {
    const { a, b } = data.topology.bonds;
    const out: number[] = [];
    for (const r of rows) out.push(a[r], b[r]);
    return out;
  }
  return fail("domain", `cannot expand ${domain} to atoms`);
}

/**
 * Expand a selection to atoms. A residue->atom expansion retains a source map:
 * `source.rows[k]` is the residue row that atom `indices[k]` came from, so picking
 * and field lookup can walk back to the originating identity.
 */
export function toAtoms(sel: Selection, data: StructureData): Selection {
  assertOwns(sel, data);
  if (sel.domain === "atom") return sel;
  if (sel.domain === "residue") {
    const want = new Set(sel.indices);
    const residue = data.topology.atoms.residue;
    const rows: number[] = [], srcRows: number[] = [];
    for (let i = 0; i < data.topology.atoms.count; i++) {
      if (want.has(residue[i])) {
        rows.push(i);
        srcRows.push(residue[i]);
      }
    }
    const selection = makeSelection(
      "atom",
      data,
      rows,
      Object.keys(sel.deps) as RevisionStream[],
      `atoms(${sel.label})`,
      Object.freeze({ domain: "residue", rows: Uint32Array.from(srcRows) }),
    );
    return selection;
  }
  // bond -> atoms: union of both endpoints
  const rows = toAtomRows("bond", sel.indices, data);
  return makeSelection(
    "atom",
    data,
    rows,
    Object.keys(sel.deps) as RevisionStream[],
    `atoms(${sel.label})`,
    null,
  );
}

/** Collapse an atom, residue or bond selection to the residues it touches. */
export function toResidues(sel: Selection, data: StructureData): Selection {
  assertOwns(sel, data);
  if (sel.domain === "residue") return sel;
  const atoms = toAtoms(sel, data).indices;
  const residue = data.topology.atoms.residue;
  const rows: number[] = [];
  for (const i of atoms) rows.push(residue[i]);
  return makeSelection(
    "residue",
    data,
    rows,
    mergeDeps(Object.keys(sel.deps) as RevisionStream[], ["topology"]),
    `residues(${sel.label})`,
    null,
  );
}

/**
 * Bonds incident on a selection. `endpoints: 'both'` keeps only bonds whose two
 * endpoints are both selected; `'either'` keeps any touched bond. Scans the
 * bond rows already present in `data.topology.bonds` (no inference here), and
 * retains a source map of the endpoint atom rows per bond.
 */
export function toBonds(
  sel: Selection,
  data: StructureData,
  options: { readonly endpoints?: "both" | "either" } = {},
): Selection {
  const { endpoints = "both" } = options;
  assertOwns(sel, data);
  if (!["both", "either"].includes(endpoints)) {
    fail("endpoints", "expected both or either");
  }
  const atoms = toAtoms(sel, data).indices;
  const { bonds } = data.topology;
  const selected = new Set(atoms);
  const rows: number[] = [], srcA: number[] = [], srcB: number[] = [];
  for (let r = 0; r < bonds.count; r++) {
    const hitA = selected.has(bonds.a[r]), hitB = selected.has(bonds.b[r]);
    if (endpoints === "both" ? hitA && hitB : hitA || hitB) {
      rows.push(r);
      srcA.push(bonds.a[r]);
      srcB.push(bonds.b[r]);
    }
  }
  return makeSelection(
    "bond",
    data,
    rows,
    mergeDeps(Object.keys(sel.deps) as RevisionStream[], ["topology"]),
    `bonds:${endpoints}(${sel.label})`,
    Object.freeze({
      domain: "atom",
      a: Uint32Array.from(srcA),
      b: Uint32Array.from(srcB),
    }),
  );
}

// ---- staleness & helpers ---------------------------------------------------

/** True once any revision stream the selection read has advanced on `data`. */
export function isStale(sel: Selection, data: StructureData): boolean {
  assertOwns(sel, data);
  return (Object.keys(sel.deps) as RevisionStream[]).some((key) =>
    data.revision[key] !== sel.deps[key]
  );
}

export function isEmpty(sel: Selection): boolean {
  assertSelection(sel, "selection");
  return sel.indices.length === 0;
}
export function count(sel: Selection): number {
  assertSelection(sel, "selection");
  return sel.indices.length;
}
