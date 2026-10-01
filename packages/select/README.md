# @molgpu/select

Pure selection queries and dataset-bound resolved selections for molgpu. You
build a reusable `SelectionQuery` (by element, residue component, predicate or
distance), resolve it against one `@molgpu/table` `StructureData` into a sorted,
deduplicated `Selection`, and then combine selections (`union` / `intersect` /
`difference`), convert them between atom, residue and bond domains, and check
whether they are stale after the data changes. It is CPU index math only. There
is no renderer, no GPU or use.gpu concept, no string selection language and no
WGSL. The viewer takes the resulting `Selection` and uploads its indices.

## Install

```sh
deno add jsr:@molgpu/select jsr:@molgpu/table
```

JSR publishes internal dependencies as caret ranges (for example,
`jsr:@molgpu/table@^0.1.0`). Keep compatible versions so the application
resolves one shared copy: identity and revision state are module-private. Values
from divergent copies can be rejected by identity-dependent operations. Use
`deno info` and the lockfile to find duplicate versions, then align the
application and package dependency ranges.

## Example

```js
import { createStructure, withPositions } from "@molgpu/table";
import {
  comp,
  count,
  element,
  isStale,
  resolve,
  toAtoms,
  union,
  within,
} from "@molgpu/select";

// Two residues (CYS, GLY), four atoms, one bond. Real data comes from @molgpu/io.
const data = createStructure({
  positions: Float32Array.from([0, 0, 0, 1.8, 0, 0, 5, 0, 0, 6, 0, 0]),
  topology: {
    atoms: {
      count: 4,
      id: ["1", "2", "3", "4"],
      name: ["CB", "SG", "CA", "O"],
      altloc: ["", "", "", ""],
      residue: Uint32Array.from([0, 0, 1, 1]),
      element: Uint8Array.from([6, 16, 6, 8]),
      occupancy: Float32Array.from([1, 1, 1, 1]),
      bfactor: new Float32Array(4),
    },
    residues: {
      count: 2,
      chain: Uint32Array.from([0, 0]),
      labelSeq: Int32Array.from([1, 2]),
      authSeq: ["1", "2"],
      insertionCode: ["", ""],
      comp: ["CYS", "GLY"],
      polymer: ["protein", "protein"],
    },
    chains: {
      count: 1,
      model: Int32Array.from([1]),
      labelId: ["A"],
      authId: ["A"],
    },
    bonds: {
      count: 1,
      a: Uint32Array.from([0]),
      b: Uint32Array.from([1]),
      order: Uint8Array.from([1]),
      source: ["explicit"],
    },
    instances: {
      count: 1,
      chain: Uint32Array.from([0]),
      operatorId: ["identity"],
      transform: Float64Array.from([
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
      ]),
    },
  },
});

// Queries are pure recipes; resolve binds them to one dataset.
const sulfur = resolve(element(16), data);
const cysAtoms = toAtoms(resolve(comp(["CYS"]), data), data); // residue -> atom, keeps a source map
const near = resolve(within(2, element(16)), data); // position-dependent

console.log([...sulfur.indices], [...cysAtoms.indices], [
  ...cysAtoms.source.rows,
]); // [ 1 ] [ 0, 1 ] [ 0, 0 ]
console.log(count(union(sulfur, near))); // 2

const moved = withPositions(
  data,
  Float32Array.from([0, 0, 0, 9, 0, 0, 5, 0, 0, 6, 0, 0]),
);
console.log(isStale(sulfur, moved), isStale(near, moved)); // false true
```

## Concepts

Two concepts, kept apart on purpose:

- **`SelectionQuery`**: a reusable, structure-independent recipe. Building one
  (`all`, `protein`, `attribute`, `and`, `where`, `within`, and other builders)
  touches no dataset, so the same query resolves against many structures
  independently.
- **`Selection`**: the result of `resolve(query, data)`. It carries the
  dataset's identity, its `domain` (`atom` | `residue` | `bond`), the sorted
  unique in-range `indices`, the dependency **revisions** it read (`deps`), and
  a library-owned `id`. The caller's label is only a label, never the cache key.
  Identity is derived from dataset, revisions and membership, so two datasets
  that share a query label still get distinct ids, and changed membership
  changes the id. Treat `indices` as immutable: JavaScript cannot freeze typed
  arrays, and mutating them would make the content-derived `id` stale.

### Query authoring

Compose recipes before binding them to a dataset. `and`/`or`/`not` return atom
queries and normalize residue/bond children to atoms; the existing
`union`/`intersect`/`difference` still operate on resolved selections.

```ts
import {
  allModels,
  and,
  attribute,
  chain,
  comp,
  model,
  not,
  protein,
  resolve,
  secondaryStructure,
  water,
  within,
  withView,
} from "@molgpu/select";

const heme = comp(["HEM"]); // residue query; within expands its seeds to atoms
const pocket = and(protein(), within(5, heme));
const nonWater = not(water());
const helices = secondaryStructure("helix"); // H/G/I, not just alpha helices
const charged = attribute("partialCharge", (value) => value > 0);
const chainA = and(protein(), chain("A"));

const firstView = { model: "first", altloc: "primary" } as const;
resolve(pocket, data, { view: firstView });
resolve(and(protein(), model(2)), data, { view: firstView });
resolve(and(protein(), allModels()), data, { view: firstView });
resolve(withView(pocket, { altloc: "all" }), data, { view: firstView });
```

`protein` and `nucleic` use the table's stored polymer classification. `water`
uses water entity metadata; without it the fallback component names are HOH,
WAT, H2O and DOD. `ligand` means non-protein/non-nucleic, non-water atoms,
including ions and other nonpolymers; it does not mean every HETATM record.
Modified polymer residues follow their source classification. `chain(id)` uses
**author** chain IDs by default; `{ namespace: "label" }` selects label IDs.
`residues([lo, hi])` is an inclusive author integer sequence range, parsing the
numeric prefix as MolQL does and excluding nonnumeric IDs. Insertion-code
variants with the same number are retained. Use `{ namespace: "label" }` for
label sequence numbers (the table's -1 sentinel for missing label sequence is
not a real residue number and is excluded). These builders do not claim to
reproduce every text language's version of protein, ligand or residue identity.

`attribute(name, test)` returns an atom query. Atom columns are read directly;
residue columns are lifted through each atom's residue. Missing columns throw a
named TypeError. Only numeric column values are supplied to its predicate.
`query.attributes` is a frozen list of the declared column names, including
transitive child inputs. It is `null` when any input is an opaque
attributes-dependent `where` predicate or compiled expression, indicating a
conservative subscription is needed; `[]` means no column input. `query.deps`
likewise includes all child streams, including attributes below `within`.

### View-aware evaluation

Standalone `resolve(query, data)` retains full-table evaluation and the original
query domain unless the query declares a view. Scoped resolution, through
`resolve(query, data, { view })` or explicit query scopes, returns eligible
**atom** rows, including for residue/bond queries. Residues expand only to their
eligible atoms; a declared bond is eligible only when both endpoints are
eligible. The source table and row identities never change. Scoped output has no
conversion source map; use unscoped resolution plus `toAtoms` when that map is
required.

The public `query.view` contains explicit axes only. The caller supplies
defaults; missing axes default to all models/all conformers for standalone
resolution. `model(n)` filters by model and declares its model scope;
`allModels()` and `allConformers()` opt out independently.
`withView(query, view)` overrides explicit scopes. Compatible child scopes
propagate through boolean operations and `within`; conflicting scopes throw
during resolution unless an outer `withView` supplies an override for each
conflict. For example, `withView(or(model(1), model(2)), { model: "all" })`
evaluates the two-model union. Likewise, `not(model(2))` complements inside
model 2; use an outer all-model scope when the intended complement includes
other models. An absent explicit model id throws rather than silently using
another model.

Eligibility applies to candidates **and seed atoms**, complements and compiled
expression input. A ligand in an inactive model/conformer cannot affect a scoped
`within` result. Primary conformer choice uses table `activeAtoms` and reads the
occupancy policy; scoped results record the attributes revision for staleness.
Distance cutoffs in the `within` builder are center-to-center Angstrom,
including the seed atoms; PyMOL `around` has different VDW-radius semantics. A
query scoped to all models can compare atoms across models, as full-table
`within` already does.

Viewer query-prop adaptation is tracked separately in `crj.20`: current
representation props still take resolved selections. Ordinary viewer queries
will use first-model/primary-conformer defaults; coordinate providers will keep
all-row defaults. Exact resolved selections remain the explicit override.

### Text selection construction

Text parsing stays in IO, with its language argument explicit and asynchronous:

```ts
import { parseSelection } from "@molgpu/io";
import { compile, resolve } from "@molgpu/select";

const query = compile(await parseSelection("pymol", "chain A and resi 10-20"));
const selection = resolve(query, data);
```

Load/parse once and retain the query. Parsing errors belong to the caller; there
is no implicit string `select` prop or renderer/parser dependency in this
package.

### Invalidation

`deps` records which revision streams a resolution read. Structural queries read
`topology`/`attributes`, and `within` also reads `positions`.
`isStale(sel, data)` returns true once any stream it read has advanced (for
example after `withPositions`). Structural selections survive a coordinate-only
update; position-dependent ones do not.

`preserveBondGraph(source, snapshot)` binds a coordinate snapshot to the
source's chemical graph when both share one dataset topology. The viewer uses
this for GPU coordinate readbacks: connected selections keep the same chemical
edges, including after attribute-only updates, while position predicates still
read the snapshot's current coordinates. It does not change declared bond rows
or the table's display bond inference.

### Selection expressions

`compile(expr)` accepts the MolQL expression tree that Mol*'s mol-script uses,
as plain JSON, for example:

```js
const cysSulfur = compile({
  head: { name: "structure-query.generator.atom-groups" },
  args: {
    "residue-test": {
      head: { name: "core.rel.eq" },
      args: [{
        head: {
          name: "structure-query.atom-property.macromolecular.label_comp_id",
        },
      }, "CYS"],
    },
    "atom-test": {
      head: { name: "core.rel.eq" },
      args: [{
        head: { name: "structure-query.atom-property.core.element-symbol" },
      }, "S"],
    },
  },
});
```

The language is a closed subset (`supportedSymbols`); anything else throws at
compile time. Evaluation ports Mol*'s semantics and resolves to an ordinary atom
`Selection`. This package has no text parser: MolScript, PyMOL, VMD and Jmol
strings are parsed by `@molgpu/io`. Accepted differences from Mol*: queries see
the asymmetric unit only; `label_*` and `auth_*` atom and component names read
the same column; bonds are the table's (`bondTopology`), so `include-connected`
depends on positions when bonds are inferred.

Grouping stays inside evaluation. `atom-groups :group-by` (MolScript's
`sel.atom.res`) and the per-set filters (`pick`, `first`, `within`,
`intersected-by`, `with-same-atom-properties`, `is-connected-to`) act on atom
sets, but `resolve` always returns the flat union.

Mol*'s quirks are kept, so results match Mol* exactly
(`test/selection/oracle.test.ts`):

- `within` without `:min-radius` (PyMOL `around`) widens the cutoff by each
  selected atom's VDW radius.
- A residue or chain test reads the first atom of the residue or chain.

Bond tests use a typed bond graph. Without declared bonds it ports Mol*'s bond
computation (component templates, element pair thresholds, metal coordination)
over the table's `links`; with declared bonds it is those bonds plus `links`,
and bonds without flags are of unknown type, so the default covalent-only test
skips them. `type.bond-flags` accepts both Mol*'s names (`metal-coordination`,
`hydrogen-bond`) and MolQL's (`metallic`, `hydrogen`). `surrounding-ligands`
needs `chains.entityType` and does not treat PRD molecules (`pdbx_molecule`)
specially.

Two deliberate differences:

- `not X` (`query-in-selection :in-complement`) is the whole current input when
  `X` matches nothing. Mol* returns nothing there, so PyMOL
  `polymer and not hydro` selected nothing on structures without hydrogens.
- `core.mass` gives carbon 12.011. Mol*'s table lists boron's 10.81.

### Set operations and conversions

`union` / `intersect` / `difference` act on resolved selections and reject
mixing datasets, domains or inconsistent revisions. Results stay sorted and
deduplicated.

Conversions cross domains and keep a source map back to the originating rows,
for picking and field lookup:

- `toAtoms`: residue→atom expansion keeps `source.rows[k]` = the residue row of
  atom `indices[k]`; bond→atom unions both endpoints (deduplicated).
- `toResidues`: collapse to the residues an atom or bond selection touches.
- `toBonds(sel, data, { endpoints })`: `both` keeps bonds whose endpoints are
  both selected, `either` keeps any touched bond; `source.a`/`source.b` are the
  endpoint atom rows per bond.

Empty selections are valid and explicit (`isEmpty`, `count`).

## API

| Export               | Stability    | Description                                                                                                                                                       |
| -------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SelectionView`      | experimental | Model/conformer eligibility policy; omitted axes inherit evaluation defaults.                                                                                     |
| `and`                | experimental | Query-valued boolean operations normalized to atoms.                                                                                                              |
| `or`                 | experimental | Query-valued boolean operations normalized to atoms.                                                                                                              |
| `not`                | experimental | Query-valued boolean operations normalized to atoms.                                                                                                              |
| `attribute`          | experimental | Numeric atom/residue column predicate with declared input names.                                                                                                  |
| `protein`            | experimental | Protein / DNA-or-RNA atoms by table polymer classification.                                                                                                       |
| `nucleic`            | experimental | Protein / DNA-or-RNA atoms by table polymer classification.                                                                                                       |
| `water`              | experimental | Water atoms / nonpolymer nonwater atoms (including ions).                                                                                                         |
| `ligand`             | experimental | Water atoms / nonpolymer nonwater atoms (including ions).                                                                                                         |
| `chain`              | experimental | Chain ID or inclusive sequence range, author namespace by default.                                                                                                |
| `residues`           | experimental | Chain ID or inclusive sequence range, author namespace by default.                                                                                                |
| `secondaryStructure` | experimental | Polymer helix H/G/I, sheet E/B, or coil through ssKind.                                                                                                           |
| `model`              | experimental | One model, declaring its explicit view scope.                                                                                                                     |
| `allModels`          | experimental | Independent scope-axis opt-outs.                                                                                                                                  |
| `allConformers`      | experimental | Independent scope-axis opt-outs.                                                                                                                                  |
| `withView`           | experimental | Override inherited query view axes, including conflicts.                                                                                                          |
| `all`                | stable       | Query for every row of a domain (default `atom`).                                                                                                                 |
| `where`              | stable       | Query from a labelled row predicate `(data, row) => boolean`, run once at resolve time.                                                                           |
| `element`            | stable       | Query for atoms with a given atomic number.                                                                                                                       |
| `comp`               | stable       | Query for residues whose chemical component name is in a list.                                                                                                    |
| `within`             | stable       | Query for atoms within a distance (Angstrom) of an inner query; depends on positions.                                                                             |
| `resolve`            | stable       | Resolve a query against one `StructureData` into a `Selection`.                                                                                                   |
| `union`              | stable       | Union of two selections from the same dataset and domain.                                                                                                         |
| `intersect`          | stable       | Intersection of two selections from the same dataset and domain.                                                                                                  |
| `difference`         | stable       | Rows in the first selection but not the second.                                                                                                                   |
| `toAtoms`            | stable       | Expand a residue or bond selection to atoms, keeping a residue source map.                                                                                        |
| `toResidues`         | experimental | Collapse a selection to the residues it touches.                                                                                                                  |
| `toBonds`            | experimental | Bonds incident on a selection (`endpoints: 'both' \| 'either'`), with endpoint source map.                                                                        |
| `isStale`            | experimental | True once any revision stream the selection read has advanced on `data`.                                                                                          |
| `preserveBondGraph`  | advanced     | Bind a coordinate snapshot to the source dataset's chemical graph after checking topology identity.                                                               |
| `isEmpty`            | experimental | True when a selection has no rows.                                                                                                                                |
| `count`              | stable       | Number of rows in a selection.                                                                                                                                    |
| `compile`            | experimental | Compile a `SelectionExpr` (MolQL expression tree) into an atom query; label and deps are derived from the expression. Unsupported symbols throw.                  |
| `supportedSymbols`   | experimental | The MolQL symbol names `compile` accepts (the Phase 1 allowlist).                                                                                                 |
| `Selection`          | stable       | Type: a resolved, dataset-, domain- and revision-bound set of sorted indices.                                                                                     |
| `SelectionQuery`     | stable       | Type: a pure, dataset-independent query recipe. Opaque: build with the query constructors; `type`, `domain`, `label`, `deps`, `attributes` and `view` are public. |
| `Domain`             | stable       | Type: `'atom' \| 'residue' \| 'bond'`.                                                                                                                            |
| `SelectionExpr`      | experimental | Type: a MolQL expression as plain JSON: a literal, `{ name }`, or `{ head, args }`.                                                                               |

## Place in the dependency graph

`@molgpu/select` depends only on `@molgpu/table` (runtime) and is consumed by
`@molgpu/viewer` and the examples. It sits beside `@molgpu/fields` above
`table`.

It must not import `molstar` (only `@molgpu/io` may), any `@use-gpu/*` package
(only `@molgpu/viewer` may import `live`/`workbench`/`shader`), or any other
`@molgpu/*` package besides `table`. Its public types must not mention GPU,
use.gpu or Mol* concepts.

Run `deno task test` from the repository root.
