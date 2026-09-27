# Derived attribute channels (Phase 10 plan)

Decision record for molgpu-sept-5wy.1. It answers the six questions on that bead.
Build beads 5wy.3–5wy.5 point here. The counter-review (5wy.2) attacks this
note before any build bead starts. Phases 14 (charge) and 15 (secondary
structure) build on it.

## What the code does today (evidence)

| Piece                             | Today                                                                                                   | Problem                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `revision.attributes`             | Always 0 (`createStructure`); no setter.                                                                | Nothing can add a column after import.                                                                                              |
| `@molgpu/fields` `ATTRIBUTES`     | A closed map of 8 names with `read(data)`, private to fields (`fields/src/index.ts`).                   | Select and the viewer cannot share it.                                                                                              |
| Viewer `gatherAtomColumns`        | Reads `data.topology.atoms[name]` for every `attr:<name>` binding (`viewer/src/internal/gather.ts`).    | **Bug:** `byChain()` compiles to `attr:atomChain`, which is not an atoms column, so `<Spacefill color={byChain()}>` throws.         |
| Viewer uploads                    | Each representation gathers and uploads its own `attr:*` columns (`spacefill.ts`, `bonds.ts`).          | Two representations colouring by the same column upload it twice.                                                                 |
| Selections                        | `pdbx_formal_charge` reads `topology.atoms.formalCharge`; `occupancy`/`B_iso` declare an `attributes` dep. | Deps already name the stream; no column ever advances it.                                                                         |
| `topology.atoms.formalCharge`     | Optional `Int8Array` from mmCIF (922.13).                                                               | Phase 14 must reconcile it with provenance-aware charge columns, not ingest mmCIF a second time.                                   |

## 1. `withAttributes` and names

```ts
type AttributeDomain = "atom" | "residue";
type AttributeValues = Float32Array | Int8Array | Uint8Array | Int32Array | Uint32Array;

/** Where a column came from. A closed grammar, validated. */
type Provenance =
  | "default"                      // filled because the source had nothing
  | "user"                         // set by application code
  | `imported:${string}`           // imported:mmcif, imported:pqr
  | `template:${string}`           // template:amber-united
  | `computed:${string}`           // computed:dssp, computed:gasteiger
  | `gpu:${string}`;               // gpu:dssp (only via a GPU producer's snapshot)

interface AttributeColumn {
  readonly name: string;
  readonly domain: AttributeDomain;
  readonly values: AttributeValues;     // length = domain row count, read-only
  readonly provenance: Provenance;
  /** "scalar": a measurement. "code": a small integer category. */
  readonly kind: "scalar" | "code";
}

function withAttributes(
  data: StructureData,
  columns: Record<string, AttributeColumnInput | null>, // null removes
): StructureData;
```

- **Well-known names are typed.** A fixed table in `@molgpu/table` pins domain,
  array type and kind: `formalCharge` (atom, `Int8Array`, code),
  `partialCharge` (atom, `Float32Array`, scalar), `ssCode` (residue,
  `Uint8Array`, code). Setting one with the wrong domain or type throws.
- **Custom names must be namespaced**: `<ns>:<name>` matching
  `/^[a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9_-]*$/` (e.g. `user:hydrophobicity`,
  `gpu:test`). They can never collide with a future well-known name, and the
  caller supplies domain and kind. This is a column name, not a language: no
  expressions, no symbol registration, nothing that parses (R5/R6 hold).
- **Built-in topology columns are read-only.** `element`, `occupancy`,
  `bfactor`, `radius`, `residue`, `atomChain`, `labelSeq` and `chain` stay in
  topology. `withAttributes` rejects those names.
- Validation per column: row count equals the domain count, exact typed-array
  constructor, finite floats, provenance matches the grammar. Values are copied
  (as `createStructure` does), so callers keep ownership.

## 2. Where columns live, and revisions

- A new optional `StructureData.attributes: Readonly<Record<string,
  AttributeColumn>>`. Topology is untouched, so `identity`, `revision.topology`
  and every topology cache stay valid.
- `withAttributes` returns a new frozen `StructureData` with the same identity,
  topology and positions, the merged map (unchanged columns shared, not copied),
  and `revision.attributes` bumped from the same per-identity counter that
  `withPositions` uses, so branch revisions never collide.
- `withPositions` keeps `attributes` as they are. A column computed from
  coordinates (DSSP, per-frame anything) is **not** invalidated by a coordinate
  change. Its producer owns freshness (see 5), and provenance says what it was
  computed from. This keeps positions and attributes orthogonal.
- **One resolver for everyone:** `attributeColumn(data, name)` in
  `@molgpu/table` returns an `AttributeColumn`-shaped view for built-in topology
  columns (with provenance `imported:<source>`, or `default` for derived ones
  like `atomChain`, cached per identity), then for derived columns. It returns
  `undefined` when the dataset lacks the column. `attributeNames(data)` lists
  what resolves. Fields, select and the viewer gather all read through it. This
  fixes the `byChain()` bug as a side effect.
- **`formalCharge` precedence:** a derived `formalCharge` column (from
  `withAttributes`) wins; otherwise the resolver exposes
  `topology.atoms.formalCharge` as `imported:mmcif`; otherwise `undefined`.
  Phase 14 decides whether an absent charge becomes zeros with provenance
  `default`. io keeps writing the topology column, so 922.13 needs no change.

## 3. Fields

- `attribute(name, options?)` accepts a built-in name, a well-known name, or a
  namespaced custom name. Custom names need `options.domain`, because the field
  is built without data. Any other string throws at construction and lists the
  known names.
- Values are read through `attributeColumn` at `evaluate` and in the binding's
  `fill`. A name the dataset lacks throws there, naming the column and listing
  `attributeNames(data)`.
- **Types:** every attribute is a `SCALAR` field lowering to `f32`, as today.
  Code columns hold small integers, which are exact in f32, so `categorical()`
  already works on them. `kind` is metadata for defaults and tooltips; it adds
  no new field type.
- **Residue columns on atoms:** `attribute("ssCode", { domain: "atom" })` lifts
  through `atoms.residue`. CPU evaluation indexes the residue column by
  `atoms.residue[row]`. The GPU emits `field_getR(u32(field_getA(row)))`, with
  a second binding `attr:residue`. Without the option the field keeps the
  column's own domain, and mixing domains still fails.
- Binding ids stay `attr:<name>`, so the viewer contract does not change shape.
- `columnRange(data, name)` resolves through the same function.

## 4. GPU columns and kernel-produced columns

**Shared uploads.** The viewer keeps a refcounted cache per device, keyed by
`(identity, name, provenance revision)`. The key is `revision.topology` for
built-in columns and `revision.attributes` for derived ones. This is the same
shape as the volume buffer cache (`internal/volume-buffers.ts`).
`useAttributeSource(name)` acquires during render and releases on unmount. Each
column is stored as full-domain `f32` rows in topology order, and
representations index it through their selection rows with `indexed()`, as they
do today. Two representations colouring by one column share one upload. Style
changes never touch it (INVARIANT 4). `gatherAtomColumns` and the per-rep
`attr:*` specs in `spacefill.ts` and `bonds.ts` go away.

**Producers.** A GPU kernel can produce a column, following the
coordinate-provider pattern:

```tsx
<AttributeProducer name="gpu:test" domain="atom" kind="scalar" kernel={wgsl}>
  <Spacefill color={colormap(attribute("gpu:test", { domain: "atom" }), stops)} />
</AttributeProducer>
```

- A new `AttributesContext` maps each name to `{ source: StorageSource, domain,
  generation, provenance }`. A producer re-provides it with one added entry,
  scoped to its subtree. It never changes topology, coordinates or other
  columns.
- The producer owns one `ComputeBuffer` (count rows, `f32`) and dispatches with
  `<Kernel initial version={generation}>`. Its generation advances exactly when
  its inputs change: upstream coordinates `generation` and its own params. The
  rule is the one Phase 9 uses.
- `useField` resolves an `attr:<name>` input from `AttributesContext` first,
  then from the shared cache. Fields link against the producer's source, and
  `Binding.fill` is never called for it.
- **CPU values for a GPU-only column:** `useAttributeSnapshot(name, { maxHz })`
  reuses the Phase 9 snapshot machinery. That means demand-driven staging, one
  copy in flight, and stale generations discarded. It publishes
  `withAttributes(data, { [name]: { values, provenance: "gpu:<kernel>" } })`
  for tooltips and `evaluate`. Nothing reads a GPU-only column synchronously.

`@molgpu/fields` and `@molgpu/table` stay free of use.gpu types (INVARIANT 2).
The producer's WGSL is a string, which is how `@molgpu/dynamics` hands off
kernels.

## 5. Per-frame columns

- There are two paths. Neither bumps a CPU revision per frame.
  - **GPU (live):** the column is a producer whose generation follows the
    coordinates generation. Colouring follows every frame, and there are no CPU
    revisions.
  - **CPU (snapshot):** a consumer that needs CPU values (a cartoon rebuilding
    on SS, a plot) reads `useAttributeSnapshot`. That is throttled and bumps
    `revision.attributes` once per published snapshot.
- SS-vs-time plots read frames from `TrajectoryData.source` directly, per the
  Phase 12 counter-review note on efv.8. They do not go through this channel.

## 6. Selections

- `pdbx_formal_charge` reads `attributeColumn(data, "formalCharge")` with an
  `attributes` dep. It keeps today's error when the column is absent.
- No new MolQL symbols in Phase 10. Custom-property symbol registration stays
  forbidden (lkd.14). Phase 15 (efv.6) points the secondary-structure flags at
  `ssCode` through the same resolver.
- Compiled selections already carry `deps`. A selection reading a derived column
  goes stale when `revision.attributes` advances. `SelectionCache` needs no
  change.

## Memory

- CPU: one copy per derived column. That is 4 B/row for f32/i32/u32 and 1 B/row
  for i8/u8. `withAttributes` shares unchanged columns between revisions.
- GPU: 4 B/row per distinct column in use, once per structure, regardless of
  how many representations read it. At 1M atoms that is 4 MB per column, where
  today each representation uploads its own. A producer adds 4 B/row, plus 2
  staging buffers and a CPU copy only while a snapshot consumer is mounted.

## Build bead amendments

- **5wy.3 (table):** `withAttributes`, `attributeColumn`, `attributeNames`, the
  well-known table, the provenance grammar and validation. `StructureResource`
  gains `attributesRevision`. The viewer `gatherAtomColumns` switches to the
  resolver, fixing `byChain()` on Spacefill and Bonds with a regression test.
- **5wy.4 (fields + select):** `attribute()` over the resolver, custom names
  with `domain`, residue→atom lift, `columnRange`, and `pdbx_formal_charge`
  through the resolver. Tests: a scalar column, a code column through
  `categorical`, a lifted residue column (CPU/GPU agreement in
  `test:fields:gpu`), and unknown and absent names.
- **5wy.5 (viewer):** the shared refcounted attribute cache (upload counter),
  `AttributesContext`, `<AttributeProducer>`, `useField` resolution, and
  `useAttributeSnapshot`. Acceptance is unchanged: one upload shared by two
  representations, a test kernel colouring spacefill through a field, and no
  re-upload on style change.
