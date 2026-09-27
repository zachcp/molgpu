# Secondary-structure codes and DSSP (Phase 15 plan)

Decision record for molgpu-sept-efv.1. It answers the six questions on that bead
and amends build beads efv.3–efv.8. The counter-review (efv.2) attacks this note
before any build bead starts; its accepted findings are folded into the body
below and listed at the end. It builds on Phase 10's attribute channels
(`docs/findings/2026-09-26-attribute-channels-plan.md`), where `ssCode` is
already a well-known residue `Uint8Array` code column.

## What the code does today (evidence)

| Piece                         | Today                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `residues.secondaryStructure` | Optional `"helix" \| "sheet" \| "coil"` per residue in topology. io fills it from `struct_conf` rows whose `conf_type_id` starts with `HELX` and from `struct_sheet_range`, and writes all-coil when a file has neither (the api.txt comment says "absent otherwise", which is already wrong).                          |
| `secondaryStructureTrace`     | Reads that topology column; a structure without it is all coil. The file comment says no DSSP exists.                                                                                                                                                                                                                   |
| `<Ribbon>`, `<Tube>`          | Memoise the trace (and, for Ribbon, the SS trace) on the snapshot `data` object. Any new `StructureData` (including `withAttributes` of an unrelated column) rebuilds them.                                                                                                                                             |
| Selections                    | `secondary-structure-flags` reads the topology column and throws without it. Fine flags (922.16) are deferred to efv.6. The Phase 8 oracle runs `ss h+s`, `structure H` and `substructure = "helix310"` on every single-model corpus entry, 1bna included, with Mol* in `model` mode.                                   |
| Corpus annotation             | Every corpus `struct_conf` row is `HELX_P`. The fine type is in `pdbx_PDB_helix_class`: 1a4y, 1tqn and 4c7r have class 5 (3-10) helices; no corpus entry has class 3 (pi) or `TURN_*`. 1bna has neither category. io's 3-state projection equals Mol*'s model secondary structure on every corpus residue.              |
| Mol* model SS                 | Reads `pdbx_PDB_helix_class` first, then `conf_type_id` (`SecondaryStructurePdb`, `SecondaryStructureMmcif` tables). Always present for mmCIF: a file without annotation gives all `None`, not an absent property.                                                                                                      |
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
- Provenance: `imported:mmcif`, `default` (io, file without annotation),
  `computed:dssp` (CPU), `gpu:dssp` (GPU snapshot), `legacy` (resolver view of a
  hand-built topology column).
- **Migration, like `formalCharge` in Phase 14:** io always writes the derived
  `ssCode` and stops writing `residues.secondaryStructure`. With a `struct_conf`
  or `struct_sheet_range` category the column is `imported:mmcif`; without
  either it is all zeros with provenance `default`. That is Mol*'s model
  behaviour (all `None`), keeps selections working on every io structure (the
  Phase 8 oracle runs SS keywords on 1bna), and makes no false import claim.
  This overrides the spec's "stays as the compatibility projection": the
  topology field stays for hand-built structures, is marked deprecated, and the
  change goes in CHANGELOG and api.txt. The table resolver exposes a legacy view
  (helix→H, sheet→E, coil→0, provenance `legacy`) when no derived column exists,
  so there is one read path. `secondaryStructureTrace` reads `ssKind` over
  `attributeColumn(data, "ssCode")`, and all-coil without it, exactly as now.

## 2. Selections (922.16)

The flags compute from the column, not on demand. `secondary-structure-flags`
reads `ssCode` through the resolver with an `attributes` dependency, and each
code maps to Mol*'s `SecondaryStructureType` flags: H → helix | alpha, G → helix
| 3-10, I → helix | pi, E → beta | sheet, B → beta | strand, T → turn, S → bend.
Mol*'s selection names carry no handedness, so imported right-handed classes
compare equal. Imported helices that Mol* flags without an alpha, 3-10 or pi bit
(no class and plain `HELX_P`, or classes 2, 4, 7, 8, 9 and 10) are `H` in our
column, so our `alpha` flag is wider than Mol*'s for them. No corpus entry has
one; the oracle test lists that difference. Without a column (hand-built
structures only, since io always writes one), the selection throws by name as
today.

## 3. The oracle: port Mol*'s DSSP

- Port `computeUnitDSSP` and its `dssp/*` modules (INVARIANT 3) with Mol*'s
  defaults (`oldDefinition`, `oldOrdering`). It is DSSP 2.x behaviour. DSSP 4's
  polyproline (kappa) assignment is not in Mol*, so code 8 is reserved and never
  produced in Phase 15. Keep the MIT header with Mol*'s authors and 5.11.0.
- __Port Mol_'s quirks, fix one bug._* A unit's protein residues form a list in
  label_seq order, and "previous/next" means list neighbours even across a
  sequence gap: the H-bond exclusion of i±1, the H placed from the previous
  listed residue's C=O, turns and bridges all use list indices. Other quirks to
  keep: acceptors with an `OXT` are skipped; the energy is computed in Mol*'s
  operation order, capped at -9.9, cutoff `e > -0.5` rejects; the CA search is
  inclusive at 9 Å; the bend peptide check is CA(i)–N(i+1) under 2.5 Å; bridges
  only test `i !== j`; ladders extend every matching ladder and link bulges with
  last-wins and the `nextLadder === 0` sentinel. Mol*'s dihedral angles are
  computed but unused, so they are not ported. The bug: `assignBends` indexes
  `traceElementIndex` with the unit-list index instead of the model residue
  index, so Mol* only assigns S in a unit whose residues start at model residue
  0 (1a4y, 4c7r: S in chain A only). The port uses the right residue.
- __Scope matches Mol_: per unit._* A unit here is one chain in one model.
  H-bonds between chains are not searched, as in Mol*. That misses inter-chain
  sheets, a known Mol* gap. An `interChain` option is a follow-on bead, and it
  is not oracle-comparable.
- **Rows.** `dssp` takes the atom rows to read, like `traceTable`. Backbone
  atoms are the first row with each name (`N`, `CA`, `C`, `O`, `H`) in the
  residue, which is Mol*'s `findAtomOnResidue`. The default rows are
  `activeAtoms(data, { model: "all" })`, so every model of an NMR ensemble gets
  codes. The oracle passes `activeAtoms(data, { model: "all", altloc: "all" })`,
  which reproduces Mol*'s first-in-file altloc (1ejg has four protein residues
  where the max-occupancy conformer is not the first).
- **Neighbour order.** Donors per acceptor are visited in ascending residue
  order, so the bridge list is canonical (Mol*'s order is its grid's). Bridge
  sorting is stable on `partner1`; ladder bulge linking can depend on tie order.
  The oracle traces any mismatch before it is accepted.
- **Where it lives: `@molgpu/table`.** It is pure CPU over `StructureData`, uses
  `spatialGrid` (partitioned by unit) for the 9 Å CA search, and needs no
  renderer. INVARIANT 3 names `@molgpu/geo` for ported kernels, but DSSP is a
  structure traversal over table rows and geo has no table dependency; this is
  the written reason. This keeps efv.5 free of the `@molgpu/dynamics` package,
  which is not on `main` yet. The WGSL for the GPU path goes into
  `@molgpu/dynamics` (efv.7), as the spec says.
- API: `dssp(data, options?) → Uint8Array` (codes per residue) and
  `withSecondaryStructure(data, { mode })` with Mol*'s modes: `model` (keep the
  imported column), `dssp` (always compute) and `auto` (keep an
  `imported:mmcif`, `legacy` or `user` column, compute when the column is absent
  or `default`). `withSecondaryStructure` sets `ssCode` with the right
  provenance.
- The oracle test builds a Mol* `Structure` per model from each corpus BCIF
  (test-only, as `test/selection/oracle.test.ts` does), runs Mol*'s
  `computeDssp`, and compares codes per residue. Residues are matched through
  `atomicHierarchy.atomSourceIndex` of each Mol* residue's first atom, never by
  position: Mol* sorts `atom_site` by entity, chain and seq, so 1a4y's residue
  order is A, C, B, D there. Known difference: our S where Mol* has `-` in a
  unit whose first residue is not model residue 0. 1bna (DNA only) must give all
  zeros. Mol* DSSP takes 0.2–0.3 ms per 2k39 model, so all 116 models run.

## 4. GPU decomposition (efv.7)

Scope: one model's active rows (a coordinate provider's output), with unit ids
as a filter. The Phase 13 cell list has no partitions, so an NMR ensemble would
put every superposed model into each query.

| Stage                                            | Parallel over     | Readback-free | Notes                                                                                                                                                                         |
| ------------------------------------------------ | ----------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backbone gather: N, CA, C, O, H rows per residue | residues          | yes           | Row table uploaded once per topology.                                                                                                                                         |
| H placement from the previous residue's C=O      | residues          | yes           | Mol*'s approximation when H is absent; skipped for a unit's first residue.                                                                                                    |
| CA cell list                                     | CA atoms          | **no**        | Phase 13 reads a bounds summary back to size the dense grid, once per generation, unless the grid is sized once with padding and an overflow flag.                            |
| H-bond energy over CA neighbours (≤ 9 Å)         | acceptor residues | yes           | Keep the donors below -0.5 kcal/mol in a bounded per-acceptor list (cap 8, donor index only; no stage reads the energy). Overflow sets a flag that rides the bridge readback. |
| n-turns (3, 4, 5), H/G/I helices, T              | residues          | yes           | Existence checks on the bond list. Helices are three dispatches (n = 4, 3, 5), since each yields to the flags of the previous one.                                            |
| Bends (S)                                        | residues          | yes           | CA angle plus the CA–N(i+1) peptide check.                                                                                                                                    |
| Bridges (parallel and antiparallel pairs)        | H-bond edges      | yes           | Compact bridge list with an atomic counter. Each entry carries its generating (acceptor, donor, pattern) so the CPU can restore the canonical order.                          |
| Ladders and sheets (E, B)                        | sequential        | **no**        | The bridge list is read back (small: about one entry per sheet residue), sorted canonically and finished on the CPU. The codes are then uploaded again for GPU consumers.     |

So a GPU `ssCode` needs one or two small readbacks per coordinate generation and
a re-upload. It lags the coordinates by those round trips (2–6 frames). It
enters as an `AttributesContext` entry and a CPU copy tagged with the coordinate
generation that produced it, never by replacing the root `StructureData`. It is
not a per-frame live column. The CPU port is the reference. f32 WGSL cannot be
bit-identical to the f64 CPU port at the -0.5 kcal/mol, 9 Å, 2.5 Å and 70°
thresholds, so efv.7's acceptance is identical codes on the corpus except
residues traced to a comparison within 1e-4 of its threshold, which are counted
and reported.

The GPU path pays off only where coordinates live on the GPU (Phase 13 dynamics,
GPU coordinate providers) at sizes where CPU DSSP on a snapshot is too slow.
File trajectories already decode frames on the CPU (Phase 12), so they use CPU
DSSP (see 6). efv.7 starts only after efv.5's timings show the need.

## 5. INVARIANT 4

- **For the cartoon, `ssCode` is a geometry parameter.** Helix and sheet change
  cross-sections and stable-frame block boundaries, so a changed 3-state
  projection rebuilds ribbon geometry. That is not a style change, and the rule
  holds.
- **For colouring it is style.** `bySecondaryStructure` is a field over
  `attr:ssCode`, and changing it never touches geometry.
- __Block boundaries differ from Mol_._* Mol*'s trace iterator folds only helix
  subtypes, so T, S, coil, E and B transitions start new blocks there. Ours use
  the 3-state kind. That is the same on imported corpus annotation, and a
  documented difference on DSSP codes.
- `<Ribbon>` and `<Tube>` memo keys change. The trace keys on
  `(identity, topologyRevision, positionsRevision, rows)`. The SS trace keys on
  the trace plus the `ssCode` column object (Phase 10 keeps unchanged column
  objects identical across revisions), and the ribbon geometry keys on the trace
  plus the content of the 3-state projection, so a T↔S change rebuilds nothing.
  A test checks that an unrelated `withAttributes` rebuilds nothing, that a new
  `ssCode` with the same projection rebuilds no geometry, and that a changed
  projection rebuilds the SS trace and geometry but not the trace.

## 6. When DSSP runs

- **Never implicitly** in io, table or the viewer. Reading a file does not run a
  geometry computation, and a representation never runs DSSP as a side effect.
- io sets `ssCode` from the annotation when the file has a `struct_conf` or
  `struct_sheet_range` category (`imported:mmcif`). Otherwise it writes zeros
  with provenance `default`, which `auto` treats as "no annotation".
- Applications call `withSecondaryStructure(data, { mode: "auto" })`, which is
  Mol*'s default policy, minus Mol*'s "experimental archive entry with no
  annotation stays coil" rule. That rule needs
  `struct.pdbx_structure_determination_methodology`, which no corpus file has.
  Site demos call it explicitly.
- Per-frame (efv.8): file trajectories run CPU DSSP on frames read from
  `TrajectoryData.source` (the Phase 12 amendment), cached per integer frame.
  SS-vs-time plots read the same cache. A per-frame `ssCode` reaches the cartoon
  or a colour field with the coordinates it was computed from (same generation),
  never by replacing the root `StructureData`: the snapshot boundary drops its
  published data when the root resource changes, so the ribbon would blank until
  the next readback. GPU-produced coordinates use CPU DSSP on their snapshot, or
  efv.7 once it is justified.

## Memory

- `ssCode`: 1 B/residue on the CPU, plus 4 B/residue on the GPU while a field
  reads it. At 1M atoms (about 125k residues) that is 0.125 MB CPU and 0.5 MB
  GPU.
- CPU DSSP working set: backbone rows (5 × 4 B), H positions (12 B), the H-bond
  list (about 4 × 12 B), and flags (4 B). That is about 100 B/residue: 1.2 MB at
  100k atoms and 12.5 MB at 1M, transient.
- CPU DSSP time: Mol*'s port takes 5.0 ms for 1166 residues (1a4y) and 13.6 ms
  for 1534 (4c7r, including warm-up), about 4–9 µs per residue. That is about
  50–110 ms at 100k atoms and 0.5–1.1 s at 1M on the main thread. efv.5 records
  our timings at both sizes.
- GPU DSSP: the same per-residue buffers plus the Phase 13 CA cell list (4 B per
  CA for the index, plus grid cells), and the capped H-bond list (8 × 4 B per
  residue: 4 MB at 125k residues). The bridge readback is at most a few hundred
  kB. The corpus maximum is 4 donors per acceptor and 2 acceptors per donor.

## Build bead amendments

- **efv.3:** `SS_CODES`, `ssKind`, the legacy resolver view, io always writing
  `ssCode` (H/E from today's mapping; `imported:mmcif` with a `struct_conf` or
  `struct_sheet_range` category, else zeros with `default`), and deprecating the
  topology field (CHANGELOG, api.txt). `secondaryStructureTrace` and the
  selection flags read the column. The Phase 8 oracle passes unchanged. Also the
  `<Ribbon>` and `<Tube>` memo keys from 5. Cartoon tests stay unchanged.
- **efv.4:** `pdbx_PDB_helix_class` first (1 and 6 → H, 5 → G, 3 → I, others H),
  then `conf_type_id` (`HELX_RH_3T_P`/`HELX_LH_3T_P` → G,
  `HELX_RH_PI_P`/`HELX_LH_PI_P` → I, `TURN_*` → T, `STRN` → B, `BEND` → S), as
  Mol* orders them. Corpus test on 1a4y, 1tqn and 4c7r class 5 helices (real
  data), with per-residue flags equal to Mol*'s model secondary structure on
  every corpus entry (matched by source index); synthetic BCIF (CifWriter) for
  pi helices, turns, strands and bends.
- **efv.5:** `dssp` and `withSecondaryStructure` in `@molgpu/table`, ported per
  unit with the quirks and the bend fix from 3. The Mol* oracle compares codes
  per residue (matched by source index, altloc "all") on every corpus protein
  chain and every 2k39 model, with the one bend difference. Tests for each mode
  on imported, `default`, `legacy` and absent columns. Timings recorded at 100k
  and 1M atoms.
- **efv.6:** `bySecondaryStructure` categorical built-in over `ssCode`;
  selection fine flags from 2 (unblocks 922.16). The selection oracle's SS
  keywords also run with Mol* in `dssp` mode against our DSSP column.
- **efv.7:** stages and readbacks as in 4; one model's active rows; the H-bond
  cap, overflow flag and canonical bridge order; near-threshold acceptance.
  Starts only after efv.5's timings show the need.
- **efv.8:** CPU DSSP on `FrameSource` frames, cached per frame; SS-vs-time data
  from that cache; per-frame codes travel with their coordinates. It no longer
  needs efv.7.

## Counter-review (efv.2)

The reviewer did not write the plan. Corpus facts were checked with Mol*'s CIF
reader and DSSP in a scratch script (since deleted). Findings are recorded with
verdicts; accepted ones are folded into the body above.

1. **io must not leave `ssCode` absent for a file without annotation.** Mol*'s
   model secondary structure is always present for mmCIF (all `None` when the
   file has no `struct_conf`), and the Phase 8 oracle runs `ss h+s`,
   `structure H` and `substructure = "helix310"` on 1bna, which has neither
   category. An absent column makes our selection throw there, so the plan as
   written breaks Phase 8's gate test. Phase 14 solved the same problem for
   `formalCharge` with `default` zeros. _Accepted:_ io writes zeros with
   provenance `default`, `auto` treats `default` as no annotation, and
   `imported:mmcif` is claimed only when a category is present. Changes efv.3,
   efv.5 (mode test matrix) and the 922.16 fallback behaviour.
2. __Mol_'s DSSP never assigns S outside the first unit of a model._*
   `assignBends` reads `traceElementIndex[index]` with the unit-list index, so
   for any unit not starting at model residue 0 it measures CA of another chain
   against N of this one and the peptide check fails. Measured: 4c7r chain A has
   19 S, chains B and C have 0; 1a4y chain A has 29, C, B and D have 0. A
   correct port cannot match "codes identical to Mol*" as written, and
   reproducing the bug would need Mol*'s entity-sorted residue numbering.
   _Accepted:_ fix the index, keep everything else; the oracle allows exactly
   "ours S, Mol* `-`" in such units. Changes efv.5.
3. **Per-residue oracle comparison by position is wrong.** Mol* sorts
   `atom_site` by entity, chain and seq before building the hierarchy, so 1a4y's
   Mol* residue order is A, C, B, D while ours is A, B, C, D; a positional
   comparison of io's current 3-state column against Mol*'s model SS reports 396
   bogus differences on 1a4y and none once matched by
   `atomicHierarchy.atomSourceIndex`. Building a Mol* `Structure` per model is
   practical (the selection oracle already does it, and DSSP costs 0.2–0.3 ms
   per 2k39 model), and source indices are absolute across models. _Accepted:_
   match residues through the first atom's source index; order a unit's residues
   by label_seq like Mol*. Changes efv.4 and efv.5.
4. __Primary altlocs are not Mol_'s altlocs, and the default misses NMR
   models._* Mol* keeps every altloc and takes the first atom with each name
   (`findAtomOnResidue`); `activeAtoms` picks the max-occupancy conformer. 1ejg
   has four protein residues (ASN 12, PHE 13, THR 39, ASP 43) with backbone
   altlocs where those differ. `activeAtoms()` also keeps only the first model,
   which would leave 115 of 2k39's models at 0. _Accepted:_ `dssp` takes rows
   and uses the first row per backbone name; the default is
   `activeAtoms(data, { model: "all" })`; the oracle uses `altloc: "all"`.
   Changes efv.5.
5. __"Port with Mol_'s defaults" underspecifies the quirks the oracle will
   catch._* Unit-list adjacency across sequence gaps, H placement across a gap,
   the OXT acceptor skip, the CA–N(i+1) 2.5 Å bend check, energy operation order
   and the -9.9 cap, the inclusive 9 Å search, bridges testing only `i !== j`,
   ladder last-wins and the `nextLadder === 0` sentinel all change codes if
   "cleaned up". Dihedral angles are computed and never read. Residues without a
   CA put index -1 into Mol*'s grid (undefined behaviour; none in the corpus).
   _Accepted:_ the list is in 3; residues without CA are excluded from the
   search, documented. Changes efv.5.
6. **Bridge order depends on neighbour order.** Mol* sorts bridges stably by
   `partner1` only, so ties keep H-bond edge order, which is Mol*'s
   `GridLookup3D` order; ladder bulge linking is order-sensitive (last-wins).
   `spatialGrid` and the GPU's atomic counter give different orders. Ties that
   change codes need two bulge candidates with the same start, which is rare.
   _Accepted as documented:_ canonical ascending donor order on the CPU, GPU
   entries carry their generating edge so the CPU restores that order, and any
   oracle mismatch is traced before acceptance rather than porting
   `GridLookup3D`. Changes efv.5 and efv.7.
7. **The H-bond cap of 8 is plausible but was unmeasured, and failing a
   per-frame stream on overflow is too harsh.** On the corpus the maximum is 4
   donors per acceptor and 2 acceptors per donor; Mol* keeps every bond under
   -0.5 with no cap. No DSSP stage reads the energies, so the list needs donor
   indices only (4 MB instead of 8 MB at 125k residues). _Accepted:_ cap 8,
   donor indices only, an overflow flag in the bridge readback (no extra
   readback); a static computation throws by name, a per-frame one recomputes
   that generation on the CPU. Changes efv.7.
8. **"Identical codes to CPU DSSP" is not testable for f32 WGSL.** The CPU port
   is f64 like Mol*. Codes flip on comparisons near -0.5 kcal/mol, 9 Å, 2.5 Å
   and 70°; with tens of thousands of candidate pairs on the corpus, an energy
   within f32 error of the cutoff is not unlikely, and over a trajectory it is
   certain. _Accepted:_ identical except residues traced to a comparison within
   1e-4 of its threshold, counted and reported. Changes efv.7 and efv.8.
9. **The H-bond stage is not readback-free, and the GPU column round-trips.**
   The Phase 13 cell list reads a bounds summary back to size its grid, once per
   generation, and has no partitions, so an NMR ensemble's superposed models all
   land in each query. Ladders finish on the CPU, so a GPU `ssCode` is
   GPU→CPU→GPU. Helices are also three ordered dispatches, not one. _Accepted:_
   the table in 4 shows both readbacks and the re-upload; GPU DSSP runs on one
   model's active rows; the column enters `AttributesContext` with a CPU copy
   tagged with its coordinate generation. Changes efv.7.
10. **Per-frame DSSP does not need the GPU for file trajectories, and the plan's
    6 contradicts Phase 12.** The Phase 12 counter-review (5td.2 #10) amended
    efv.8 to read `FrameSource` on the CPU, not playback snapshots; the plan
    reintroduced "throttled CPU DSSP on coordinate snapshots". File frames are
    already decoded on the CPU, so CPU DSSP per integer frame (about 50–110 ms
    at 100k atoms) gives the same user-facing result without efv.7. GPU DSSP
    only helps coordinates that live on the GPU at large sizes. _Accepted in
    part:_ efv.8 uses CPU DSSP on frames with a per-frame cache and drops its
    need for efv.7 (the dependency should be moved to efv.5); efv.7 stays in the
    phase but starts only after efv.5's timings show the need. _Rejected:_
    dropping efv.7, since Phase 13 dynamics has no CPU frames. Changes efv.7 and
    efv.8.
11. **Replacing the root data per frame would blank the ribbon, and a lagging
    column conflicts with Phase 10.** `CoordinateSnapshotBoundary` publishes
    data only while `published.owner === coordinates.resource`, so a new root
    `StructureData` (a new `ssCode` via `withAttributes`) drops the snapshot
    until the next readback. Phase 10 also accepted that consumers reject a
    snapshot whose generation no longer matches, so "lags 1–3 frames, acceptable
    for cartoon snapshots" cannot hold as written. _Accepted:_ per-frame codes
    travel with the coordinates they came from (same generation); efv.8 designs
    that seam. Changes efv.7 and efv.8.
12. **The memo fix is incomplete.** `<Tube>` memoises its trace on the same
    `data` object and rebuilds on any `withAttributes`. Keying ribbon geometry
    on the `ssCode` object also rebuilds it when DSSP only changes T↔S or coil,
    which the 3-state geometry never sees; per frame that is most changes.
    _Accepted:_ Tube gets the same trace keys, and geometry keys on the content
    of the 3-state projection. Changes efv.3.
13. __3-state block boundaries are not Mol_'s._* Mol*'s trace iterator
    normalises helix subtypes only, so T, S, coil, E and B transitions are
    separate blocks there. On imported corpus annotation (helix, sheet, none)
    the two agree. _Accepted as documented:_ stated in 5; no change to the
    ported curve code. No bead change.
14. __The code table loses Mol_ selection flags._* Mol*'s `strn` is Beta |
    BetaStrand, which is B, not E; imported helix classes 2, 4, 7, 8, 9 and 10
    and unclassed `HELX_P` have no alpha bit in Mol* but become H (alpha) here,
    a wider difference than the plan's "unclassed helices only". An extra
    "helix, other" code would make selections exact. _Accepted in part:_ `STRN`
    → B, `BEND` → S, left-handed 3-10 and pi map like right-handed, and the
    documented difference lists every class. _Rejected:_ a ninth code; no corpus
    or archive entry exercises it and it breaks the one-letter DSSP table.
    Changes efv.4 and efv.6.
15. **Stopping `residues.secondaryStructure` contradicts the spec.** The spec
    says the topology field "stays as the compatibility projection"; the plan
    drops it from io. It is a public API change (api.txt, whose comment is
    already wrong), and io's secondary-structure test asserts the all-coil
    column on 1bna. _Accepted as documented:_ follow the Phase 14 precedent (io
    stops writing, the field stays for hand-built data), record it in CHANGELOG
    and api.txt, and say in 1 that this overrides the spec. Changes efv.3.
16. **INVARIANT 3 says ported kernels go to `@molgpu/geo`.** DSSP in
    `@molgpu/table` needs a written reason. DSSP is a traversal over structure
    rows (the invariant's own note says traversal is not portable), and geo has
    no table dependency. _Accepted as documented:_ reason stated in 3, MIT
    header with Mol*'s authors and version. Changes efv.5.
17. __`auto` diverges from Mol_ for archive entries without annotation._* io
    could mirror Mol* by writing `imported:mmcif` zeros for experimental archive
    entries. _Rejected:_ Mol*'s rule needs
    `struct.pdbx_structure_determination_methodology`, which none of the seven
    corpus files has, so it is untestable on real data; computing DSSP for an
    unannotated entry is the more useful viewer default. Documented in 6.
18. **The plan gives memory but not time.** Mol*'s DSSP runs at about 4–9 µs per
    residue, so `auto` on a 1M-atom file without annotation blocks the main
    thread for 0.5–1.1 s, and per-frame CPU DSSP at 100k atoms costs 50–110 ms.
    _Accepted:_ efv.5 records timings at 100k and 1M atoms, and efv.7's start
    depends on them. Changes efv.5 and efv.7.
19. __The selection oracle only runs Mol_ in `model` mode._* That never
    exercises T, S, B, G from DSSP or the fine flags on computed codes.
    _Accepted:_ efv.6 also runs the SS keyword cases with Mol* in `dssp` mode
    against our DSSP column, with the bend difference from 2. Changes efv.6.

## Results: CPU DSSP (efv.5)

- **Oracle.** `packages/io/test/dssp-oracle.test.ts` runs Mol*'s
  `computeUnitDSSP` on every unit of every corpus model and compares codes per
  residue. Residues are matched by source atom row; Mol*'s `atomSourceIndex`
  restarts at 0 in each model, so the test offsets it by the model's first row.
  Every residue matches, including all 116 models of 2k39. The only differences
  are the documented bend-bug cases: 69 residues in 1a4y and 58 in 4c7r where
  the port assigns S and Mol* gives `-`. 1bna has no protein units and gets all
  zeros.
- **Timing** (Deno, Apple silicon, 4c7r tiled into separate chains, second run):
  109,872 atoms (13,806 protein residues) in 52 ms, and 1,001,056 atoms (125,788
  residues) in 516 ms. That is about 4 µs per residue. On 4c7r itself, Mol*
  takes 2.7 µs per residue and the port 4.2 µs. The gap is small allocations in
  the H-bond loop, and closing it is not needed for Phase 15.

## Results: per-frame secondary structure (efv.8)

- **File trajectories:** `frameSecondaryStructure(data, trajectory)` in
  `@molgpu/table` runs CPU DSSP on integer frames read from the source, with a
  byte-capped LRU cache (in-flight frames are shared; failed or aborted frames
  are not cached). `timeline(frames)` gives SS-vs-time. On 2k39 as a trajectory
  (`trajectoryFromModels`), frame k's codes equal DSSP of model k.
- **Displayed cartoon:** `<Ribbon secondaryStructure="dssp">` computes DSSP on
  the coordinate snapshot it draws, as a `withSecondaryStructure` of that
  snapshot's own `StructureData`. Codes and coordinates therefore share one
  generation by construction, and no root data is replaced, so the ribbon does
  not blank. The invalidation matrix checks that a coordinate edit reruns DSSP
  and the SS trace, and that turning DSSP on never rebuilds the trace. A browser
  test with a deliberately held readback was not written, because pairing does
  not depend on readback timing: the codes are derived from the snapshot object
  the ribbon already holds.
- **GPU DSSP (efv.7):** implemented in `@molgpu/dynamics` WGSL stages and
  `@molgpu/viewer` orchestration. `<GpuDssp>` publishes a generation-tagged
  `ssCode` GPU source and CPU copy through the attribute contexts; `<Ribbon>`
  consumes that copy only with a matching coordinate snapshot. A compact CA
  bounds readback sizes the Phase 13 cell list. H-bond lists hold eight sorted
  donors per acceptor, and bridge entries carry the generating edge and pattern
  so CPU ladder completion restores canonical order. Static overflow raises
  `GpuDsspOverflowError`; a live frame recomputes from a full coordinate
  snapshot. The pinned protein corpus (1crn, 1ejg, 1tqn, 1a4y, 4c7r and three
  2k39 models) matched CPU codes exactly; 1a4y had two residues near a threshold
  and zero mismatches. A synthetic dense case exercised donor-cap overflow and
  exact frame fallback. Browser runs on 2026-09-27, replicated 1crn chains:

  |     Atoms | Residues | CPU DSSP | GPU DSSP incl. readbacks | Temporary GPU allocation | Readback | Code differences |
  | --------: | -------: | -------: | -----------------------: | -----------------------: | -------: | ---------------: |
  |   100,062 |   14,076 |  41.4 ms |                  20.1 ms |                  3.39 MB |  71.0 KB |                0 |
  | 1,000,293 |  140,714 | 429.8 ms |                 182.8 ms |                  33.9 MB | 709.7 KB |                0 |

  These are one browser run on this host, including allocation and mapping,
  excluding the input coordinate buffer and returned `ssCode` buffer. Run
  `MOLGPU_DSSP_BENCH=1 deno test -A packages/viewer/test/run-gpu-dssp.mjs` to
  repeat it.
