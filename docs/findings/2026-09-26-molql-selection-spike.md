# MolQL / mol-script as the selection language: mapping spike

Bead `molgpu-sept-ah3`. The question: could Mol*'s selection system
(`mol-script`: the MolQL expression language, its symbol table, and the
MolScript / PyMOL / VMD / Jmol parsers that target it) become the query surface
for `@molgpu/select`, and what would it take to map it onto our `SelectionQuery`
→ `Selection` model?

Everything below was read from `molstar@5.11.0` (`lib/mol-script`,
`lib/mol-model/structure/query`) and checked against
`packages/select/src/index.ts` and `packages/table/src/types.ts`.

**Answer: yes, and there is a clean split that keeps our boundaries.** Mol*'s
selection system has two halves that come apart easily:

1. A **front end**: text parsers → a plain-data expression tree. It needs none
   of Mol*'s structure model and runs unchanged under Deno (verified).
2. A **back end**: a runtime that evaluates that tree against a Mol*
   `Structure`. It pulls in about 290 files of `mol-model`, `mol-data` and
   `mol-math`, and cannot run on our tables.

The proposal: __take the expression tree as our query IR, reuse Mol_'s front end
behind the `@molgpu/io` wall, and write our own evaluator in `@molgpu/select`__,
porting Mol_'s operator semantics. This follows the same pattern as INVARIANT 3
(port Mol* kernels) and keeps INVARIANT 1 (only `io` imports molstar) as it
stands. The one real design change is that evaluation needs an internal
_grouped_ representation (§4.1). The public `Selection` stays a flat, sorted
index buffer, so CONCEPT 2 survives.

## 1. How Mol* is layered

```
text                     front end (small, standalone)            back end (heavy)
─────                    ─────────────────────────────            ────────────────
"resn CYS"      ─pymol─┐
"resname CYS"   ─vmd───┤→ Expression  (plain JSON-like tree)  →  compile() → QueryFn(ctx) → StructureSelection
"[CYS]"         ─jmol──┤   { head: Symbol, args: [...]|{...} }     runtime/query/table.js binds
"(sel.atom…)"   ─mol-script┘                                      each symbol to mol-model/structure/query/*
```

- **`Expression`** (`language/expression.d.ts`) is only a
  `Literal | {name} | {head, args}`. It serialises to JSON and does not refer to
  any structure.
- **Symbol table** (`language/symbol-table/{core,structure-query}.js`): about 60
  `core.*` symbols (logic, relations, math, sets, strings, regex, flags, `if`,
  `fn`) and about 110 `structure-query.*` symbols (generators, modifiers,
  filters, combinators, atom-set reducers, atom and bond properties). Every
  symbol has typed arguments and a docstring.
- **Front-end import closure** (measured by walking the `import` graph):
  - MolScript S-expression parser + alias table: **15 files, 84 KB**. Imports
    only `mol-script/language`, `mol-util/monadic-parser`, `mol-data/generic`,
    `mol-util/type-helpers`.
  - PyMOL + VMD + Jmol transpilers: **27 files, 203 KB**. Imports only
    `mol-script/language`, `mol-util/monadic-parser`, `mol-util/string`.
  - Runtime (`runtime/query/compiler.js`): **292 files, 1.9 MB**, the whole
    structure model.
- The operators themselves live in
  `mol-model/structure/query/queries/{generators,modifiers,filters,combinators}.js`,
  about 1,300 lines. They are written against Mol*'s `Unit` / `OrderedSet` /
  `StructureElement` types, so they have to be **ported, not imported**.

### Verified: the front end runs standalone under Deno

These are real outputs from `parse('pymol' | 'vmd', …)` and
`transpileMolScript(parseMolScript(…))`, formatted with Mol*'s own formatter
(the probe imported no `mol-model`):

```lisp
;; pymol: chain A and resi 10-20 and name CA
(structure-query.modifier.intersect-by
  :0 (structure-query.modifier.intersect-by
    :0 (structure-query.generator.atom-groups
         :chain-test (core.rel.eq (…macromolecular.auth_asym_id) A))
    :by (structure-query.generator.atom-groups
         :residue-test (core.set.has (core.type.set 10 11 … 20) (…auth_seq_id))))
  :by (structure-query.generator.atom-groups
       :atom-test (core.rel.eq (…label_atom_id) (structure-query.type.atom-name CA))))

;; pymol: byres resn HEM around 4
(structure-query.generator.query-in-selection
  :0 (structure-query.modifier.expand-property
       :0 (structure-query.modifier.union
            :0 (structure-query.modifier.except-by
                 :0 (structure-query.filter.within
                      :0 (structure-query.generator.all)
                      :target (…atom-groups :residue-test (= label_comp_id HEM))
                      :max-radius 4)
                 :by (…atom-groups :residue-test (= label_comp_id HEM))))
       :property (…macromolecular.residue-key))
  :query (structure-query.generator.all))

;; vmd: protein and within 5 of resname HEM
(structure-query.modifier.intersect-by
  :0 (structure-query.filter.pick
       :0 (…atom-groups :group-by (…residue-key))
       :test (core.set.is-subset (set C N CA O) (…atom-set.property-set (…label_atom_id))))
  :by (structure-query.modifier.include-surroundings
       :0 (…atom-groups :residue-test (= auth_comp_id HEM)) :radius 5))
```

Two things show up in these outputs:

- Even simple PyMOL and VMD strings produce **grouped** operators
  (`group-by residue-key`, `pick` with an atom-set test, `expand-property`).
  Supporting the text languages therefore means supporting grouping.
- MolScript emits atom properties as bare symbols
  (`structure-query.atom-property.macromolecular.label_comp_id`), while the
  transpilers emit them as zero-argument applies. The evaluator has to accept
  both forms.

## 2. What we have today

`@molgpu/select` has three internal query kinds:

| Ours                         | Kind     | Notes                                            |
| ---------------------------- | -------- | ------------------------------------------------ |
| `all(domain)`                | `all`    | every row of atom / residue / bond               |
| `where(domain, fn)`          | `where`  | opaque JS predicate; `deps` declared by caller   |
| `element(z)`                 | `where`  | sugar                                            |
| `comp(names)`                | `where`  | sugar, residue domain                            |
| `within(cutoff, q)`          | `within` | atom-level, spatial grid, depends on `positions` |
| `union/intersect/difference` | —        | on **resolved** `Selection`s only                |
| `toAtoms/toResidues/toBonds` | —        | on resolved selections, with source maps         |

What's missing, compared with MolQL: boolean composition _at the query level_,
grouping, bond traversal, aggregate tests, and serialisable predicates. A
`where` closure can't be hashed, serialised, shown to a user, or used to work
out its own dependencies.

## 3. Operator mapping

Legend: ✅ exists today · 🟢 small addition on the existing model · 🟡 needs
grouped evaluation (§4.1) · 🟠 needs new table data · 🔴 heavy / defer.

### Generators

| MolQL                      | Mapping                                                                                                                                 |    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -- |
| `all`                      | `all('atom')`                                                                                                                           | ✅ |
| `empty`                    | constant empty                                                                                                                          | 🟢 |
| `atom-groups` (tests only) | hierarchical `where`: entity → chain → residue → atom tests, evaluated per atom with the chain and residue test short-circuited per row | 🟢 |
| `atom-groups :group-by k`  | partition matching atoms by key `k` into sets                                                                                           | 🟡 |
| `query-in-selection`       | evaluate the inner query restricted to (or to the complement of) a subset                                                               | 🟢 |
| `bonded-atomic-pairs`      | bond-domain `where` → two-atom sets                                                                                                     | 🟡 |
| `rings`                    | needs ring perception (port Mol*'s unit rings)                                                                                          | 🔴 |

### Modifiers

| MolQL                                             | Mapping                                                               |                      |
| ------------------------------------------------- | --------------------------------------------------------------------- | -------------------- |
| `union` (collapse sets)                           | flatten                                                               | 🟢                   |
| `intersect-by`, `except-by`                       | query-level `intersect` / `difference` (today's resolved ops, lifted) | 🟢                   |
| `whole-residues`                                  | `toAtoms(toResidues(x))`, already exists                              | ✅                   |
| `include-surroundings :radius :as-whole-residues` | `x ∪ within(r, x)`, then whole residues                               | 🟢                   |
| `include-surroundings :atom-radius`               | needs a per-atom radius (`atoms.radius` is optional)                  | 🟠                   |
| `expand-property :property k`                     | generalises `whole-residues` to any key column                        | 🟢 flat / 🟡 per set |
| `union-by`                                        | per-set merge                                                         | 🟡                   |
| `include-connected :layer-count :fixed-point`     | BFS over bond adjacency (CSR built once per topology revision)        | 🟢                   |
| `include-connected :bond-test`                    | per-bond predicate (see bond properties)                              | 🟢/🟠                |
| `surrounding-ligands`                             | needs entity / ligand classification                                  | 🟠                   |
| `cluster`                                         | set-to-set distance clustering                                        | 🟡                   |
| `query-each`                                      | evaluate a sub-query per set                                          | 🟡                   |

### Filters (all act per set)

| MolQL                                     | Mapping                                                                |       |
| ----------------------------------------- | ---------------------------------------------------------------------- | ----- |
| `within :target :max-radius` (singletons) | our `within`                                                           | ✅    |
| `within :min-radius :invert`, per set     | a set passes if any atom is in [min, max]; an annulus on the same grid | 🟢/🟡 |
| `pick :test`                              | keep sets whose aggregate test holds                                   | 🟡    |
| `first`                                   | first set                                                              | 🟡    |
| `intersected-by`                          | keep sets that touch the target                                        | 🟡    |
| `is-connected-to`                         | bond adjacency + set membership                                        | 🟡    |
| `with-same-atom-properties`               | property-set subset test                                               | 🟡    |

### Combinators and atom-set reducers

| MolQL                                                          | Mapping                           |    |
| -------------------------------------------------------------- | --------------------------------- | -- |
| `merge`                                                        | query-level union                 | 🟢 |
| `intersect`                                                    | query-level intersect             | 🟢 |
| `distance-cluster`                                             | combinatorial search              | 🔴 |
| `atom-set.atom-count`, `count-query`, `reduce`, `property-set` | aggregate evaluation over one set | 🟡 |

### `core.*`

All ~60 core symbols (logic, relations, `in-range`, math, sets, lists,
`str.match` / regex, flags, `if`, `composite-key`) are a pure expression
interpreter with no structure dependence. About 300 lines, all 🟢.

### Properties → `StructureData` columns

| MolQL property                                                                                             | Our column                                                   |       |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----- |
| `core.element-symbol`, `atomic-number`                                                                     | `atoms.element` (Z) + symbol table                           | ✅    |
| `core.x / y / z`                                                                                           | `positions` (declares a `positions` dependency)              | ✅    |
| `core.vdw`, `mass`                                                                                         | per-element lookup tables                                    | 🟢    |
| `core.bond-count`                                                                                          | degree from `bonds` (per topology revision)                  | 🟢    |
| `core.atom-key`, `macromolecular.residue-key / chain-key`                                                  | row index / `atoms.residue` / `residues.chain`               | ✅    |
| `core.model-index`                                                                                         | `chains.model`                                               | ✅    |
| `core.source-index`, `macromolecular.id`                                                                   | `atoms.id` (string → number)                                 | 🟢    |
| `core.operator-name / instance-id / operator-key`                                                          | `instances`, but atoms aren't per-instance (§4.3)            | 🔴    |
| `label_atom_id`, `auth_atom_id`                                                                            | `atoms.name` (one column for both)                           | ✅    |
| `label_alt_id`                                                                                             | `atoms.altloc`                                               | ✅    |
| `occupancy`, `B_iso_or_equiv`                                                                              | `atoms.occupancy`, `atoms.bfactor`                           | ✅    |
| `label_comp_id`, `auth_comp_id`                                                                            | `residues.comp` (one column for both)                        | ✅    |
| `label_seq_id`                                                                                             | `residues.labelSeq`                                          | ✅    |
| `auth_seq_id`                                                                                              | `residues.authSeq` is a **string**; needs a numeric view     | 🟢    |
| `pdbx_PDB_ins_code`                                                                                        | `residues.insertionCode`                                     | ✅    |
| `label_asym_id`, `auth_asym_id`                                                                            | `chains.labelId`, `chains.authId`                            | ✅    |
| `secondary-structure-flags`                                                                                | `residues.secondaryStructure?` (helix/sheet/coil only)       | 🟢/🟠 |
| `secondary-structure-key`                                                                                  | derive from runs of `secondaryStructure`                     | 🟢    |
| `topology.connected-component-key`                                                                         | union-find over bonds                                        | 🟢    |
| `entity-key`, `label_entity_id`, `entity-type/subtype`, `entity-description`                               | not carried; `residues.polymer` covers part of `entity-type` | 🟠    |
| `is-het`, `pdbx_formal_charge`, `is-modified`, `is-non-standard`, `chem-comp-type`, `modified-parent-name` | not carried                                                  | 🟠    |
| `object-primitive`, `ihm.*`, `model-label`, `model-entry-id`                                               | out of scope                                                 | 🔴    |
| bond `order`, `atom-a/b`, `length`                                                                         | `bonds.order`, `a`, `b`; length from `positions`             | ✅    |
| bond `flags` (covalent/metallic/hydrogen/aromatic/…)                                                       | we have only `order` and `source`                            | 🟠    |

### What the text front ends actually need

I extracted every builder symbol the PyMOL, VMD and Jmol transpilers can emit.
Grouped by the legend above:

- **✅ / 🟢 (would work in Phase 1):** `generator.all/empty/atom-groups` (tests
  only), `generator.query-in-selection`,
  `modifier.intersect-by/except-by/union`, `combinator.merge`,
  `modifier.include-surroundings`, `modifier.include-connected`,
  `filter.within`, all `core.*` they use (rel, logic, set, flags, math,
  `str.match`, regex), and the properties element, name, comp, seq ids, chain
  ids, altloc, occupancy, B, x/y/z, vdw, mass, bond-count, residue-key and
  chain-key.
- **🟡 (Phase 2, grouping):** `atom-groups :group-by`, `filter.pick`,
  `filter.with-same-atom-properties`, `modifier.expand-property`,
  `atom-set.atom-count/count-query/property-set`. In practice these come from
  `byres`, `bychain`, `protein` / `nucleic` in VMD, and `around`/`expand` in
  PyMOL.
- **🟠 (Phase 3, table columns):** `is-het` (PyMOL `hetatm`, Jmol),
  `pdbx_formal_charge`, bond flags (`bound_to` with metallic or hydrogen bonds),
  fuller secondary-structure flags.
- **🔴:** `rings` (PyMOL `byring`).

Phases 1 and 2 together cover the everyday vocabulary of all three languages.

## 4. The design questions

### 4.1 Mol* selections are sequences of atom _sets_, ours are flat

This is the one real mismatch. A Mol* `StructureSelection` is either
`Singletons` or a `Sequence` of atom sets, and filters act on **whole sets**.
"Residues with any atom within 5 Å" is `within` applied to a residue-grouped
generator. Our `Selection` is one flat, sorted, deduplicated index buffer per
domain.

**Proposal: grouping is internal to evaluation and never reaches the public
type.**

- The evaluator's working value is
  `AtomSets = { offsets: Uint32Array; atoms:
  Uint32Array }` (CSR: set _i_ is
  `atoms[offsets[i] .. offsets[i+1]]`, each set sorted). `Singletons` is the
  degenerate case where `offsets = 0..n`, so we keep a fast path for it and
  allocate no offsets.
- `resolve(query, data)` flattens that to the atom domain (the same thing Mol*'s
  `modifier.union` / `toLoci` does) and returns today's `Selection`. Identity,
  revisions, set operations, domain conversions and staleness are all unchanged,
  so **CONCEPT 2 stands**.
- If a caller later needs the groups themselves (a label per cluster or per
  residue, for example), add `resolveGroups()` returning a frozen, dataset-bound
  value of the same kind. That is a separate decision, not part of this work.

### 4.2 Query IR: adopt the expression tree, with no Mol* type in our API

- Add a plain type in `@molgpu/select`:
  `type SelectionExpr = string | number | boolean | { name: string } | {
  head: SelectionExpr; args?: SelectionExpr[] | Record<string,
  SelectionExpr> }`.
  It has the same shape as Mol*'s `Expression` but is our own declaration, so
  HARDENING's "public types must not mention Mol* concepts" holds. Symbol names
  are strings.
- `compile(expr): SelectionQuery` adds a fourth internal query kind, `expr`. The
  existing builders become sugar that emit expression nodes: `element(z)` →
  `atom-groups :atom-test (= atomic-number z)`, `comp(names)` →
  `…:residue-test (set.has …)`, `within(c, q)` → `filter.within`. That leaves
  one evaluator. `where(fn)` stays as the opaque escape hatch.
- Treating the tree as data gets us:
  - **Automatic `deps`:** walk the symbols. `x/y/z`, `within`, `surroundings`
    and `length` imply `positions`; `occupancy`/`B` imply `attributes`;
    everything else implies `topology`.
  - **A canonical label and cache key:** the formatted expression.
  - **Serialisation:** for saved sessions and URL state.
  - **Clear errors:** a symbol that isn't implemented raises
    `@molgpu/select expr: symbol 'structure-query.generator.rings' is not
    supported`.
    This makes the implemented subset explicit and enforced, which is how we
    keep LKD.14's scope fence.
  - **Optimisation:** the transpilers produce naive trees, for example
    `intersect-by(intersect-by(atom-groups A, atom-groups B), atom-groups C)`,
    which costs three full scans. A small rewrite pass that folds singleton-only
    `intersect-by`/`except-by`/`merge` chains into one conjunctive or
    disjunctive `where` makes it a single scan. This is also the first step
    toward a GPU-evaluated predicate later, if we ever want one.

### 4.3 Semantic differences to write down

- **Symmetry instances.** In Mol*, atoms in different operator copies are
  distinct elements. Our atom rows are the asymmetric unit plus a separate
  `instances` table. We evaluate on the asymmetric unit, and
  `operator-name`/`instance-id` are unsupported until there is an instance-aware
  domain.
- **label vs auth.** We store one `comp` and one atom `name`, so both `label_*`
  and `auth_*` variants map to the same column. `auth_seq_id` needs a numeric
  view of `residues.authSeq`, which is currently a string. PyMOL's `resi 10-20`
  compares numerically on `auth_seq_id`.
- **Model and altloc.** Our `StructureData` is already cut by `ViewPolicy`, so a
  query only sees what the view kept. This differs from Mol* on multi-model or
  all-altloc views, and is correct for ours.
- __"PyMOL semantics" means Mol_'s transpiler's semantics._* For example, PyMOL
  `polymer` becomes a hard-coded residue-name list, and `hydro` becomes element
  H. Our oracle is Mol*, not PyMOL or VMD.

### 4.4 Where the front end lives (the boundary decision)

| Option               | Shape                                                                                                                                                                                                                                     | INVARIANT 1                               | Cost                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1 (recommended)** | `@molgpu/io` adds `parseSelection(lang, text): SelectionExpr`. It lazily imports the mol-script front end (15–27 files, no `mol-model`) and copies the tree into our plain type. `@molgpu/select` evaluates it and never imports molstar. | Kept as written                           | Lowest. Text parsing requires `io`, which already carries Mol* as a lazily imported dependency. Apps that build expressions in code or load them from JSON don't need `io`. |
| A2                   | Vendor or port the front end (MIT; ~84 KB for MolScript, ~200 KB with PyMOL/VMD/Jmol) into a new `@molgpu/query`.                                                                                                                         | Kept (no molstar import)                  | We own `monadic-parser` and track upstream grammar fixes, which change rarely (the transpilers date from 2022). A good fallback if we ever drop Mol* from `io`.             |
| A3                   | New package imports molstar directly.                                                                                                                                                                                                     | **Violated**: needs the invariant amended | Not recommended.                                                                                                                                                            |
| B                    | Our own mini language inspired by MolQL                                                                                                                                                                                                   | n/a                                       | Reinvents a design Mol* has already worked out, loses PyMOL/VMD/Jmol for free, and cuts against INVARIANT 3.                                                                |

A1 and A2 have the same IR and the same evaluator, so we can start with A1 and
switch to A2 later without changing `@molgpu/select`.

### 4.5 Correctness oracle for free

The golden-file harness (`jy6.4`) already loads the corpus through Mol*. For
every test string, `Script.getStructureSelection(expr, structure)` in the `io`
test harness gives Mol*'s answer. Flatten it to atom `sourceIndex`, map it to
our rows, and compare index sets exactly. We don't need to hand-write expected
results: the table of example strings in each transpiler's `examples.js` plus
the MolScript examples becomes the test corpus.

## 4.6 Decision (2026-09-26)

Recorded in `molgpu-sept-922.1` and planned under epic `molgpu-sept-922`:

- The IR is our own `SelectionExpr`.
- Mol*'s parsers are reused directly, lazily imported in `@molgpu/io`.
- MolQL → `SelectionExpr` normalisation and the allowlist check also live in
  `io` for now (A1). We can move it or port it to its own package (A2) later if
  that proves useful.
- The evaluator is ours, in `@molgpu/select`.
- Grouping stays internal.
- `lkd.14`'s selection rule is amended into the allowlist fence below.

## 4.7 Phase 1 allowlist

The selection language is exactly these symbols. Anything else is rejected at
parse time in `io` and at compile time in `select`. Every addition needs its own
bead.

**Generators:** `all`, `empty`, `atom-groups` (entity/chain/residue/atom tests;
**no** `group-by`), `query-in-selection` (incl. `in-complement`).

**Combinators:** `merge`, `intersect`.

**Modifiers:**

- `intersect-by`, `except-by`, `union`, `whole-residues`.
- `expand-property` (residue-key / chain-key only).
- `include-surroundings` (`radius`, `as-whole-residues`; **no** `atom-radius`).
- `include-connected` (`layer-count`, `fixed-point`; `bond-test` may only read
  bond order).

**Filters:** `within` on singletons (`max-radius`, `min-radius`, `invert`;
**no** `atom-radius`).

**Core:**

- `logic.*`, `rel.*` (incl. `in-range`), `set.*`, `list.*`, `str.match`,
  `type.regex`, `flags.has-any/has-all`, `ctrl.if`, `type.composite-key`, basic
  `math.*`.
- The `type.*` constructors for these (element-symbol, atom-name, set, list,
  sec-struct flags, bond flags).
- **Not** `fn` or `eval`.

**Properties:**

- Atom: element symbol, atomic number, atom name (label = auth), altloc,
  occupancy, B, x/y/z, source index / id, bond count.
- Residue: comp (label = auth), label/auth seq id, insertion code, residue key.
- Chain: label/auth asym id, chain key, model index.
- Derived: connected-component key.
- Secondary-structure flags only when `residues.secondaryStructure` is present
  (helix/sheet/coil).
- Bond: order, atom A/B, length.

In practice this covers these PyMOL keywords: `resn`, `resi`, `name`, `chain`,
`elem`, `alt`, `b`/`q`, `and`/`or`/`not`, `polymer`/`solvent`/`hydro` (as Mol*
expands them), `byres`, `around`, `expand`, `within`, `near_to`, `beyond`,
`bound_to`, `extend`. VMD `protein`/`nucleic` need grouping (Phase 2); `hetatm`
and `gap` need table data (Phase 3); `byring` is deferred.

### 4.8 Phase 1 implementation notes (2026-09-26)

Implementing Phase 1 and comparing it with Mol*'s own evaluator changed the list
in §4.7:

- **Removed:** `combinator.intersect`, `core.ctrl.if`,
  `atom-property.core.bond-count` and `topology.connected-component-key`. They
  are in Mol*'s symbol table but its runtime doesn't implement them
  (`runtime/query/table.js`), so there is nothing to check them against.
  `core.source-index` and `core.model-index` are removed too. Mol* reads them as
  file row and 0-based model index, which our view-filtered rows and 1-based
  `chains.model` don't match.
- **`within` without `:min-radius` widens the cutoff by the selected atom's VDW
  radius.** Mol* uses the unit conformation radius, so PyMOL `around 4` means
  `d ≤ 4 + vdw(atom)`. We port Mol*'s VDW table
  (`packages/select/src/elements.ts`) and match it. With `:min-radius`,
  distances are plain.
- **Bonds come from `bondTopology(data)`.** Most files declare no bonds, and the
  table infers them from positions. So `include-connected` reads `positions`,
  and its results match Mol* only where the inferred bonds do.
- **MolScript bare words** (`HEM` in `(= atom.label_comp_id HEM)`) arrive as
  symbols, and Mol* treats unknown symbols as strings. `io.parseSelection`
  (`922.6`) must turn them into string literals. `@molgpu/select` stays strict.
- **MolScript's everyday `sel.atom.res` / `sel.atom.chains`** expand to
  `atom-groups :group-by …`, which is Phase 2. PyMOL, VMD and Jmol strings
  mostly avoid `group-by`, but MolScript users will hit it first.

A throwaway comparison run gave identical atom sets for 24 of 28 PyMOL, VMD,
Jmol and MolScript strings on 1CRN and 1TQN. That included `byres … around`,
`expand`, `within/near_to/beyond … of`, `extend`, `bound_to`, `solvent`,
`polymer and not hydro`, and VMD `within 5 of`. Of the four that didn't match,
two crashed Mol*'s own parser, one is the bare-word case above, and one is
`sel.atom.res`. `922.7` turns this into a permanent test.

### 4.9 Grouping, parsing and the permanent comparison test (2026-09-26)

Grouping was moved ahead of the table-data work (`922.10`/`922.11` raised to
P2), because MolScript's `sel.atom.res`/`sel.atom.chains` and VMD's
`protein`/`nucleic` all need it.

- **Grouped operators added:** `atom-groups :group-by`, `filter.pick`,
  `filter.first`, `filter.intersected-by`, `filter.with-same-atom-properties`,
  `filter.is-connected-to` (`:bond-test`, `:disjunct`), and
  `atom-set.atom-count`/`property-set`.
- **Still left out:** `query-each`, `union-by`, `cluster` and `atom-set.reduce`
  have no Mol* runtime implementation.
  - `atom-set.count-query` runs over the whole input rather than the current set
    in Mol*.
  - `is-connected-to :invert` keeps every set in Mol*.
  - Copying those would copy bugs. A missing `:disjunct` reads as false, as in
    Mol*'s runtime (not the symbol table's `true`).
- **`io.parseSelection(language, text, { symbols })`** returns plain JSON.
  - It turns bare properties into calls and bare words into strings.
  - It never fills defaults.
  - It rejects symbols outside `symbols`, naming the language.
  - `io` declares its own copy of the tree type, because it may import no
    `@molgpu` package besides `table`.
- **`test/selection/oracle.test.ts`** runs in `deno task test`. It checks
  curated strings plus Mol*'s PyMOL, VMD and Jmol `examples.js` on 1CRN, 1TQN,
  1BNA and 1EJG, with model secondary structure attached on the Mol* side.
  - **241 of 246 pairs are identical.** The 5 known differences are listed in
    the test with causes: 4 are 1EJG microheterogeneity (io splits PRO/SER
    residues, Mol* keeps one) and 1 is the heme Fe–S `struct_conn` bond the
    inferred bonds lack.
  - 8 strings fall outside the supported symbols: `gap`, `byring`, mass, charge,
    bond counts, aromaticity.
- **Coil carries no secondary-structure bits**, as in Mol*. The comparison test
  caught this.

### 4.10 Table data and deliberate differences (2026-09-26)

- **`not X` when X is empty is the whole current input.** Mol* returns nothing
  there, so PyMOL `polymer and not hydro` selected nothing on structures without
  hydrogens. This is a deliberate difference, recorded in the comparison test.
- **`core.vdw`, `core.mass` and `:atom-radius`** needed no table change, because
  `select` carries Mol*'s element tables. Carbon's mass is corrected to 12.011
  (Mol* lists boron's 10.81), which is also recorded as deliberate.
- **`io` mapped only 8 element symbols.** Every other element read as Z=0. It
  now uses Mol*'s full table (`922.19`).
- **New optional table columns:** `atoms.formalCharge`, `residues.het`,
  `chains.entityId` and `chains.entityType`. `io` fills each only when the file
  has the source field. Selecting on a missing column is an error.
- **The comparison test now covers 5 structures and 387 pairs.** Everything
  outside the recorded differences matches.

## 5. Proposed phases

**Phase 0: decisions (you).**

- Amend `lkd.14`. Its trigger ("until someone actually asks for one") has now
  fired. Replace it with a scope fence: a closed, enumerated symbol subset;
  unsupported symbols are errors; no custom-property symbol registration; any
  new symbol needs a bead.
- Choose A1 or A2 (recommendation: A1).
- Confirm the grouped representation stays internal (§4.1).

**Phase 1: flat subset (🟢 rows).**

- The `SelectionExpr` type, `compile()`, and the core interpreter.
- The property table for the ✅/🟢 columns (element tables, numeric `authSeq`,
  bond degree, connected components).
- Tests-only `atom-groups`, `query-in-selection`, query-level
  merge/intersect/except-by/intersect-by, `within`, `include-surroundings`,
  `whole-residues`, `expand-property` (flat), and `include-connected`.
- Automatic deps, the canonical label, and the fold/rewrite pass.
- `io.parseSelection` for mol-script, pymol, vmd and jmol.
- The Mol* oracle tests from §4.5.
- The existing builders re-expressed as sugar, with no public API break.

**Phase 2: grouped evaluation (🟡 rows).** The CSR `AtomSets` value, `group-by`,
`pick`, `first`, atom-set reducers, per-set `within`, `union-by`,
`intersected-by`, `is-connected-to`, `with-same-atom-properties`, `query-each`,
`cluster`. This makes `byres`, `protein`, `bychain` and similar common idioms
work.

**Phase 3: table enrichment (🟠 rows).** One bead each, each an `io` + `table`
change: entity id/type, `isHet`, formal charge, full secondary-structure flags,
bond flags, VDW radius column. Then `surrounding-ligands`.

**Deferred (🔴):** `rings`, `distance-cluster`, instance/operator properties,
IHM.

## 6. Risks

- **Scope creep (R5/R6).** This is the risk `lkd.14` was written for. The
  enumerated symbol list plus "unsupported is an error" is the mitigation. The
  surface grows one reviewed symbol at a time, not by porting everything at
  once.
- **Performance.** Naive translation of transpiler output is O(n·k) in scans.
  The rewrite pass (§4.2) and per-topology-revision caches (bond CSR, degree,
  components, numeric `authSeq`) bring it back to about one scan. `within`
  already uses the spatial grid.
- __Semantic drift from Mol_._* Handled by the oracle tests (§4.5). Accepted
  differences are listed in §4.3.
- **Upstream churn.** The front end is stable. A1 pins it through `io`'s Mol*
  version.
