// SelectionExpr: the MolQL expression tree as @molgpu/select's query IR, and its
// evaluator.
//
// The tree has the same shape as Mol*'s mol-script Expression (a literal, a
// symbol `{ name }` or a call `{ head, args }`), but this module declares it
// itself and never imports molstar. Parsing text (MolScript, PyMOL, VMD, Jmol)
// lives in @molgpu/io. Evaluation is ours: each supported symbol ports the
// semantics of Mol*'s runtime (mol-script/runtime/query/table.js and
// mol-model/structure/query/queries/*) onto StructureData rows.
//
// The language is closed. Only the symbols in SPECS below compile; anything
// else, including an unsupported argument of a supported symbol, throws at
// compile time. Adding a symbol needs its own bead (lkd.14 as amended by
// molgpu-sept-922.1; docs/findings/2026-09-26-molql-selection-spike.md §4.7).

import {
  type Bonds,
  bondTopology,
  spatialGrid,
  type StructureData,
} from "@molgpu/table";
import {
  type AtomSets,
  EMPTY,
  flatten,
  forEachSet,
  intersectRows,
  SetBuilder,
  setCount,
  singletons,
  sortedRows,
  subtractRows,
} from "./atom-sets.ts";
import { ELEMENT_SYMBOL, ELEMENT_VDW_RADIUS } from "./elements.ts";
import type { RevisionStream } from "./index.ts";
import {
  bondAdjacency,
  type TopologyCache,
  topologyCache,
} from "./topology-cache.ts";

/**
 * A MolQL expression: a literal, a symbol reference, or a symbol call with
 * positional or named arguments. Plain JSON; symbol names are the full MolQL
 * ids, for example `structure-query.generator.atom-groups` or `core.rel.eq`.
 */
export type SelectionExpr =
  | string
  | number
  | boolean
  | { readonly name: string }
  | {
    readonly head: SelectionExpr;
    readonly args?:
      | readonly SelectionExpr[]
      | { readonly [name: string]: SelectionExpr };
  };

/** A compiled expression: dataset-independent, evaluated per resolve. */
export interface CompiledExpr {
  readonly label: string;
  readonly deps: readonly RevisionStream[];
  run(data: StructureData): Uint32Array;
}

const fail = (message: string): never => {
  throw new TypeError(`@molgpu/select expr: ${message}`);
};

// ---- evaluation context ------------------------------------------------------

interface Ctx {
  readonly data: StructureData;
  readonly topo: TopologyCache;
  /** Atoms a generator may see; query-in-selection narrows it. Sorted. */
  readonly input: Uint32Array;
  /** Current atom for atom-property symbols. */
  atom: number;
  /** Current bond row for bond-property symbols; -1 outside a bond test. */
  bond: number;
  /** The bonds `bond` indexes: bondTopology(data), set during a bond test. */
  bonds: Bonds | null;
  /** Current atom set for atom-set symbols, set while a filter tests a set. */
  current: Uint32Array | null;
}

type Fn = (ctx: Ctx) => unknown;
type QueryFn = (ctx: Ctx) => AtomSets;
type Kind = "query" | "value";

interface Compiled {
  readonly fn: Fn;
  readonly kind: Kind;
  readonly isConst: boolean;
}

interface Args {
  readonly list: readonly Compiled[];
  readonly named: ReadonlyMap<string, Compiled>;
}

const withAtom = (ctx: Ctx, atom: number): Ctx => {
  ctx.atom = atom;
  return ctx;
};

const childCtx = (ctx: Ctx, input: Uint32Array): Ctx => ({
  data: ctx.data,
  topo: ctx.topo,
  input,
  atom: -1,
  bond: -1,
  bonds: null,
  current: null,
});

// ---- symbol table --------------------------------------------------------------

interface Spec {
  readonly returns: Kind;
  /** Pure in its arguments: folded to a constant when every argument is. */
  readonly pure?: boolean;
  /** Accepted arguments: kind and whether required. Other keys are rejected. */
  readonly args?: Readonly<Record<string, readonly [Kind, boolean]>>;
  /** Variadic positional arguments of one kind. */
  readonly list?: Kind;
  /** Revision stream this symbol reads, beyond topology. */
  readonly reads?: RevisionStream;
  readonly impl: (a: Args) => Fn;
}

const arg = (a: Args, key: string): Fn => a.named.get(key)!.fn;
const optArg = (a: Args, key: string): Fn | undefined => a.named.get(key)?.fn;
const query = (a: Args, key: string): QueryFn => arg(a, key) as QueryFn;

const V: readonly [Kind, boolean] = ["value", true];
const Vopt: readonly [Kind, boolean] = ["value", false];
const Q: readonly [Kind, boolean] = ["query", true];

const unary = (f: (x: number) => number): Spec => ({
  returns: "value",
  pure: true,
  args: { 0: V },
  impl: (a) => {
    const x = arg(a, "0");
    return (ctx) => f(x(ctx) as number);
  },
});
const binary = (f: (x: never, y: never) => unknown): Spec => ({
  returns: "value",
  pure: true,
  args: { 0: V, 1: V },
  impl: (a) => {
    const x = arg(a, "0"), y = arg(a, "1");
    return (ctx) => f(x(ctx) as never, y(ctx) as never);
  },
});
const variadic = (
  f: (xs: unknown[]) => unknown,
): Spec => ({
  returns: "value",
  pure: true,
  list: "value",
  impl: (a) => {
    const fns = a.list.map((c) => c.fn);
    return (ctx) => f(fns.map((fn) => fn(ctx)));
  },
});
const fold = (
  init: number,
  step: (acc: number, x: number) => number,
): Spec =>
  // Wrap `step`: reduce also passes (index, array), which Math.min/max would read.
  variadic((xs) => (xs as number[]).reduce((acc, x) => step(acc, x), init));

// Our secondary-structure bit flags. Values are internal to this evaluator;
// the names and implied bits follow Mol*'s secondaryStructureFlag().
const SS = {
  NA: 1,
  Helix: 2,
  Beta: 4,
  Bend: 8,
  Turn: 16,
  BetaSheet: 32,
  BetaStrand: 64,
  HelixAlpha: 128,
  Helix3Ten: 256,
  HelixPi: 512,
} as const;
const ssFlag = (name: string): number => {
  switch (name.toLowerCase()) {
    case "helix":
      return SS.Helix;
    case "alpha":
      return SS.Helix | SS.HelixAlpha;
    case "pi":
      return SS.Helix | SS.HelixPi;
    case "310":
      return SS.Helix | SS.Helix3Ten;
    case "beta":
      return SS.Beta;
    case "strand":
      return SS.Beta | SS.BetaStrand;
    case "sheet":
      return SS.Beta | SS.BetaSheet;
    case "turn":
      return SS.Turn;
    case "bend":
      return SS.Bend;
    case "coil":
      return SS.NA;
    default:
      return 0;
  }
};
// Residue annotation -> flags. Coil carries no bits, as in Mol*'s model
// secondary structure (so has-any(flags, 0) is false for it).
const RESIDUE_SS: Readonly<Record<string, number>> = {
  helix: SS.Helix,
  sheet: SS.Beta | SS.BetaSheet,
  coil: 0,
};

const atomProp = (
  get: (ctx: Ctx, atom: number) => unknown,
  reads?: RevisionStream,
): Spec => ({
  returns: "value",
  reads,
  impl: () => (ctx) => {
    if (ctx.atom < 0) fail("atom property used outside an atom test");
    return get(ctx, ctx.atom);
  },
});
const residueOf = (ctx: Ctx, atom: number) =>
  ctx.data.topology.atoms.residue[atom];
const chainOf = (ctx: Ctx, atom: number) => ctx.topo.atomChain[atom];

const bondProp = (
  get: (ctx: Ctx, bonds: Bonds, bond: number) => unknown,
  reads?: RevisionStream,
): Spec => ({
  returns: "value",
  reads,
  impl: () => (ctx) => {
    if (ctx.bond < 0 || !ctx.bonds) {
      fail("bond property used outside a bond test");
    }
    return get(ctx, ctx.bonds!, ctx.bond);
  },
});

const vdw = (ctx: Ctx, atom: number): number =>
  ELEMENT_VDW_RADIUS[ctx.data.topology.atoms.element[atom]];

const SQ = "structure-query.";
const AP = `${SQ}atom-property.`;

const SPECS: Readonly<Record<string, Spec>> = {
  // ---- core: types ----
  "core.type.bool": unary((x) => !!x as unknown as number),
  "core.type.num": unary((x) => +x),
  "core.type.str": {
    returns: "value",
    pure: true,
    args: { 0: V },
    impl: (a) => {
      const x = arg(a, "0");
      return (ctx) => "" + x(ctx);
    },
  },
  "core.type.regex": {
    returns: "value",
    pure: true,
    args: { 0: V, 1: Vopt },
    impl: (a) => {
      const src = arg(a, "0"), flags = optArg(a, "1");
      return (ctx) =>
        new RegExp(src(ctx) as string, (flags?.(ctx) as string) || "");
    },
  },
  "core.type.list": variadic((xs) => xs),
  "core.type.set": variadic((xs) => new Set(xs)),
  "core.type.composite-key": variadic((xs) => xs.map(String).join("-")),

  // ---- core: logic ----
  "core.logic.not": {
    returns: "value",
    pure: true,
    args: { 0: V },
    impl: (a) => {
      const x = arg(a, "0");
      return (ctx) => !x(ctx);
    },
  },
  "core.logic.and": {
    returns: "value",
    pure: true,
    list: "value",
    impl: (a) => {
      const fns = a.list.map((c) => c.fn);
      return (ctx) => {
        for (const fn of fns) if (!fn(ctx)) return false;
        return true;
      };
    },
  },
  "core.logic.or": {
    returns: "value",
    pure: true,
    list: "value",
    impl: (a) => {
      const fns = a.list.map((c) => c.fn);
      return (ctx) => {
        for (const fn of fns) if (fn(ctx)) return true;
        return false;
      };
    },
  },

  // ---- core: relations ----
  "core.rel.eq": binary((x, y) => x === y),
  "core.rel.neq": binary((x, y) => x !== y),
  "core.rel.lt": binary((x, y) => x < y),
  "core.rel.lte": binary((x, y) => x <= y),
  "core.rel.gr": binary((x, y) => x > y),
  "core.rel.gre": binary((x, y) => x >= y),
  "core.rel.in-range": {
    returns: "value",
    pure: true,
    args: { 0: V, 1: V, 2: V },
    impl: (a) => {
      const x = arg(a, "0"), lo = arg(a, "1"), hi = arg(a, "2");
      return (ctx) => {
        const v = x(ctx) as number;
        return v >= (lo(ctx) as number) && v <= (hi(ctx) as number);
      };
    },
  },

  // ---- core: math ----
  "core.math.add": fold(0, (s, x) => s + x),
  "core.math.sub": variadic((xs) => {
    const ns = xs as number[];
    if (ns.length === 1) return -ns[0];
    let r = ns[0] || 0;
    for (let k = 1; k < ns.length; k++) r -= ns[k];
    return r;
  }),
  "core.math.mult": fold(1, (s, x) => s * x),
  "core.math.min": fold(Infinity, Math.min),
  "core.math.max": fold(-Infinity, Math.max),
  "core.math.div": binary((x: number, y: number) => x / y),
  "core.math.pow": binary(Math.pow),
  "core.math.mod": binary((x: number, y: number) => x % y),
  "core.math.atan2": binary(Math.atan2),
  "core.math.floor": unary(Math.floor),
  "core.math.ceil": unary(Math.ceil),
  "core.math.round-int": unary(Math.round),
  "core.math.trunc": unary(Math.trunc),
  "core.math.abs": unary(Math.abs),
  "core.math.sign": unary(Math.sign),
  "core.math.sqrt": unary(Math.sqrt),
  "core.math.cbrt": unary(Math.cbrt),
  "core.math.sin": unary(Math.sin),
  "core.math.cos": unary(Math.cos),
  "core.math.tan": unary(Math.tan),
  "core.math.asin": unary(Math.asin),
  "core.math.acos": unary(Math.acos),
  "core.math.atan": unary(Math.atan),
  "core.math.sinh": unary(Math.sinh),
  "core.math.cosh": unary(Math.cosh),
  "core.math.tanh": unary(Math.tanh),
  "core.math.exp": unary(Math.exp),
  "core.math.log": unary(Math.log),
  "core.math.log10": unary(Math.log10),

  // ---- core: strings, lists, sets, flags ----
  "core.str.concat": variadic((xs) => xs.map(String).join("")),
  "core.str.match": binary((re: RegExp, s: string) => re.test(s)),
  "core.list.get-at": binary((xs: unknown[], i: number) => xs[i]),
  "core.list.equal": binary((xs: unknown[], ys: unknown[]) =>
    xs.length === ys.length && xs.every((x, k) => x === ys[k])
  ),
  "core.set.has": binary((s: Set<unknown>, x: unknown) => s.has(x)),
  "core.set.is-subset": binary((s: Set<unknown>, of: Set<unknown>) => {
    for (const x of s) if (!of.has(x)) return false;
    return true;
  }),
  "core.flags.has-any": binary((tested: number, test: number) =>
    test ? (tested & test) !== 0 : !!tested
  ),
  "core.flags.has-all": binary((tested: number, test: number) =>
    test ? (tested & test) === test : !tested
  ),

  // ---- structure-query: type constructors ----
  [`${SQ}type.element-symbol`]: {
    returns: "value",
    pure: true,
    args: { 0: V },
    impl: (a) => {
      const x = arg(a, "0");
      return (ctx) => String(x(ctx)).toUpperCase();
    },
  },
  [`${SQ}type.atom-name`]: {
    returns: "value",
    pure: true,
    args: { 0: V },
    impl: (a) => {
      const x = arg(a, "0");
      return (ctx) => String(x(ctx)).toUpperCase();
    },
  },
  [`${SQ}type.secondary-structure-flags`]: variadic((xs) =>
    xs.reduce((f: number, x) => f | ssFlag(String(x)), 0)
  ),

  // ---- structure-query: atom properties ----
  [`${AP}core.element-symbol`]: atomProp((ctx, i) =>
    ELEMENT_SYMBOL[ctx.data.topology.atoms.element[i]] ?? ""
  ),
  [`${AP}core.atomic-number`]: atomProp((ctx, i) =>
    ctx.data.topology.atoms.element[i]
  ),
  [`${AP}core.x`]: atomProp((ctx, i) => ctx.data.positions[i * 3], "positions"),
  [`${AP}core.y`]: atomProp(
    (ctx, i) => ctx.data.positions[i * 3 + 1],
    "positions",
  ),
  [`${AP}core.z`]: atomProp(
    (ctx, i) => ctx.data.positions[i * 3 + 2],
    "positions",
  ),
  [`${AP}core.atom-key`]: atomProp((_, i) => i),
  [`${AP}macromolecular.residue-key`]: atomProp(residueOf),
  [`${AP}macromolecular.chain-key`]: atomProp(chainOf),
  [`${AP}macromolecular.id`]: atomProp((ctx, i) => ctx.topo.atomId[i]),
  [`${AP}macromolecular.label_atom_id`]: atomProp((ctx, i) =>
    ctx.data.topology.atoms.name[i]
  ),
  [`${AP}macromolecular.auth_atom_id`]: atomProp((ctx, i) =>
    ctx.data.topology.atoms.name[i]
  ),
  [`${AP}macromolecular.label_alt_id`]: atomProp((ctx, i) =>
    ctx.data.topology.atoms.altloc[i]
  ),
  [`${AP}macromolecular.label_comp_id`]: atomProp((ctx, i) =>
    ctx.data.topology.residues.comp[residueOf(ctx, i)]
  ),
  [`${AP}macromolecular.auth_comp_id`]: atomProp((ctx, i) =>
    ctx.data.topology.residues.comp[residueOf(ctx, i)]
  ),
  // The table stores a missing label_seq_id (non-polymers) as -1; Mol* reads 0.
  [`${AP}macromolecular.label_seq_id`]: atomProp((ctx, i) =>
    Math.max(0, ctx.data.topology.residues.labelSeq[residueOf(ctx, i)])
  ),
  [`${AP}macromolecular.auth_seq_id`]: atomProp((ctx, i) =>
    ctx.topo.authSeq[residueOf(ctx, i)]
  ),
  [`${AP}macromolecular.pdbx_PDB_ins_code`]: atomProp((ctx, i) =>
    ctx.data.topology.residues.insertionCode[residueOf(ctx, i)]
  ),
  [`${AP}macromolecular.label_asym_id`]: atomProp((ctx, i) =>
    ctx.data.topology.chains.labelId[chainOf(ctx, i)]
  ),
  [`${AP}macromolecular.auth_asym_id`]: atomProp((ctx, i) =>
    ctx.data.topology.chains.authId[chainOf(ctx, i)]
  ),
  [`${AP}macromolecular.occupancy`]: atomProp(
    (ctx, i) => ctx.data.topology.atoms.occupancy[i],
    "attributes",
  ),
  [`${AP}macromolecular.B_iso_or_equiv`]: atomProp(
    (ctx, i) => ctx.data.topology.atoms.bfactor[i],
    "attributes",
  ),
  [`${AP}macromolecular.secondary-structure-flags`]: atomProp((ctx, i) => {
    const ss = ctx.data.topology.residues.secondaryStructure;
    if (!ss) {
      fail(
        "secondary-structure-flags needs residues.secondaryStructure on the structure",
      );
    }
    return RESIDUE_SS[ss![residueOf(ctx, i)]] ?? 0;
  }),

  // ---- structure-query: bond properties (inside a bond-test) ----
  [`${SQ}bond-property.order`]: bondProp((_, bonds, r) => bonds.order[r]),
  [`${SQ}bond-property.length`]: bondProp((ctx, bonds, r) => {
    const { a, b } = bonds, P = ctx.data.positions;
    const i = a[r] * 3, j = b[r] * 3;
    return Math.hypot(P[i] - P[j], P[i + 1] - P[j + 1], P[i + 2] - P[j + 2]);
  }, "positions"),

  // ---- structure-query: generators ----
  [`${SQ}generator.all`]: {
    returns: "query",
    impl: () => (ctx) => singletons(ctx.input),
  },
  [`${SQ}generator.empty`]: { returns: "query", impl: () => () => EMPTY },
  [`${SQ}generator.atom-groups`]: {
    returns: "query",
    args: {
      "entity-test": Vopt,
      "chain-test": Vopt,
      "residue-test": Vopt,
      "atom-test": Vopt,
      "group-by": Vopt,
    },
    impl: atomGroups,
  },
  [`${SQ}generator.query-in-selection`]: {
    returns: "query",
    args: { 0: Q, query: Q, "in-complement": Vopt },
    impl: (a) => {
      const selection = query(a, "0"), inner = query(a, "query");
      const inComplement = optArg(a, "in-complement");
      return (ctx) => {
        const target = selection(ctx);
        if (setCount(target) === 0) return target;
        const n = ctx.data.topology.atoms.count;
        const rows = inComplement?.(ctx)
          ? subtractRows(ctx.input, flatten(target, n))
          : flatten(target, n);
        if (rows.length === 0) return EMPTY;
        return inner(childCtx(ctx, rows));
      };
    },
  },

  // ---- structure-query: combinators and modifiers ----
  [`${SQ}combinator.merge`]: {
    returns: "query",
    list: "query",
    impl: (a) => {
      const qs = a.list.map((c) => c.fn as QueryFn);
      if (qs.length === 0) return () => EMPTY;
      if (qs.length === 1) return qs[0];
      return (ctx) => {
        const out = new SetBuilder(ctx.data.topology.atoms.count);
        for (const q of qs) forEachSet(q(ctx), (s) => out.add(s));
        return out.selection();
      };
    },
  },
  [`${SQ}modifier.intersect-by`]: {
    returns: "query",
    args: { 0: Q, by: Q },
    impl: (a) => {
      const q = query(a, "0"), by = query(a, "by");
      return (ctx) => {
        const sel = q(ctx);
        if (setCount(sel) === 0) return sel;
        const bySel = by(ctx);
        if (setCount(bySel) === 0) return EMPTY;
        const n = ctx.data.topology.atoms.count, keep = flatten(bySel, n);
        const out = new SetBuilder(n);
        forEachSet(sel, (s) => out.add(intersectRows(s, keep)));
        return out.selection();
      };
    },
  },
  [`${SQ}modifier.except-by`]: {
    returns: "query",
    args: { 0: Q, by: Q },
    impl: (a) => {
      const q = query(a, "0"), by = query(a, "by");
      return (ctx) => {
        const sel = q(ctx);
        if (setCount(sel) === 0) return sel;
        const bySel = by(ctx);
        if (setCount(bySel) === 0) return sel;
        const n = ctx.data.topology.atoms.count, drop = flatten(bySel, n);
        const out = new SetBuilder(n);
        forEachSet(sel, (s) => out.add(subtractRows(s, drop)));
        return out.selection();
      };
    },
  },
  [`${SQ}modifier.union`]: {
    returns: "query",
    args: { 0: Q },
    impl: (a) => {
      const q = query(a, "0");
      return (ctx) => {
        const n = ctx.data.topology.atoms.count;
        const out = new SetBuilder(n, false);
        out.add(flatten(q(ctx), n));
        return out.selection();
      };
    },
  },
  [`${SQ}modifier.whole-residues`]: {
    returns: "query",
    args: { 0: Q },
    impl: (a) => {
      const q = query(a, "0");
      return (ctx) => {
        const whole = wholeResidues(ctx);
        return perSet(ctx, q(ctx), whole);
      };
    },
  },
  [`${SQ}modifier.expand-property`]: {
    returns: "query",
    args: { 0: Q, property: V },
    impl: (a) => {
      const q = query(a, "0"), property = arg(a, "property");
      return (ctx) => expandProperty(ctx, q(ctx), property);
    },
  },
  [`${SQ}modifier.include-surroundings`]: {
    returns: "query",
    reads: "positions",
    args: { 0: Q, radius: V, "as-whole-residues": Vopt },
    impl: (a) => {
      const q = query(a, "0"), radius = arg(a, "radius");
      const asWhole = optArg(a, "as-whole-residues");
      return (ctx) => {
        const r = radius(ctx) as number;
        const around = surroundings(ctx, r);
        const whole = asWhole?.(ctx) ? wholeResidues(ctx) : null;
        return perSet(ctx, q(ctx), (s) => whole ? whole(around(s)) : around(s));
      };
    },
  },
  // Bonds come from bondTopology(): explicit when the structure has them,
  // otherwise inferred from positions, so this reads positions too.
  [`${SQ}modifier.include-connected`]: {
    returns: "query",
    reads: "positions",
    args: {
      0: Q,
      "bond-test": Vopt,
      "layer-count": Vopt,
      "fixed-point": Vopt,
      "as-whole-residues": Vopt,
    },
    impl: includeConnected,
  },

  // ---- structure-query: filters ----
  [`${SQ}filter.within`]: {
    returns: "query",
    reads: "positions",
    args: {
      0: Q,
      target: Q,
      "min-radius": Vopt,
      "max-radius": V,
      invert: Vopt,
    },
    impl: within,
  },
  [`${SQ}filter.pick`]: {
    returns: "query",
    args: { 0: Q, test: V },
    impl: (a) => {
      const q = query(a, "0"), test = arg(a, "test");
      return (ctx) => {
        const out = new SetBuilder(ctx.data.topology.atoms.count, false);
        const outer = ctx.current;
        forEachSet(q(ctx), (s) => {
          ctx.current = s;
          if (test(ctx)) out.add(s);
        });
        ctx.current = outer;
        return out.selection();
      };
    },
  },
  [`${SQ}filter.first`]: {
    returns: "query",
    args: { 0: Q },
    impl: (a) => {
      const q = query(a, "0");
      return (ctx) => {
        const sel = q(ctx);
        if (sel.kind === "singletons") {
          return singletons(sel.atoms.slice(0, 1));
        }
        const out = new SetBuilder(ctx.data.topology.atoms.count, false);
        if (sel.sets.length) out.add(sel.sets[0]);
        return out.selection();
      };
    },
  },
  [`${SQ}filter.intersected-by`]: {
    returns: "query",
    args: { 0: Q, by: Q },
    impl: (a) => {
      const q = query(a, "0"), by = query(a, "by");
      return (ctx) => {
        const n = ctx.data.topology.atoms.count;
        const mask = new Uint8Array(n);
        for (const i of flatten(by(ctx), n)) mask[i] = 1;
        const out = new SetBuilder(n, false);
        forEachSet(q(ctx), (s) => {
          if (s.some((i) => mask[i] === 1)) out.add(s);
        });
        return out.selection();
      };
    },
  },
  [`${SQ}filter.with-same-atom-properties`]: {
    returns: "query",
    args: { 0: Q, source: Q, property: V },
    impl: (a) => {
      const q = query(a, "0"), source = query(a, "source");
      const property = arg(a, "property");
      return (ctx) => {
        const sel = q(ctx);
        const allowed = new Set<unknown>();
        forEachSet(source(ctx), (s) => {
          for (const i of s) allowed.add(property(withAtom(ctx, i)));
        });
        const out = new SetBuilder(ctx.data.topology.atoms.count, false);
        forEachSet(sel, (s) => {
          if (s.every((i) => allowed.has(property(withAtom(ctx, i))))) {
            out.add(s);
          }
        });
        return out.selection();
      };
    },
  },
  [`${SQ}filter.is-connected-to`]: {
    returns: "query",
    reads: "positions",
    args: { 0: Q, target: Q, "bond-test": Vopt, disjunct: Vopt },
    impl: isConnectedTo,
  },

  // ---- structure-query: atom-set reducers (inside a filter test) ----
  [`${SQ}atom-set.atom-count`]: {
    returns: "value",
    impl: () => (ctx) => currentSet(ctx).length,
  },
  [`${SQ}atom-set.property-set`]: {
    returns: "value",
    args: { 0: V },
    impl: (a) => {
      const property = arg(a, "0");
      return (ctx) => {
        const set = currentSet(ctx), atom = ctx.atom;
        const values = new Set<unknown>();
        for (const i of set) values.add(property(withAtom(ctx, i)));
        ctx.atom = atom;
        return values;
      };
    },
  },
};

const currentSet = (ctx: Ctx): Uint32Array =>
  ctx.current ?? fail("atom-set symbol used outside a set test (filter.pick)");

/** Arguments that exist in MolQL but are outside the Phase 1 allowlist. */
const NOT_YET: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [`${SQ}modifier.include-surroundings`]: {
    "atom-radius": "needs per-atom radii (molgpu-sept-922.15)",
  },
  [`${SQ}filter.within`]: {
    "atom-radius": "needs per-atom radii (molgpu-sept-922.15)",
  },
  [`${SQ}filter.is-connected-to`]: {
    invert:
      "Mol*'s runtime keeps every set when inverting, so there is no reference behaviour to match",
  },
};

/** Every symbol name the evaluator accepts, sorted. */
export const SUPPORTED_SYMBOLS: readonly string[] = Object.freeze(
  Object.keys(SPECS).sort(),
);

// ---- operator implementations ---------------------------------------------------

/**
 * Apply `f` to each set. A singleton selection is treated as one structure,
 * which is exact for these per-set maps because they distribute over union
 * (Mol*'s wholeResidues and includeSurroundings do the same).
 */
function perSet(
  ctx: Ctx,
  sel: AtomSets,
  f: (set: Uint32Array) => Uint32Array,
): AtomSets {
  if (sel.kind === "singletons") return singletons(f(sel.atoms));
  const out = new SetBuilder(ctx.data.topology.atoms.count);
  for (const s of sel.sets) out.add(f(s));
  return out.selection();
}

/**
 * Mol* generators.atoms: tests at entity/chain, residue and atom level, then
 * optionally grouping the passing atoms into one set per `group-by` value.
 */
function atomGroups(a: Args): Fn {
  const entityTest = optArg(a, "entity-test"),
    chainTest = optArg(a, "chain-test"),
    residueTest = optArg(a, "residue-test"),
    atomTest = optArg(a, "atom-test"),
    groupBy = optArg(a, "group-by");
  if (!entityTest && !chainTest && !residueTest && !atomTest && !groupBy) {
    return (ctx) => singletons(ctx.input);
  }
  if (atomTest && !entityTest && !chainTest && !residueTest && !groupBy) {
    return (ctx) => {
      const out: number[] = [];
      for (const i of ctx.input) if (atomTest(withAtom(ctx, i))) out.push(i);
      return singletons(Uint32Array.from(out));
    };
  }
  const chainLevel = !residueTest && !atomTest && !groupBy,
    residueLevel = !atomTest && !groupBy;
  return (ctx) => {
    const { input, topo } = ctx;
    const residue = ctx.data.topology.atoms.residue;
    // Without group-by every passing atom is its own set; with it, atoms join
    // the set of their key, in first-seen order (Mol*'s LinearGroupingBuilder).
    const out: number[] = [];
    const groups = new Map<unknown, number[]>();
    const emit = groupBy
      ? (i: number) => {
        const key = groupBy(withAtom(ctx, i));
        const group = groups.get(key);
        if (group) group.push(i);
        else groups.set(key, [i]);
      }
      : (i: number) => out.push(i);
    // Segments are runs of consecutive input atoms sharing a chain (then a
    // residue); each test sees the segment's first atom, as in Mol*.
    for (let c = 0; c < input.length;) {
      const chain = topo.atomChain[input[c]];
      let cEnd = c + 1;
      while (cEnd < input.length && topo.atomChain[input[cEnd]] === chain) {
        cEnd++;
      }
      withAtom(ctx, input[c]);
      if ((entityTest?.(ctx) ?? true) && (chainTest?.(ctx) ?? true)) {
        if (chainLevel) {
          for (let k = c; k < cEnd; k++) out.push(input[k]);
        } else {
          for (let r = c; r < cEnd;) {
            const res = residue[input[r]];
            let rEnd = r + 1;
            while (rEnd < cEnd && residue[input[rEnd]] === res) rEnd++;
            if (residueTest?.(withAtom(ctx, input[r])) ?? true) {
              for (let k = r; k < rEnd; k++) {
                if (
                  residueLevel || (atomTest?.(withAtom(ctx, input[k])) ?? true)
                ) {
                  emit(input[k]);
                }
              }
            }
            r = rEnd;
          }
        }
      }
      c = cEnd;
    }
    if (!groupBy) return singletons(Uint32Array.from(out));
    const sets = new SetBuilder(ctx.data.topology.atoms.count, false);
    for (const group of groups.values()) sets.add(Uint32Array.from(group));
    return sets.selection();
  };
}

/** Input atoms of every residue a set touches (Mol*'s getWholeResidues). */
function wholeResidues(ctx: Ctx): (set: Uint32Array) => Uint32Array {
  const { atoms, residues } = ctx.data.topology;
  const residue = atoms.residue;
  // CSR of input atoms by residue, built once per operator evaluation.
  const offsets = new Uint32Array(residues.count + 1);
  for (const i of ctx.input) offsets[residue[i] + 1]++;
  for (let r = 0; r < residues.count; r++) offsets[r + 1] += offsets[r];
  const fill = offsets.slice(0, residues.count);
  const byResidue = new Uint32Array(ctx.input.length);
  for (const i of ctx.input) byResidue[fill[residue[i]]++] = i;
  return (set) => {
    const out: number[] = [];
    let last = -1;
    const seen = new Set<number>();
    for (const i of set) {
      const r = residue[i];
      if (r === last || seen.has(r)) continue;
      seen.add(last = r);
      for (let k = offsets[r]; k < offsets[r + 1]; k++) out.push(byResidue[k]);
    }
    return sortedRows(out, atoms.count);
  };
}

// Smallest grid cell; a zero radius still needs a positive cell.
const MIN_CELL = 1;

const dist2 = (P: Float32Array, i: number, j: number): number => {
  const dx = P[i * 3] - P[j * 3],
    dy = P[i * 3 + 1] - P[j * 3 + 1],
    dz = P[i * 3 + 2] - P[j * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
};

/** Input atoms within `r` of any atom of a set (Mol*'s getIncludeSurroundings). */
function surroundings(ctx: Ctx, r: number): (set: Uint32Array) => Uint32Array {
  const P = ctx.data.positions, n = ctx.data.topology.atoms.count;
  const grid = spatialGrid(P, ctx.input, Math.max(r, MIN_CELL));
  const r2 = r * r;
  return (set) => {
    const out: number[] = [];
    for (const i of set) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      grid.near(x, y, z, (j) => {
        if (dist2(P, i, j) <= r2) out.push(j);
      });
    }
    return sortedRows(out, n);
  };
}

/** Mol* modifiers.expandProperty: add every input atom sharing a property value. */
function expandProperty(ctx: Ctx, sel: AtomSets, property: Fn): AtomSets {
  const n = ctx.data.topology.atoms.count;
  const owners = new Map<unknown, number[]>();
  let sets = 0;
  forEachSet(sel, (s, sI) => {
    sets = sI + 1;
    for (const i of s) {
      const p = property(withAtom(ctx, i));
      const list = owners.get(p);
      if (!list) owners.set(p, [sI]);
      else if (list[list.length - 1] !== sI) list.push(sI);
    }
  });
  const members: number[][] = Array.from({ length: sets }, () => []);
  for (const i of ctx.input) {
    const list = owners.get(property(withAtom(ctx, i)));
    if (list) { for (const sI of list) members[sI].push(i); }
  }
  const out = new SetBuilder(n);
  for (const m of members) out.add(Uint32Array.from(m));
  return out.selection();
}

/** Mol* modifiers.includeConnected over the table's declared bonds. */
function includeConnected(a: Args): Fn {
  const q = query(a, "0");
  const bondTest = optArg(a, "bond-test"),
    layerCount = optArg(a, "layer-count"),
    fixedPoint = optArg(a, "fixed-point"),
    asWhole = optArg(a, "as-whole-residues");
  return (ctx) => {
    const n = ctx.data.topology.atoms.count;
    // Mol* reads a zero or missing layer count as 1.
    const layers = Math.max((layerCount?.(ctx) as number) || 1, 0);
    const fixed = !!fixedPoint?.(ctx);
    const whole = asWhole?.(ctx) ? wholeResidues(ctx) : null;
    const inInput = new Uint8Array(n);
    for (const i of ctx.input) inInput[i] = 1;
    const bonds = bondTopology(ctx.data);
    const { offsets, neighbour, bond } = bondAdjacency(bonds, n);
    const passes = (r: number): boolean => {
      if (!bondTest) return true; // every table bond is covalent (Mol*'s default test)
      ctx.bond = r;
      ctx.bonds = bonds;
      const ok = !!bondTest(ctx);
      ctx.bond = -1;
      ctx.bonds = null;
      return ok;
    };
    const step = (set: Uint32Array): Uint32Array => {
      const out: number[] = [];
      for (const i of set) {
        out.push(i);
        for (let k = offsets[i]; k < offsets[i + 1]; k++) {
          const j = neighbour[k];
          if (inInput[j] && passes(bond[k])) out.push(j);
        }
      }
      const grown = sortedRows(out, n);
      return whole ? whole(grown) : grown;
    };
    const out = new SetBuilder(n);
    forEachSet(q(ctx), (s) => {
      let incl = s;
      if (fixed) {
        for (;;) {
          const before = incl.length;
          incl = step(incl);
          if (incl.length === before) break;
        }
      } else {
        for (let k = 0; k < layers; k++) incl = step(incl);
      }
      out.add(incl);
    });
    return out.selection();
  };
}

/**
 * Mol* filters.isConnectedTo: keep sets with a bond (passing bond-test) to a
 * target atom, outside the set itself when `disjunct`. Like Mol*'s runtime, a
 * missing :disjunct reads as false.
 */
function isConnectedTo(a: Args): Fn {
  const q = query(a, "0"), target = query(a, "target");
  const bondTest = optArg(a, "bond-test"), disjunctArg = optArg(a, "disjunct");
  return (ctx) => {
    const targetSel = target(ctx);
    if (setCount(targetSel) === 0) return targetSel;
    const sel = q(ctx);
    if (setCount(sel) === 0) return sel;
    const n = ctx.data.topology.atoms.count;
    const disjunct = !!disjunctArg?.(ctx);
    const inTarget = new Uint8Array(n);
    for (const i of flatten(targetSel, n)) inTarget[i] = 1;
    const bonds = bondTopology(ctx.data);
    const { offsets, neighbour, bond } = bondAdjacency(bonds, n);
    const inSet = new Uint8Array(n);
    const out = new SetBuilder(n, false);
    forEachSet(sel, (s) => {
      for (const i of s) inSet[i] = 1;
      let connected = false;
      for (let k = 0; !connected && k < s.length; k++) {
        const i = s[k];
        for (let e = offsets[i]; e < offsets[i + 1]; e++) {
          const j = neighbour[e];
          if (!inTarget[j] || (disjunct && inSet[j])) continue;
          if (bondTest) {
            ctx.bond = bond[e];
            ctx.bonds = bonds;
            const ok = !!bondTest(ctx);
            ctx.bond = -1;
            ctx.bonds = null;
            if (!ok) continue;
          }
          connected = true;
          break;
        }
      }
      for (const i of s) inSet[i] = 0;
      if (connected) out.add(s);
    });
    return out.selection();
  };
}

/** Mol* filters.within, without atom-radius. */
function within(a: Args): Fn {
  const q = query(a, "0"), target = query(a, "target");
  const minArg = optArg(a, "min-radius"),
    maxArg = arg(a, "max-radius"),
    invertArg = optArg(a, "invert");
  return (ctx) => {
    const sel = q(ctx), targetSel = target(ctx);
    const n = ctx.data.topology.atoms.count, P = ctx.data.positions;
    const maxR = maxArg(ctx) as number;
    const minValue = minArg?.(ctx) as number | undefined;
    const minR = minValue ? Math.max(0, minValue) : 0;
    const invert = !!invertArg?.(ctx);
    const T = flatten(targetSel, n);
    let test: (set: Uint32Array) => boolean;

    if (minR === 0 && minValue === undefined) {
      // withinMaxRadiusLookup: Mol* widens the radius by the selected atom's
      // VDW radius (its conformation radius), so match that.
      if (T.length === 0) test = () => false;
      else {
        let widest = 0;
        forEachSet(sel, (s) => {
          for (const i of s) {
            const v = vdw(ctx, i);
            if (v > widest) widest = v;
          }
        });
        const grid = spatialGrid(P, T, Math.max(maxR + widest, MIN_CELL));
        test = (s) => {
          for (const i of s) {
            const r = maxR + vdw(ctx, i), r2 = r * r;
            const hit = grid.near(
              P[i * 3],
              P[i * 3 + 1],
              P[i * 3 + 2],
              (j) => dist2(P, i, j) <= r2,
            );
            if (hit) return true;
          }
          return false;
        };
      }
    } else {
      // checkStructureMaxRadiusDistance / checkStructureMinMaxDistance with no
      // atom radius: an empty side passes; a pair closer than min rejects the set.
      const grid = T.length
        ? spatialGrid(P, T, Math.max(maxR, minR, MIN_CELL))
        : null;
      test = (s) => {
        if (!grid) return true;
        let inRange = false;
        for (const i of s) {
          const below = grid.near(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], (j) => {
            const d = Math.sqrt(dist2(P, i, j));
            if (minR === 0) {
              if (d <= maxR) inRange = true;
              return inRange;
            }
            if (d < minR) return true;
            if (d < maxR) inRange = true;
            return false;
          });
          if (minR === 0 && inRange) return true;
          if (minR > 0 && below) return false;
        }
        return inRange;
      };
    }

    const out = new SetBuilder(n, false);
    forEachSet(sel, (s) => {
      if (test(s) !== invert) out.add(s);
    });
    return out.selection();
  };
}

// ---- compilation -----------------------------------------------------------------

const isApply = (
  e: SelectionExpr,
): e is Extract<SelectionExpr, { head: SelectionExpr }> =>
  typeof e === "object" && e !== null && "head" in e;
const isSymbol = (e: SelectionExpr): e is { readonly name: string } =>
  typeof e === "object" && e !== null && "name" in e && !("head" in e);

const symbolName = (e: SelectionExpr): string => {
  if (isSymbol(e)) {
    if (typeof e.name !== "string" || !e.name) fail("empty symbol name");
    return e.name;
  }
  if (isApply(e)) {
    if (!isSymbol(e.head)) fail("can only apply symbols");
    return symbolName(e.head);
  }
  return fail(`expected a symbol, got ${JSON.stringify(e)}`);
};

type RawArgs = readonly SelectionExpr[] | {
  readonly [name: string]: SelectionExpr;
};
const argEntries = (args: RawArgs | undefined): [string, SelectionExpr][] => {
  if (!args) return [];
  if (Array.isArray(args)) {
    return args.map((e, k) => [String(k), e] as [string, SelectionExpr]);
  }
  return Object.entries(args);
};

// A context for folding pure symbols: they never read the dataset.
const CONST_CTX = {
  atom: -1,
  bond: -1,
  bonds: null,
  current: null,
} as unknown as Ctx;

function compileNode(
  e: SelectionExpr,
  expect: Kind,
  reads: Set<RevisionStream>,
): Compiled {
  if (
    typeof e === "string" || typeof e === "number" || typeof e === "boolean"
  ) {
    if (expect === "query") fail(`expected a query, got ${JSON.stringify(e)}`);
    return { fn: () => e, kind: "value", isConst: true };
  }
  if (typeof e !== "object" || e === null) {
    return fail(`not an expression: ${String(e)}`);
  }
  const name = symbolName(e);
  const spec = SPECS[name];
  if (!spec) fail(`symbol '${name}' is not supported`);
  if (spec.returns !== expect) {
    fail(`'${name}' is a ${spec.returns}, but a ${expect} is expected here`);
  }
  if (spec.reads) reads.add(spec.reads);

  const entries = argEntries(isApply(e) ? e.args : undefined);
  const named = new Map<string, Compiled>();
  const list: Compiled[] = [];
  entries.forEach(([key, value], k) => {
    let kind: Kind;
    if (spec.list) {
      if (key !== String(k)) {
        fail(`'${name}' takes positional arguments only, got ':${key}'`);
      }
      kind = spec.list;
    } else {
      const accepted = spec.args?.[key];
      if (!accepted) {
        const why = NOT_YET[name]?.[key];
        fail(
          why
            ? `'${name}' argument ':${key}' is not supported yet: ${why}`
            : `'${name}' has no argument ':${key}'`,
        );
      }
      kind = accepted![0];
    }
    const compiled = compileNode(value, kind, reads);
    named.set(key, compiled);
    list.push(compiled);
  });
  for (const [key, [, required]] of Object.entries(spec.args ?? {})) {
    if (required && !named.has(key)) {
      fail(`'${name}' requires argument ':${key}'`);
    }
  }

  const fn = spec.impl({ list, named });
  if (spec.pure && list.every((c) => c.isConst)) {
    const value = fn(CONST_CTX);
    return { fn: () => value, kind: spec.returns, isConst: true };
  }
  return { fn, kind: spec.returns, isConst: false };
}

const formatValue = (e: SelectionExpr): string => {
  if (typeof e === "string") return JSON.stringify(e);
  if (typeof e === "number" || typeof e === "boolean") return String(e);
  if (isSymbol(e)) return e.name;
  const name = symbolName(e);
  const entries = argEntries(isApply(e) ? e.args : undefined);
  const positional = entries.filter(([k]) => /^\d+$/.test(k))
    .sort(([a], [b]) => +a - +b).map(([, v]) => formatValue(v));
  const keyed = entries.filter(([k]) => !/^\d+$/.test(k))
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `:${k} ${formatValue(v)}`);
  return `(${[name, ...positional, ...keyed].join(" ")})`;
};

/** Canonical one-line S-expression for an expression; stable under key order. */
export function formatExpr(expr: SelectionExpr): string {
  return formatValue(expr);
}

/**
 * Compile a SelectionExpr once. Throws a TypeError naming the symbol or
 * argument for anything outside the supported language.
 */
export function compileExpr(expr: SelectionExpr): CompiledExpr {
  const reads = new Set<RevisionStream>(["topology"]);
  const root = compileNode(expr, "query", reads);
  const run = root.fn as QueryFn;
  const deps = (["topology", "positions", "attributes"] as const).filter((s) =>
    reads.has(s)
  );
  return Object.freeze({
    label: formatExpr(expr),
    deps: Object.freeze(deps),
    run(data: StructureData): Uint32Array {
      const topo = topologyCache(data);
      const ctx: Ctx = {
        data,
        topo,
        input: topo.allAtoms,
        atom: -1,
        bond: -1,
        bonds: null,
        current: null,
      };
      return flatten(run(ctx), data.topology.atoms.count);
    },
  });
}
