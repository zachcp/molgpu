import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { bondTopology, createStructure, withPositions } from "@molgpu/table";
import {
  compile,
  isStale,
  resolve,
  type SelectionExpr,
  supportedSymbols,
} from "../src/index.ts";
import { fixture } from "./fixture.ts";

// Atoms (see fixture.ts): 0 N, 1 C(CB), 2 S(SG), 3 C(CB), 4 S(SG), 5 O at
// x = 0, 1, 2, 3, 10, 11; residues CYS(0,1) GLY(2,3) CYS(4,5); bonds 0-1 2-3 4-5.

type Args = readonly SelectionExpr[] | { readonly [k: string]: SelectionExpr };
const call = (name: string, args?: Args): SelectionExpr =>
  args === undefined ? { head: { name } } : { head: { name }, args };
const sq = (name: string, args?: Args) => call(`structure-query.${name}`, args);
const prop = (name: string) => sq(`atom-property.${name}`);
const eq = (a: SelectionExpr, b: SelectionExpr) => call("core.rel.eq", [a, b]);

const comp = prop("macromolecular.label_comp_id");
const atomName = prop("macromolecular.label_atom_id");
const symbol = prop("core.element-symbol");
const el = (s: string) => sq("type.element-symbol", [s]);
const atoms = (test: SelectionExpr) =>
  sq("generator.atom-groups", { "atom-test": test });
const residues = (test: SelectionExpr) =>
  sq("generator.atom-groups", { "residue-test": test });
const all = sq("generator.all");
const atom0 = atoms(eq(prop("macromolecular.id"), 1));

const data = createStructure(fixture());
const rows = (
  e: SelectionExpr,
  d = data,
) => [...resolve(compile(e), d).indices];

Deno.test("atom tests, core relations and element symbols", () => {
  assertEquals(rows(atoms(eq(symbol, el("s")))), [2, 4]);
  assertEquals(rows(atoms(eq(prop("core.atomic-number"), 8))), [5]);
  assertEquals(
    rows(atoms(call("core.rel.in-range", [prop("core.x"), 1, 3]))),
    [1, 2, 3],
  );
  assertEquals(
    rows(atoms(call("core.logic.or", [eq(symbol, "N"), eq(symbol, "O")]))),
    [0, 5],
  );
  assertEquals(
    rows(atoms(call("core.logic.not", [eq(symbol, "C")]))),
    [0, 2, 4, 5],
  );
  assertEquals(
    rows(
      atoms(call("core.set.has", [call("core.type.set", ["N", "O"]), symbol])),
    ),
    [0, 5],
  );
  assertEquals(
    rows(
      atoms(
        call("core.str.match", [call("core.type.regex", ["^C"]), atomName]),
      ),
    ),
    [1, 3],
  );
  assertEquals(
    rows(atoms(eq(atomName, sq("type.atom-name", ["sg"])))),
    [2, 4],
  );
});

Deno.test("MolScript's bare-symbol properties match the call form", () => {
  const bare = atoms(
    eq({ name: "structure-query.atom-property.core.element-symbol" }, el("S")),
  );
  assertEquals(rows(bare), [2, 4]);
});

Deno.test("residue and chain tests see a segment's first atom, as in Mol*", () => {
  assertEquals(rows(residues(eq(comp, "CYS"))), [0, 1, 4, 5]);
  // A residue test on an atom property only reads the residue's first atom:
  // residue 0 starts with N, residue 1 with SG, residue 2 with SG.
  assertEquals(rows(residues(eq(atomName, "SG"))), [2, 3, 4, 5]);
  assertEquals(
    rows(sq("generator.atom-groups", {
      "chain-test": eq(prop("macromolecular.auth_asym_id"), "A"),
      "atom-test": eq(symbol, "S"),
    })),
    [2, 4],
  );
  assertEquals(
    rows(sq("generator.atom-groups", {
      "chain-test": eq(prop("macromolecular.auth_asym_id"), "B"),
    })),
    [],
  );
});

Deno.test("seq ids: numeric auth_seq_id and label_seq_id", () => {
  assertEquals(
    rows(
      residues(
        call("core.rel.in-range", [prop("macromolecular.auth_seq_id"), 2, 3]),
      ),
    ),
    [2, 3, 4, 5],
  );
  assertEquals(rows(residues(eq(prop("macromolecular.label_seq_id"), 1))), [
    0,
    1,
  ]);
});

Deno.test("set operators: intersect-by, except-by, merge, union", () => {
  const cys = residues(eq(comp, "CYS")), sulfur = atoms(eq(symbol, "S"));
  // PyMOL "resn CYS and name SG" as Mol* transpiles it.
  assertEquals(rows(sq("modifier.intersect-by", { 0: cys, by: sulfur })), [4]);
  assertEquals(rows(sq("modifier.except-by", { 0: cys, by: sulfur })), [
    0,
    1,
    5,
  ]);
  assertEquals(rows(sq("combinator.merge", [cys, sulfur])), [0, 1, 2, 4, 5]);
  assertEquals(rows(sq("modifier.union", [cys])), [0, 1, 4, 5]);
  assertEquals(rows(sq("combinator.merge", [])), []);
});

Deno.test("query-in-selection narrows the input; in-complement is 'not'", () => {
  const cys = residues(eq(comp, "CYS"));
  assertEquals(
    rows(
      sq("generator.query-in-selection", {
        0: cys,
        query: atoms(eq(symbol, "S")),
      }),
    ),
    [4],
  );
  assertEquals(
    rows(sq("generator.query-in-selection", {
      0: cys,
      query: all,
      "in-complement": true,
    })),
    [2, 3],
  );
  // Not nothing is everything (Mol* would return nothing here).
  const none = atoms(eq(symbol, "H"));
  assertEquals(
    rows(sq("generator.query-in-selection", {
      0: none,
      query: all,
      "in-complement": true,
    })),
    [0, 1, 2, 3, 4, 5],
  );
  assertEquals(
    rows(sq("generator.query-in-selection", { 0: none, query: all })),
    [],
  );
  // Surroundings only see the narrowed input: atom 3 is excluded.
  assertEquals(
    rows(sq("generator.query-in-selection", {
      0: atoms(call("core.rel.lt", [prop("core.x"), 3])),
      query: sq("modifier.include-surroundings", { 0: atom0, radius: 5 }),
    })),
    [0, 1, 2],
  );
});

Deno.test("whole residues, expand-property (byres) and surroundings", () => {
  const sg4 = atoms(eq(prop("macromolecular.id"), 5));
  assertEquals(rows(sq("modifier.whole-residues", [sg4])), [4, 5]);
  assertEquals(
    rows(sq("modifier.union", [
      sq("modifier.expand-property", {
        0: sg4,
        property: prop("macromolecular.residue-key"),
      }),
    ])),
    [4, 5],
  );
  assertEquals(
    rows(sq("modifier.include-surroundings", { 0: atom0, radius: 2 })),
    [
      0,
      1,
      2,
    ],
  );
  assertEquals(
    rows(sq("modifier.include-surroundings", {
      0: atom0,
      radius: 2,
      "as-whole-residues": true,
    })),
    [0, 1, 2, 3],
  );
});

Deno.test("include-connected: layers, fixed point, zero layers read as one", () => {
  const n0 = atom0;
  assertEquals(rows(sq("modifier.include-connected", { 0: n0 })), [0, 1]);
  assertEquals(
    rows(sq("modifier.include-connected", { 0: n0, "layer-count": 0 })),
    [
      0,
      1,
    ],
  );
  assertEquals(
    rows(sq("modifier.include-connected", { 0: n0, "fixed-point": true })),
    [0, 1],
  );
  assertEquals(
    rows(sq("modifier.include-connected", {
      0: n0,
      "bond-test": call("core.rel.gr", [sq("bond-property.order"), 1]),
    })),
    [0],
  );
});

Deno.test("include-connected infers bonds when the structure declares none", () => {
  const input = fixture();
  input.topology.bonds = {
    count: 0,
    a: new Uint32Array(0),
    b: new Uint32Array(0),
    order: new Uint8Array(0),
    source: [],
  };
  const bare = createStructure(input);
  const inferred = bondTopology(bare);
  const expected = new Set([0]);
  for (let r = 0; r < inferred.count; r++) {
    if (inferred.a[r] === 0) expected.add(inferred.b[r]);
    if (inferred.b[r] === 0) expected.add(inferred.a[r]);
  }
  const q = compile(sq("modifier.include-connected", { 0: atom0 }));
  assertEquals(
    rows(sq("modifier.include-connected", { 0: atom0 }), bare),
    [
      ...expected,
    ].sort((a, b) => a - b),
  );
  assertEquals(q.deps, ["topology", "positions"]); // inferred bonds move with atoms
});

Deno.test("within: Mol*'s three distance modes", () => {
  // No min-radius: Mol* widens max-radius by the selected atom's VDW radius
  // (C 1.7, S 1.8), so atoms at 1 and 2 A pass a 0.5 A cutoff.
  assertEquals(
    rows(sq("filter.within", { 0: all, target: atom0, "max-radius": 0.5 })),
    [0, 1, 2],
  );
  // With min-radius, distances are plain.
  assertEquals(
    rows(sq("filter.within", {
      0: all,
      target: atom0,
      "min-radius": 0,
      "max-radius": 0.5,
    })),
    [0],
  );
  const shell = { 0: all, target: atom0, "min-radius": 1.5, "max-radius": 2.5 };
  assertEquals(rows(sq("filter.within", shell)), [2]);
  assertEquals(rows(sq("filter.within", { ...shell, invert: true })), [
    0,
    1,
    3,
    4,
    5,
  ]);
  // An empty target: nothing is near it, but a range test passes everything.
  const none = sq("generator.empty");
  assertEquals(
    rows(sq("filter.within", { 0: all, target: none, "max-radius": 1 })),
    [],
  );
  assertEquals(
    rows(sq("filter.within", {
      0: all,
      target: none,
      "min-radius": 0,
      "max-radius": 1,
    })),
    [0, 1, 2, 3, 4, 5],
  );
});

Deno.test("vdw, mass and :atom-radius", () => {
  // Mol*'s VDW radii: N 1.55, C 1.7, S 1.8, O 1.52.
  assertEquals(rows(atoms(eq(prop("core.vdw"), 1.8))), [2, 4]);
  // Carbon is 12.011 (Mol*'s table has boron's 10.81; a deliberate fix).
  assertEquals(rows(atoms(eq(prop("core.mass"), 12.011))), [1, 3]);
  const vdwR = prop("core.vdw");
  // With :min-radius the gap is dist - r(i) - r(j): atom 3 (C, x=3) to atom 0
  // (N, x=0) is 3 - 1.7 - 1.55 < 0.5; atom 4 (x=10) is not.
  assertEquals(
    rows(sq("filter.within", {
      0: all,
      target: atom0,
      "min-radius": 0,
      "max-radius": 0.5,
      "atom-radius": vdwR,
    })),
    [0, 1, 2, 3],
  );
  // Without :min-radius Mol* ignores :atom-radius (PyMOL 'gap' relies on it).
  assertEquals(
    rows(sq("filter.within", {
      0: all,
      target: atom0,
      "max-radius": 0.5,
      "atom-radius": 100,
    })),
    [0, 1, 2],
  );
  // include-surroundings: dist - r(i) - r(j) <= radius.
  assertEquals(
    rows(sq("modifier.include-surroundings", {
      0: atom0,
      radius: 0,
      "atom-radius": vdwR,
    })),
    [0, 1, 2, 3],
  );
});

Deno.test("within filters whole sets: union makes one set", () => {
  const gly = residues(eq(comp, "GLY")); // atoms 2 (x=2) and 3 (x=3)
  const range = { target: atom0, "min-radius": 0, "max-radius": 2.5 };
  assertEquals(rows(sq("filter.within", { 0: gly, ...range })), [2]);
  assertEquals(
    rows(sq("filter.within", { 0: sq("modifier.union", [gly]), ...range })),
    [2, 3],
  );
});

Deno.test("the transpiled PyMOL 'byres resn HEM around 4' shape evaluates", () => {
  const cys = residues(eq(comp, "CYS"));
  const byresAround = sq("generator.query-in-selection", {
    0: sq("modifier.expand-property", {
      0: sq("modifier.union", [
        sq("modifier.except-by", {
          0: sq("filter.within", { 0: all, target: cys, "max-radius": 0 }),
          by: cys,
        }),
      ]),
      property: prop("macromolecular.residue-key"),
    }),
    query: all,
  });
  // Atom 2 (x=2) is within 0 + vdw(S) 1.8 of atom 1 (x=1): its residue joins.
  assertEquals(rows(byresAround), [2, 3]);
});

Deno.test("deps are inferred from the symbols used", () => {
  assertEquals(compile(atoms(eq(symbol, "S"))).deps, ["topology"]);
  assertEquals(
    compile(sq("filter.within", { 0: all, target: atom0, "max-radius": 1 }))
      .deps,
    ["topology", "positions"],
  );
  assertEquals(
    compile(
      atoms(call("core.rel.gr", [prop("macromolecular.B_iso_or_equiv"), 20])),
    )
      .deps,
    ["topology", "attributes"],
  );
  const near = compile(
    sq("modifier.include-surroundings", { 0: atom0, radius: 2 }),
  );
  const sel = resolve(near, data);
  const moved = withPositions(data, new Float32Array(data.positions));
  assertEquals(isStale(sel, data), false);
  assertEquals(isStale(sel, moved), true);
});

Deno.test("labels are canonical S-expressions, independent of key order", () => {
  const a = compile(
    sq("filter.within", { 0: all, target: atom0, "max-radius": 1 }),
  );
  const b = compile(
    sq("filter.within", { "max-radius": 1, target: atom0, 0: all }),
  );
  assertStrictEquals(a.label, b.label);
  assertStrictEquals(
    compile(atoms(eq(symbol, "S"))).label,
    '(structure-query.generator.atom-groups :atom-test (core.rel.eq (structure-query.atom-property.core.element-symbol) "S"))',
  );
});

const byResidue = (test?: SelectionExpr) =>
  sq("generator.atom-groups", {
    ...(test === undefined ? {} : { "residue-test": test }),
    "group-by": prop("macromolecular.residue-key"),
  });

Deno.test("group-by makes one set per key, in first-seen order", () => {
  const cysResidues = byResidue(eq(comp, "CYS"));
  assertEquals(rows(cysResidues), [0, 1, 4, 5]);
  assertEquals(rows(sq("filter.first", [cysResidues])), [0, 1]);
  assertEquals(rows(sq("filter.first", [atoms(eq(symbol, "S"))])), [2]);
  // A per-set within keeps the whole residue (compare the singleton test).
  const near0 = { target: atom0, "min-radius": 0, "max-radius": 2.5 };
  assertEquals(rows(sq("filter.within", { 0: byResidue(), ...near0 })), [
    0,
    1,
    2,
    3,
  ]);
});

Deno.test("pick tests each set with atom-set reducers (VMD 'protein' shape)", () => {
  const names = sq("atom-set.property-set", [atomName]);
  const hasCbSg = call("core.set.is-subset", [
    call("core.type.set", [
      sq("type.atom-name", ["CB"]),
      sq("type.atom-name", ["SG"]),
    ]),
    names,
  ]);
  assertEquals(rows(sq("filter.pick", { 0: byResidue(), test: hasCbSg })), [
    2,
    3,
  ]);
  assertEquals(
    rows(sq("filter.pick", {
      0: byResidue(),
      test: eq(sq("atom-set.atom-count"), 2),
    })),
    [0, 1, 2, 3, 4, 5],
  );
  assertThrows(
    () => rows(atoms(eq(sq("atom-set.atom-count"), 1))),
    TypeError,
    "outside a set test",
  );
});

Deno.test("intersected-by, with-same-atom-properties, is-connected-to", () => {
  assertEquals(
    rows(sq("filter.intersected-by", { 0: byResidue(), by: atom0 })),
    [0, 1],
  );
  // Residues whose elements all occur in residue 0 (N, C).
  assertEquals(
    rows(sq("filter.with-same-atom-properties", {
      0: byResidue(),
      source: byResidue(eq(prop("macromolecular.label_seq_id"), 1)),
      property: symbol,
    })),
    [0, 1],
  );
  const cb1 = atoms(eq(prop("macromolecular.id"), 2)); // atom 1, bonded to atom 0
  assertEquals(
    rows(sq("filter.is-connected-to", { 0: byResidue(), target: cb1 })),
    [0, 1],
  );
  // disjunct: the bond must leave the set; 0-1 stays inside residue 0.
  assertEquals(
    rows(sq("filter.is-connected-to", {
      0: byResidue(),
      target: cb1,
      disjunct: true,
    })),
    [],
  );
});

Deno.test("secondary-structure flags need the column", () => {
  const helix = residues(
    call("core.flags.has-any", [
      prop("macromolecular.secondary-structure-flags"),
      sq("type.secondary-structure-flags", ["helix"]),
    ]),
  );
  assertThrows(() => rows(helix), TypeError, "residues.secondaryStructure");
  const input = fixture();
  input.topology.residues.secondaryStructure = ["helix", "coil", "sheet"];
  assertEquals(rows(helix, createStructure(input)), [0, 1]);
});

Deno.test("anything outside the language is a compile-time error", () => {
  const bad = (e: SelectionExpr, msg: string) =>
    assertThrows(() => compile(e), TypeError, msg);
  bad(
    sq("generator.rings"),
    "symbol 'structure-query.generator.rings' is not supported",
  );
  bad(
    sq("filter.pick", { 0: all, test: sq("atom-set.count-query", [all]) }),
    "symbol 'structure-query.atom-set.count-query' is not supported",
  );
  bad(
    sq("filter.is-connected-to", { 0: all, target: all, invert: true }),
    "keeps every set when inverting",
  );
  bad(
    sq("filter.within", { 0: all, target: all }),
    "requires argument ':max-radius'",
  );
  bad(
    sq("modifier.union", [eq(symbol, "S")]),
    "is a value, but a query is expected",
  );
  bad(atoms(all), "is a query, but a value is expected");
  bad("CYS", "expected a query");
  bad(sq("modifier.union", { by: all }), "has no argument ':by'");
  assertThrows(
    () => rows(atoms(eq(sq("bond-property.order"), 1))),
    TypeError,
    "outside a bond test",
  );
});

Deno.test("supportedSymbols lists the closed language", () => {
  assertEquals(
    supportedSymbols.includes("structure-query.filter.within"),
    true,
  );
  assertEquals(
    supportedSymbols.includes("structure-query.generator.rings"),
    false,
  );
  assertEquals(supportedSymbols.includes("core.ctrl.if"), false);
  assertEquals([...supportedSymbols].sort(), [...supportedSymbols]);
});

Deno.test("every core symbol evaluates like Mol*'s runtime", () => {
  const cases: [string, SelectionExpr[], unknown][] = [
    ["core.type.bool", [0], false],
    ["core.type.num", ["4"], 4],
    ["core.type.str", [4], "4"],
    ["core.type.composite-key", ["A", 7], "A-7"],
    ["core.logic.and", [true, 1], true],
    ["core.logic.or", [0, false], false],
    ["core.logic.not", [0], true],
    ["core.rel.neq", [1, 2], true],
    ["core.rel.lt", [1, 2], true],
    ["core.rel.lte", [2, 2], true],
    ["core.rel.gr", [1, 2], false],
    ["core.rel.gre", [2, 2], true],
    ["core.math.add", [1, 2, 3], 6],
    ["core.math.sub", [5], -5],
    ["core.math.sub", [10, 3, 2], 5],
    ["core.math.mult", [2, 3, 4], 24],
    ["core.math.div", [7, 2], 3.5],
    ["core.math.pow", [2, 10], 1024],
    ["core.math.mod", [7, 3], 1],
    ["core.math.min", [3, 1, 2], 1],
    ["core.math.max", [3, 1, 2], 3],
    ["core.math.atan2", [1, 1], Math.atan2(1, 1)],
    ["core.math.floor", [1.5], 1],
    ["core.math.ceil", [1.5], 2],
    ["core.math.round-int", [1.5], 2],
    ["core.math.trunc", [-1.5], -1],
    ["core.math.abs", [-2], 2],
    ["core.math.sign", [-2], -1],
    ["core.math.sqrt", [9], 3],
    ["core.math.cbrt", [27], 3],
    ["core.math.sin", [0.5], Math.sin(0.5)],
    ["core.math.cos", [0.5], Math.cos(0.5)],
    ["core.math.tan", [0.5], Math.tan(0.5)],
    ["core.math.asin", [0.5], Math.asin(0.5)],
    ["core.math.acos", [0.5], Math.acos(0.5)],
    ["core.math.atan", [0.5], Math.atan(0.5)],
    ["core.math.sinh", [0.5], Math.sinh(0.5)],
    ["core.math.cosh", [0.5], Math.cosh(0.5)],
    ["core.math.tanh", [0.5], Math.tanh(0.5)],
    ["core.math.exp", [1], Math.E],
    ["core.math.log", [Math.E], 1],
    ["core.math.log10", [1000], 3],
    ["core.str.concat", ["a", 1, "b"], "a1b"],
    ["core.flags.has-any", [6, 2], true],
    ["core.flags.has-any", [4, 0], true],
    ["core.flags.has-all", [6, 7], false],
    ["core.flags.has-all", [0, 0], true],
  ];
  for (const [name, args, expected] of cases) {
    // Pure symbols with constant arguments fold at compile time, so a correct
    // result makes the atom test constant-true and selects every atom.
    assertEquals(
      rows(atoms(eq(call(name, args), expected as SelectionExpr))),
      [0, 1, 2, 3, 4, 5],
      `${name} ${JSON.stringify(args)}`,
    );
  }
  const list = call("core.type.list", ["a", "b"]);
  assertEquals(
    rows(atoms(eq(call("core.list.get-at", [list, 1]), "b"))).length,
    6,
  );
  assertEquals(
    rows(
      atoms(
        call("core.list.equal", [list, call("core.type.list", ["a", "b"])]),
      ),
    )
      .length,
    6,
  );
  const set = (...xs: SelectionExpr[]) => call("core.type.set", xs);
  assertEquals(
    rows(atoms(call("core.set.is-subset", [set("N"), set("N", "O")]))).length,
    6,
  );
  assertEquals(
    rows(atoms(call("core.set.is-subset", [set("N", "C"), set("N", "O")])))
      .length,
    0,
  );
  assertEquals(
    rows(
      atoms(
        call("core.str.match", [call("core.type.regex", ["^s", "i"]), "SG"]),
      ),
    )
      .length,
    6,
  );
});

Deno.test("het, formal charge and entity columns, and errors without them", () => {
  const input = fixture();
  input.topology.atoms.formalCharge = Int8Array.from([1, 0, 0, 0, -1, 0]);
  input.topology.residues.het = Uint8Array.from([0, 1, 0]);
  input.topology.chains.entityId = ["7"];
  input.topology.chains.entityType = ["polymer"];
  const full = createStructure(input);
  assertEquals(rows(atoms(prop("macromolecular.is-het")), full), [2, 3]);
  assertEquals(
    rows(
      atoms(
        call("core.rel.neq", [prop("macromolecular.pdbx_formal_charge"), 0]),
      ),
      full,
    ),
    [0, 4],
  );
  assertEquals(
    rows(
      sq("generator.atom-groups", {
        "entity-test": eq(prop("macromolecular.label_entity_id"), "7"),
      }),
      full,
    ),
    [0, 1, 2, 3, 4, 5],
  );
  assertEquals(
    rows(atoms(eq(prop("macromolecular.entity-type"), "water")), full),
    [],
  );
  assertEquals(
    rows(atoms(eq(prop("macromolecular.entity-key"), 0)), full).length,
    6,
  );
  // The base fixture has none of these columns.
  for (
    const name of [
      "is-het",
      "pdbx_formal_charge",
      "label_entity_id",
      "entity-type",
    ]
  ) {
    assertThrows(
      () => rows(atoms(eq(prop(`macromolecular.${name}`), 1))),
      TypeError,
      "needs",
    );
  }
});
