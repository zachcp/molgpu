# Secondary-structure codes and DSSP (Phase 15 plan)

Decision record for molgpu-sept-efv.1. It answers the six questions on that bead
and amends build beads efv.3–efv.8. The counter-review (efv.2) attacks this note
before any build bead starts. It builds on Phase 10's attribute channels
(`docs/findings/2026-09-26-attribute-channels-plan.md`), where `ssCode` is
already a well-known residue `Uint8Array` code column.

## What the code does today (evidence)

| Piece                         | Today                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `residues.secondaryStructure` | Optional `"helix" \| "sheet" \| "coil"` per residue in topology. io fills it from `struct_conf` rows whose `conf_type_id` starts with `HELX` and from `struct_sheet_range`.                                                                                                                                             |
| `secondaryStructureTrace`     | Reads that topology column; a structure without it is all coil. The file comment says no DSSP exists.                                                                                                                                                                                                                   |
| `<Ribbon>`                    | Memoises the trace and SS trace on the snapshot `data` object. Any new `StructureData` (including `withAttributes` of an unrelated column) rebuilds both.                                                                                                                                                               |
| Selections                    | `secondary-structure-flags` reads the topology column and throws without it. Fine flags (922.16) are deferred to efv.6.                                                                                                                                                                                                 |
| Corpus annotation             | Every corpus `struct_conf` row is `HELX_P`. The fine type is in `pdbx_PDB_helix_class`: 1a4y, 1tqn and 4c7r have class 5 (3-10) helices; no corpus entry has class 3 (pi) or `TURN_*`.                                                                                                                                  |
| Mol* model SS                 | Reads `pdbx_PDB_helix_class` first, then `conf_type_id` (`SecondaryStructurePdb`, `SecondaryStructureMmcif` tables).                                                                                                                                                                                                    |
| Mol* DSSP                     | `computeUnitDSSP` (about 630 lines): per atomic unit, protein residues only, H-bonds found over CA within 9 Å, Kabsch–Sander energy with cutoff -0.5 kcal/mol, defaults `oldDefinition` and `oldOrdering` true. Inter-unit H-bonds are a TODO in Mol*, so sheets between chains are not found. No polyproline (P) code. |
| Mol* `auto`                   | Uses the model's annotation when the model has one or is an experimental PDB-archive entry; otherwise computes DSSP.                                                                                                                                                                                                    |

## 1. The column

- `ssCode`: residue domain, `Uint8Array`, kind `code`. Values are small
  integers, not ASCII, so fields and categorical tables stay compact and exact
  in f32:

  | Code | 0        | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8            |
  | ---- | -------- | - | - | - | - | - | - | - | ------------ |
  | DSSP | `-` coil | H | B | E | G | I | T | S | P (reserved) |

  `@molgpu/table` exports `SS_CODES` (the letters in code order) and
  `ssKind(code)` → `"helix" | "sheet" | "coil"`: H/G/I are helix, E/B are sheet,
  everything else is coil. This matches Mol*'s `mapToKind`, with turn and bend
  folded into coil for the 3-state cartoon.
- Non-protein residues are always 0. DSSP is protein-only in Mol*, and nucleic
  acid helices (`HELX_*_N`) are not mapped. Their cartoon comes from the polymer
  trace, as today.
- Provenance: `imported:mmcif`, `computed:dssp` (CPU), `gpu:dssp` (GPU
  snapshot).
- **Migration, like `formalCharge` in Phase 14:** io writes the derived `ssCode`
  and stops writing `residues.secondaryStructure`. The topology field stays for
  hand-built structures and is marked deprecated. The table resolver exposes a
  legacy view (helix→H, sheet→E, coil→0, provenance `legacy`) when no derived
  column exists, so there is one read path. `secondaryStructureTrace` reads
  `ssKind` over `attributeColumn(data, "ssCode")`, and all-coil without it,
  exactly as now.

## 2. Selections (922.16)

The flags compute from the column, not on demand. `secondary-structure-flags`
reads `ssCode` through the resolver with an `attributes` dependency, and each
code maps to Mol*'s `SecondaryStructureType` flags: H → helix | alpha, G → helix
| 3-10, I → helix | pi, E → beta | sheet, B → beta | strand, T → turn, S → bend.
An imported helix with no class is `H` in our column, but Mol* flags it as plain
helix with no alpha bit. The oracle test documents that one difference: the
`alpha` flag matches classed helices only. Without a column, the selection
throws by name as today.

## 3. The oracle: port Mol*'s DSSP

- Port `computeUnitDSSP` and its `dssp/*` modules (INVARIANT 3) with Mol*'s
  defaults (`oldDefinition`, `oldOrdering`). It is DSSP 2.x behaviour. DSSP 4's
  polyproline (kappa) assignment is not in Mol*, so code 8 is reserved and never
  produced in Phase 15.
- __Scope matches Mol_: per unit._* A unit here is one chain in one model, over
  the active atoms (`activeAtoms`, primary altlocs). H-bonds between chains are
  not searched, as in Mol*. That misses inter-chain sheets, a known Mol* gap. An
  `interChain` option is a follow-on bead, and it is not oracle-comparable.
- **Where it lives: `@molgpu/table`.** It is pure CPU over `StructureData`, uses
  `spatialGrid` for the 9 Å CA search, and needs no renderer. This keeps efv.5
  free of the `@molgpu/dynamics` package, which is not on `main` yet. The WGSL
  for the GPU path goes into `@molgpu/dynamics` (efv.7), as the spec says.
- API: `dssp(data, options?) → Uint8Array` (codes per residue) and
  `withSecondaryStructure(data, { mode })` with Mol*'s modes: `model` (keep the
  imported column), `dssp` (always compute) and `auto` (the imported column when
  present, else DSSP). `withSecondaryStructure` sets `ssCode` with the right
  provenance.
- The oracle test builds a Mol* `Structure` from each corpus BCIF (test-only, as
  `test/selection/oracle.test.ts` does), runs Mol*'s `computeDssp`, and compares
  codes per residue. 1bna (DNA only) must give all zeros.

## 4. GPU decomposition (efv.7)

| Stage                                            | Parallel over      | Readback-free | Notes                                                                                                                                |
| ------------------------------------------------ | ------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Backbone gather: N, CA, C, O, H rows per residue | residues           | yes           | Row table uploaded once per topology.                                                                                                |
| H placement from the previous residue's C=O      | residues           | yes           | Mol*'s approximation when H is absent; skipped for a unit's first residue.                                                           |
| H-bond energy over CA neighbours (≤ 9 Å)         | acceptor residues  | yes           | Phase 13 cell list over CA. Keep the bonds below -0.5 kcal/mol in a bounded per-residue list (cap 8). Overflow fails explicitly.     |
| n-turns (3, 4, 5), H/G/I helices, T              | residues           | yes           | Only existence checks on the bond list.                                                                                              |
| Bends (S)                                        | residues           | yes           | CA angle only.                                                                                                                       |
| Bridges (parallel and antiparallel pairs)        | candidate CA pairs | yes           | Compact bridge list with an atomic counter.                                                                                          |
| Ladders and sheets (E, B)                        | sequential         | **no**        | The compact bridge list is read back (small: about one entry per sheet residue) and finished on the CPU, then written to the column. |

So a GPU `ssCode` always needs one small readback per coordinate generation. It
lags the coordinates by the readback (1–3 frames), which is acceptable for
colouring and for cartoon snapshots. It is not a per-frame live column. The CPU
port is the reference, and efv.7's acceptance (codes identical to CPU DSSP on
the corpus) stands.

## 5. INVARIANT 4

- **For the cartoon, `ssCode` is a geometry parameter.** Helix and sheet change
  cross-sections and stable-frame block boundaries, so a changed column rebuilds
  ribbon geometry. That is not a style change, and the rule holds.
- **For colouring it is style.** `bySecondaryStructure` is a field over
  `attr:ssCode`, and changing it never touches geometry.
- `<Ribbon>`'s memo keys change. The trace keys on
  `(identity, topologyRevision, positionsRevision, rows)`. The SS trace keys on
  the trace plus the `ssCode` column object (Phase 10 keeps unchanged column
  objects identical across revisions). A test checks that an unrelated
  `withAttributes` rebuilds nothing and that a new `ssCode` rebuilds the SS
  trace and geometry but not the trace.

## 6. When DSSP runs

- **Never implicitly** in io, table or the viewer. Reading a file does not run a
  geometry computation, and a representation never runs DSSP as a side effect.
- io sets `ssCode` from the annotation when the file has `struct_conf` or
  `struct_sheet_range` rows. Otherwise it leaves the column absent, rather than
  writing an all-coil column with a claim of `imported:mmcif`.
- Applications call `withSecondaryStructure(data, { mode: "auto" })`, which is
  Mol*'s default policy, minus Mol*'s "experimental archive entry with no
  annotation stays coil" rule. That rule needs archive metadata the table does
  not keep. Site demos call it explicitly.
- Per-frame (efv.8): on a trajectory, `useAttributeSnapshot`-style throttled CPU
  DSSP on coordinate snapshots, or the GPU producer once efv.7 lands. SS-vs-time
  plots read frames directly, as the Phase 12 note on efv.8 says.

## Memory

- `ssCode`: 1 B/residue on the CPU, plus 4 B/residue on the GPU while a field
  reads it. At 1M atoms (about 125k residues) that is 0.125 MB CPU and 0.5 MB
  GPU.
- CPU DSSP working set: backbone rows (5 × 4 B), H positions (12 B), the H-bond
  list (about 4 × 12 B), and flags (4 B). That is about 100 B/residue: 1.2 MB at
  100k atoms and 12.5 MB at 1M, transient.
- GPU DSSP: the same per-residue buffers plus the Phase 13 CA cell list (4 B per
  CA for the index, plus grid cells), and the capped H-bond list (8 × 8 B per
  residue: 8 MB at 125k residues). The bridge readback is at most a few hundred
  kB.

## Build bead amendments

- **efv.3:** `SS_CODES`, `ssKind`, the legacy resolver view, io writing `ssCode`
  (H/E from today's mapping, `imported:mmcif`, absent without annotation) and
  deprecating the topology field. `secondaryStructureTrace` and the selection
  flags read the column. Also the `<Ribbon>` memo keys from 5. Cartoon tests
  stay unchanged.
- **efv.4:** `pdbx_PDB_helix_class` first (1 → H, 5 → G, 3 → I, others H), then
  `conf_type_id` (`HELX_RH_3T_P` → G, `HELX_RH_PI_P` → I, `TURN_*` → T, `STRN` →
  E), as Mol* orders them. Corpus test on 1a4y, 1tqn and 4c7r class 5 helices
  (real data); synthetic BCIF (CifWriter) for pi helices and turns.
- **efv.5:** `dssp` and `withSecondaryStructure` in `@molgpu/table`, ported per
  unit. The Mol* oracle compares codes per residue on every corpus protein chain
  and every 2k39 model.
- **efv.6:** `bySecondaryStructure` categorical built-in over `ssCode`;
  selection fine flags from 2 (unblocks 922.16).
- **efv.7:** stages and readback as in 4; the H-bond cap and overflow error.
- **efv.8:** unchanged apart from pointing at 6.
