// @molgpu/select — pure selection queries and dataset-bound resolved selections.
//
// Two concepts, kept deliberately apart (see the architecture review):
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

import {
  activeAtoms,
  attributeColumn,
  spatialGrid,
  ssKind,
  type StructureData,
} from "@molgpu/table";
import {
  type CompiledExpr,
  compileExpr,
  type SelectionExpr,
  SUPPORTED_SYMBOLS,
} from "./expr.ts";
import type { RevisionStream } from "./internal/revision.ts";

export { preserveBondGraph } from "./bond-graph.ts";

export type { SelectionExpr };

// Smallest grid cell for within(); a zero cutoff still needs a positive cell.
const MIN_CELL = 1;

export type Domain = "atom" | "residue" | "bond";

/**
 * A pure, dataset-independent recipe. Build once, resolve against many datasets.
 *
 * Opaque: construct queries with this package's builders and pass them to its
 * evaluators. Dependency, attribute-input and view metadata below are public. Runtime query objects carry further
 * per-kind fields (for example a `where` predicate or a `within` cutoff) that
 * are internal and may change in any release.
 */
/** Molecular row eligibility, without removing or reordering source rows. */
export interface SelectionView {
  readonly model?: "first" | "all" | number;
  readonly altloc?: "primary" | "all";
}

export interface SelectionQuery {
  readonly type: string;
  readonly domain: Domain;
  readonly label: string;
  readonly deps: readonly ("topology" | "positions" | "attributes")[];
  /** Named column inputs; null means an opaque attributes-dependent predicate. */
  readonly attributes: readonly string[] | null;
  /** Explicit view axes; missing axes inherit the caller's evaluation defaults. */
  readonly view: SelectionView;
}

/** A query resolved against one dataset: identity-, domain-, and revision-bound. */
export interface Selection {
  readonly domain: Domain;
  /** The originating StructureData identity; compared by reference for set ops. */
  readonly dataset: StructureData["identity"];
  /** Sorted unique rows. Treat as immutable; `id` and viewer caches assume it. */
  readonly indices: Uint32Array;
  /** Revision of each stream the resolution read, for staleness and set-op checks. */
  readonly deps: Readonly<
    Partial<Record<"topology" | "positions" | "attributes", number>>
  >;
  /** Human label from the query; NOT the cache key. */
  readonly label: string;
  /** Library-owned identity derived from dataset, revisions, and membership. */
  readonly id: string;
  readonly source:
    | { readonly domain: "residue"; readonly rows: Uint32Array }
    | {
      readonly domain: "atom";
      readonly a: Uint32Array;
      readonly b: Uint32Array;
    }
    | null;
}

type SourceMap =
  | { readonly domain: "residue"; readonly rows: Uint32Array }
  | {
    readonly domain: "atom";
    readonly a: Uint32Array;
    readonly b: Uint32Array;
  };

type Revisions = Readonly<Partial<Record<RevisionStream, number>>>;
type Predicate = (data: StructureData, row: number) => boolean;

// The query node kinds. SelectionQuery is deliberately opaque in the public
// types (x24.11); only this module reads the per-kind fields.
type QueryNode =
  & { readonly scopeConflicts?: readonly (keyof SelectionView)[] }
  & (
    | (SelectionQuery & { readonly type: "all" })
    | (SelectionQuery & { readonly type: "where"; readonly test: Predicate })
    | (SelectionQuery & {
      readonly type: "within";
      readonly cutoff: number;
      readonly of: SelectionQuery;
    })
    | (SelectionQuery & { readonly type: "expr"; readonly expr: CompiledExpr })
    | (SelectionQuery & {
      readonly type: "attribute";
      readonly name: string;
      readonly test: (value: number) => boolean;
    })
    | (SelectionQuery & {
      readonly type: "and" | "or";
      readonly queries: readonly SelectionQuery[];
    })
    | (SelectionQuery & {
      readonly type: "not" | "view";
      readonly of: SelectionQuery;
    })
  );

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

const freezeQuery = (node: QueryNode): SelectionQuery =>
  Object.freeze({
    ...node,
    deps: Object.freeze([...new Set(node.deps)]),
    attributes: node.attributes === null
      ? null
      : Object.freeze([...new Set(node.attributes)]),
    view: Object.freeze({ ...node.view }),
  });

const assertQuery = (query: SelectionQuery): void => {
  if (!query || typeof query.type !== "string") {
    fail("query", "expected a SelectionQuery");
  }
};

const checkedView = (view: SelectionView): SelectionView => {
  if (!view || typeof view !== "object") fail("view", "expected a view policy");
  const { model, altloc } = view;
  if (
    model !== undefined && model !== "first" && model !== "all" &&
    !Number.isInteger(model)
  ) {
    fail("view.model", "expected first, all, or an integer model id");
  }
  if (altloc !== undefined && altloc !== "primary" && altloc !== "all") {
    fail("view.altloc", "expected primary or all");
  }
  return Object.freeze({
    ...(model === undefined ? {} : { model }),
    ...(altloc === undefined ? {} : { altloc }),
  });
};

/** Merge explicit axes without guessing how conflicting model scopes compose. */
const queryInputs = (
  queries: readonly SelectionQuery[],
  override: SelectionView = {},
) => {
  for (const query of queries) assertQuery(query);
  const view: {
    model?: SelectionView["model"];
    altloc?: SelectionView["altloc"];
  } = {};
  const scopeConflicts = new Set<keyof SelectionView>();
  for (const key of ["model", "altloc"] as const) {
    const values = new Set(
      queries.map((q) => q.view[key]).filter((v) => v !== undefined),
    );
    if (override[key] !== undefined) {
      Object.assign(view, { [key]: override[key] });
    } else if (
      values.size > 1 ||
      queries.some((q) => (q as QueryNode).scopeConflicts?.includes(key))
    ) scopeConflicts.add(key);
    else if (values.size === 1) Object.assign(view, { [key]: [...values][0] });
  }
  return {
    deps: [...new Set(queries.flatMap((q) => q.deps))],
    attributes: queries.some((q) => q.attributes === null)
      ? null
      : [...new Set(queries.flatMap((q) => q.attributes!))],
    view,
    scopeConflicts: Object.freeze([...scopeConflicts]),
  };
};

/** Every row of a domain. */
export function all(domain: Domain = "atom"): SelectionQuery {
  assertDomain(domain);
  return freezeQuery({
    type: "all",
    domain,
    label: `all:${domain}`,
    deps: ["topology"],
    attributes: [],
    view: {},
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
  deps: readonly ("topology" | "positions" | "attributes")[] = [
    "topology",
    "attributes",
  ],
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
    attributes: deps.includes("attributes") ? null : [],
    view: {},
  });
}

/** Atoms of a given atomic number. */
export function element(z: number): SelectionQuery {
  return Object.freeze({
    ...attribute("element", (value) => value === z),
    label: `element=${z}`,
  });
}

/** Residues by chemical component name, e.g. comp(['CYS']). */
export function comp(names: readonly string[]): SelectionQuery {
  const want = new Set(names);
  return where(
    "residue",
    `comp(${[...want].join(",")})`,
    (data, r) => want.has(data.topology.residues.comp[r]),
    ["topology"],
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
    ...queryInputs([of]),
    deps: [...new Set<RevisionStream>(["topology", "positions", ...of.deps])],
  });
}

/** Atoms passing a named atom or residue column predicate (residue values lift). */
export function attribute(
  name: string,
  test: (value: number) => boolean,
): SelectionQuery {
  if (typeof name !== "string" || !name) {
    fail("attribute.name", "expected a non-empty column name");
  }
  if (typeof test !== "function") {
    fail("attribute.test", "expected a predicate");
  }
  return freezeQuery({
    type: "attribute",
    domain: "atom",
    name,
    test,
    label: `attribute(${name})`,
    deps: ["topology", "attributes"],
    attributes: [name],
    view: {},
  });
}

/** Intersection of query values, normalizing residue/bond inputs to atom rows. */
export function and(
  first: SelectionQuery,
  ...others: SelectionQuery[]
): SelectionQuery {
  return booleanQuery("and", [first, ...others]);
}

/** Union of query values, normalizing residue/bond inputs to atom rows. */
export function or(
  first: SelectionQuery,
  ...others: SelectionQuery[]
): SelectionQuery {
  return booleanQuery("or", [first, ...others]);
}

const booleanQuery = (
  type: "and" | "or",
  queries: readonly SelectionQuery[],
): SelectionQuery => {
  const inputs = queryInputs(queries);
  return freezeQuery({
    type,
    domain: "atom",
    queries: Object.freeze([...queries]),
    label: `${type}(${queries.map((q) => q.label).join(",")})`,
    ...inputs,
    deps: [...new Set<RevisionStream>(["topology", ...inputs.deps])],
  });
};

/** Complement within the evaluation's eligible atom universe. */
export function not(of: SelectionQuery): SelectionQuery {
  const inputs = queryInputs([of]);
  return freezeQuery({
    type: "not",
    domain: "atom",
    of,
    label: `not(${of.label})`,
    ...inputs,
    deps: [...new Set<RevisionStream>(["topology", ...inputs.deps])],
  });
}

/** Override explicit query scopes; missing axes retain compatible child scopes. */
export function withView(
  of: SelectionQuery,
  view: SelectionView,
): SelectionQuery {
  const override = checkedView(view);
  const inputs = queryInputs([of], override);
  return freezeQuery({
    type: "view",
    domain: of.domain,
    of,
    label: `view(${JSON.stringify(override)},${of.label})`,
    ...inputs,
  });
}

/** Every model, with the caller's conformer default. */
export function allModels(): SelectionQuery {
  return withView(all(), { model: "all" });
}

/** Every conformer, with the caller's model default. */
export function allConformers(): SelectionQuery {
  return withView(all(), { altloc: "all" });
}

/** Atoms of a model id, declaring that explicit model scope. */
export function model(id: number): SelectionQuery {
  if (!Number.isInteger(id)) fail("model", "expected an integer model id");
  return withView(
    structural("atom", `model(${id})`, (data, atom) =>
      data.topology.chains
        .model[
          data.topology.residues.chain[data.topology.atoms.residue[atom]]
        ] === id),
    { model: id },
  );
}

const structural = (
  domain: Domain,
  label: string,
  test: Predicate,
): SelectionQuery => where(domain, label, test, ["topology"]);

/** Atoms classified as protein polymers by the source table. */
export function protein(): SelectionQuery {
  return structural(
    "atom",
    "protein",
    (data, atom) =>
      data.topology.residues.polymer[data.topology.atoms.residue[atom]] ===
        "protein",
  );
}

/** Atoms classified as DNA or RNA polymers by the source table. */
export function nucleic(): SelectionQuery {
  return structural(
    "atom",
    "nucleic",
    (data, atom) =>
      ["dna", "rna"].includes(
        data.topology.residues.polymer[data.topology.atoms.residue[atom]],
      ),
  );
}

const WATER_NAMES = new Set(["HOH", "WAT", "H2O", "DOD"]);
const waterResidue = (data: StructureData, row: number): boolean => {
  const { residues, chains } = data.topology;
  const type = chains.entityType?.[residues.chain[row]];
  return type ? type === "water" : WATER_NAMES.has(residues.comp[row]);
};

/** Water entity atoms; without entity metadata, HOH/WAT/H2O/DOD components. */
export function water(): SelectionQuery {
  return structural(
    "atom",
    "water",
    (data, atom) => waterResidue(data, data.topology.atoms.residue[atom]),
  );
}

/** Non-protein/non-nucleic, non-water atoms; includes ions and other nonpolymers. */
export function ligand(): SelectionQuery {
  return structural("atom", "ligand", (data, atom) => {
    const row = data.topology.atoms.residue[atom];
    return data.topology.residues.polymer[row] === "other" &&
      !waterResidue(data, row);
  });
}

/** Atoms of an author chain id by default; label namespace is explicit. */
export function chain(
  id: string,
  options: { readonly namespace?: "auth" | "label" } = {},
): SelectionQuery {
  if (typeof id !== "string") fail("chain.id", "expected a string");
  const namespace = options.namespace ?? "auth";
  if (namespace !== "auth" && namespace !== "label") {
    fail("chain.namespace", "expected auth or label");
  }
  return structural("atom", `chain(${namespace}:${id})`, (data, atom) => {
    const row = data.topology.residues.chain[data.topology.atoms.residue[atom]];
    return data.topology
      .chains[namespace === "auth" ? "authId" : "labelId"][row] === id;
  });
}

/** Atoms of inclusive integer sequence numbers, retaining insertion-code variants. */
export function residues(
  range: readonly [number, number],
  options: { readonly namespace?: "auth" | "label" } = {},
): SelectionQuery {
  if (
    !Array.isArray(range) || range.length !== 2 ||
    !range.every(Number.isInteger) || range[0] > range[1]
  ) {
    fail(
      "residues.range",
      "expected an ordered pair of integer sequence numbers",
    );
  }
  const [lo, hi] = range;
  const namespace = options.namespace ?? "auth";
  if (namespace !== "auth" && namespace !== "label") {
    fail("residues.namespace", "expected auth or label");
  }
  return structural(
    "atom",
    `residues(${namespace}:${lo}-${hi})`,
    (data, atom) => {
      const row = data.topology.atoms.residue[atom];
      const value = namespace === "auth"
        ? Number.parseInt(data.topology.residues.authSeq[row], 10)
        : data.topology.residues.labelSeq[row];
      return !(namespace === "label" && value === -1) && value >= lo &&
        value <= hi;
    },
  );
}

/** Polymer helix H/G/I, sheet E/B, or coil according to table ssKind. */
export function secondaryStructure(
  kind: "helix" | "sheet" | "coil",
): SelectionQuery {
  if (!["helix", "sheet", "coil"].includes(kind)) {
    fail("secondaryStructure", "expected helix, sheet or coil");
  }
  return Object.freeze({
    ...and(
      or(protein(), nucleic()),
      attribute("ssCode", (code) => ssKind(code) === kind),
    ),
    label: `secondaryStructure(${kind})`,
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
    attributes: compiled.deps.includes("attributes") ? null : [],
    view: {},
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

interface Eligibility {
  readonly atoms: Uint32Array;
  readonly atomMask: Uint8Array;
  readonly residueMask: Uint8Array;
}

const eligibility = (data: StructureData, view: SelectionView): Eligibility => {
  const atoms = activeAtoms(data, view);
  const atomMask = new Uint8Array(data.topology.atoms.count);
  const residueMask = new Uint8Array(data.topology.residues.count);
  for (const atom of atoms) {
    atomMask[atom] = 1;
    residueMask[data.topology.atoms.residue[atom]] = 1;
  }
  return { atoms, atomMask, residueMask };
};

const eligibleRow = (
  domain: Domain,
  row: number,
  data: StructureData,
  scope?: Eligibility,
): boolean => {
  if (!scope) return true;
  if (domain === "atom") return !!scope.atomMask[row];
  if (domain === "residue") return !!scope.residueMask[row];
  return !!scope.atomMask[data.topology.bonds.a[row]] &&
    !!scope.atomMask[data.topology.bonds.b[row]];
};

const evaluatedAtoms = (
  result: Evaluated,
  data: StructureData,
  scope?: Eligibility,
): Uint32Array =>
  sortedUnique(
    Array.from(toAtomRows(result.domain, result.rows, data)).filter((row) =>
      !scope || scope.atomMask[row]
    ),
    data.topology.atoms.count,
    "atom indices",
  );

const evalQuery = (
  selectionQuery: SelectionQuery,
  data: StructureData,
  scope?: Eligibility,
): Evaluated => {
  assertQuery(selectionQuery);
  const node = selectionQuery as QueryNode;
  switch (node.type) {
    case "all": {
      const count = DOMAIN_COUNT[node.domain](data);
      return {
        domain: node.domain,
        rows: Uint32Array.from({ length: count }, (_, i) => i).filter((row) =>
          eligibleRow(node.domain, row, data, scope)
        ),
        deps: node.deps,
      };
    }
    case "where": {
      const count = DOMAIN_COUNT[node.domain](data);
      const rows: number[] = [];
      for (let i = 0; i < count; i++) {
        if (eligibleRow(node.domain, i, data, scope) && node.test(data, i)) {
          rows.push(i);
        }
      }
      return { domain: node.domain, rows, deps: node.deps };
    }
    case "attribute": {
      const column = attributeColumn(data, node.name);
      if (!column) return fail("attribute", `missing column '${node.name}'`);
      const rows: number[] = [];
      const { atoms } = data.topology;
      for (let atom = 0; atom < atoms.count; atom++) {
        if (
          eligibleRow("atom", atom, data, scope) &&
          node.test(
            column
              .values[column.domain === "atom" ? atom : atoms.residue[atom]],
          )
        ) rows.push(atom);
      }
      return { domain: "atom", rows, deps: node.deps };
    }
    case "and":
    case "or": {
      let result: Set<number> | undefined;
      for (const query of node.queries) {
        const child = new Set(
          evaluatedAtoms(evalQuery(query, data, scope), data, scope),
        );
        if (!result) result = child;
        else if (node.type === "or") {
          for (const atom of child) result.add(atom);
        } else {for (const atom of result) {
            if (!child.has(atom)) result.delete(atom);
          }}
      }
      return { domain: "atom", rows: [...(result ?? [])], deps: node.deps };
    }
    case "not": {
      const child = new Set(
        evaluatedAtoms(evalQuery(node.of, data, scope), data, scope),
      );
      const universe = scope?.atoms ??
        Uint32Array.from({ length: data.topology.atoms.count }, (_, i) => i);
      return {
        domain: "atom",
        rows: universe.filter((atom) => !child.has(atom)),
        deps: node.deps,
      };
    }
    case "view":
      return evalQuery(node.of, data, scope);
    case "within": {
      const inner = evalQuery(node.of, data, scope);
      const seeds = evaluatedAtoms(inner, data, scope);
      const P = data.positions, c2 = node.cutoff * node.cutoff;
      const rows: number[] = [];
      // Cells at least one cutoff wide, so only neighbouring cells can match.
      const grid = seeds.length
        ? spatialGrid(P, seeds, Math.max(node.cutoff, MIN_CELL))
        : null;
      for (let i = 0; grid && i < data.topology.atoms.count; i++) {
        if (!eligibleRow("atom", i, data, scope)) continue;
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
      return {
        domain: "atom",
        rows: node.expr.run(data, scope?.atoms),
        deps: node.deps,
      };
    default:
      return fail(
        "query",
        `unknown query type ${(node as SelectionQuery).type}`,
      );
  }
};

/**
 * Resolve against one dataset. Without a view (explicit query or caller), the
 * existing full-table/domain behavior is retained. Scoped resolution returns
 * eligible atom rows even for a residue/bond query, without editing the table.
 * Query scopes override caller defaults; withView overrides inherited conflicts.
 */
export function resolve(
  query: SelectionQuery,
  data: StructureData,
  options: { readonly view?: SelectionView } = {},
): Selection {
  assertStructure(data);
  assertQuery(query);
  const conflicts = (query as QueryNode).scopeConflicts;
  if (conflicts?.length) {
    fail(
      "view",
      `conflicting ${conflicts.join(", ")} scopes; use withView() to override`,
    );
  }
  const defaults = options.view === undefined ? {} : checkedView(options.view);
  const explicit = checkedView(query.view);
  const scoped = options.view !== undefined || Object.keys(explicit).length > 0;
  const policy = {
    model: "all",
    altloc: "all",
    ...defaults,
    ...explicit,
  } as const;
  const scope = scoped ? eligibility(data, policy) : undefined;
  const result = evalQuery(query, data, scope);
  const deps = mergeDeps(
    result.deps,
    scope
      ? [
        "topology",
        ...(policy.altloc === "primary" ? ["attributes" as const] : []),
      ]
      : [],
  );
  return makeSelection(
    scope ? "atom" : result.domain,
    data,
    scope ? evaluatedAtoms(result, data, scope) : result.rows,
    deps,
    query.label,
    null,
  );
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
    const out: number[] = [];
    forEachResidueAtom(rows, data, (atom) => out.push(atom));
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

/** Visit selected residue members once, shared by query and public conversions. */
function forEachResidueAtom(
  rows: Iterable<number>,
  data: StructureData,
  visit: (atom: number, residue: number) => void,
): void {
  const want = new Set(rows);
  const residue = data.topology.atoms.residue;
  for (let atom = 0; atom < data.topology.atoms.count; atom++) {
    if (want.has(residue[atom])) visit(atom, residue[atom]);
  }
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
    const rows: number[] = [], srcRows: number[] = [];
    forEachResidueAtom(sel.indices, data, (atom, sourceResidue) => {
      rows.push(atom);
      srcRows.push(sourceResidue);
    });
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
