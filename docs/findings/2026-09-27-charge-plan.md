# Per-atom charge (Phase 14 plan)

Decision record for molgpu-sept-1to.1. It answers the six questions on that bead
and amends build beads 1to.3–1to.8. The counter-review (1to.2) attacks this note
before any build bead starts. It builds on the Phase 10 attribute channels
(`docs/findings/2026-09-26-attribute-channels-plan.md`), which shipped
`withAttributes`, `attributeColumn` and the well-known `formalCharge` /
`partialCharge` names.

## What the code does today (evidence)

| Piece                         | Today                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `topology.atoms.formalCharge` | Optional `Int8Array`, written by `structureFromBcif` only when `atom_site.pdbx_formal_charge` exists (922.13).             |
| Resolver                      | `attributeColumn(data, "formalCharge")` returns a derived column first, else the topology column with provenance `legacy`. |
| Well-known names              | `formalCharge` (atom, `Int8Array`, code) and `partialCharge` (atom, `Float32Array`, scalar) are pinned in `@molgpu/table`. |
| Selections                    | `pdbx_formal_charge` reads through the resolver and throws when the column is absent.                                      |
| Readers                       | `@molgpu/io` reads structures only from BinaryCIF. There is no PDB-format text reader.                                     |
| Mol* PQR                      | `parsePDB(data, id, "pqr")` reads the charge from fixed columns 55–62 and drops the radius ("TODO: radius").               |
| `@molgpu/dynamics`            | Scaffolded by Phase 13 (9g3.3): renderer-free, CPU reference code plus WGSL strings.                                       |

## 1. Columns

- **`formalCharge`**: atom, `Int8Array`, code. **`partialCharge`**: atom,
  `Float32Array`, scalar, in elementary charges (e). Both enter only through
  `withAttributes` with a provenance. Nothing new goes into topology.
- **One implementation for formal charge.** `structureFromBcif` keeps writing
  `topology.atoms.formalCharge` for compatibility, and it also sets the derived
  column. That is `imported:mmcif` when the file has `pdbx_formal_charge`, and
  otherwise zeros with provenance `default`. Mol* reads a missing
  `pdbx_formal_charge` as 0, so a structure from io always resolves
  `formalCharge`. Selections, fields and 922.13 all read the same resolver, so
  922.13 consumes this and nothing parses mmCIF twice. The topology field is
  marked deprecated in its doc comment and is removed in a later major.
- Structures built by hand (not from io) keep today's behaviour: no column, and
  `pdbx_formal_charge` selections throw by name.

## 2. Sources, in order

1. **mmCIF `pdbx_formal_charge`** (1to.3): above.
2. **PQR import** (1to.4): a new tokenised reader in `@molgpu/io`, not Mol*'s.
   PDB2PQR writes whitespace-separated fields that drift out of the PDB columns
   once coordinates or serials widen, and Mol* drops the radius. Mol* stays the
   oracle on column-aligned fixtures.
   - `structureFromPqr(text)` builds a structure. Topology comes from
     ATOM/HETATM records (with an optional chain ID and insertion code), and
     `atoms.radius` comes from the PQR radius. `partialCharge` is set with
     `imported:pqr`. Elements are guessed from the atom name, the way Mol* does
     it for PQR.
   - `applyPqr(data, text)` returns
     `{ data, report: { matched, unmatchedAtoms, unmatchedRecords } }`. It
     matches by (auth chain, auth seq, insertion code, atom name), because
     PDB2PQR may rename residues (HIS→HIE, CYS→CYX). Hydrogen records that don't
     exist in `data` fold their charge onto the nearest heavy atom of the same
     residue within 1.3 Å, in the PQR's own coordinates. That keeps residue net
     charge when a heavy-atom crystal structure gets all-atom charges. Structure
     atoms with no record get 0 and appear in the report. Radii are not applied
     by `applyPqr`, because display radii are a topology column. They are
     available as `user:pqrRadius` if a caller wants them.
3. **Residue templates** (1to.5, in `@molgpu/dynamics`):
   `templateCharges(data, options)` returns `{ values: Float32Array, report }`.
   The caller applies it with provenance `template:amber-pdb2pqr`. The function
   is pure CPU and has no viewer dependency.
   - Standard amino acids, DNA/RNA nucleotides and water. Each atom's charge is
     looked up by (component, atom name).
   - Residues **without hydrogens** use united heavy-atom charges: each
     hydrogen's charge is summed onto the heavy atom it bonds to in the
     template. Residues **with hydrogens** (NMR, PQR-derived) use the all-atom
     charges. Either way the residue's net charge is the template's integer.
   - Defaults: pH-7 charge states (ASP−, GLU−, LYS+, ARG+). HIS is neutral HIE.
     Cysteine is CYX when it has a disulfide bond (bond flags or links),
     otherwise CYS. Protein chain ends get NH3+ and COO− terminal variants. The
     same applies to 5′/3′ ends for nucleic acids.
   - Overrides: `options.his` (`"HID" | "HIE" | "HIP"`) globally, and
     `options.residues`, a map from `residueKey` to a template name (`"ASH"`,
     `"GLH"`, `"LYN"`, `"HIP"`...), for known exceptions.
   - Monatomic ions (NA, K, CL, MG, CA, ZN, MN, FE...) take their formal charge
     from the `formalCharge` column when it is imported, else from a small
     component table.
4. **Gasteiger–Marsili** (1to.7, in `@molgpu/dynamics`): PEOE over bonds for het
   groups that the templates don't cover, with provenance `computed:gasteiger`.
   It needs bond orders, from `links` component templates, so it runs only on
   residues whose bonds all have known orders. Other residues are refused by
   name in the report. It never runs on residues a template already covered, and
   the formal charge seeds the initial charges as RDKit does.

A caller combines sources explicitly, for example PQR if given, else templates
plus Gasteiger. The library has no hidden precedence among partial-charge
sources; the column's provenance names the one that produced it. For mixed
provenance, a single `partialCharge` column carries the dominant method, and the
per-residue method is in the report.

## 3. Out of scope, stated

- Protonation-state and pKa prediction, adding hydrogens, and force-field atom
  typing. X-ray structures lack hydrogens and protonation states. The templates
  assume pH-7 defaults, and callers override the known exceptions.
- Atoms that no source covers get 0 and are listed in the report, never silently
  guessed. `report.unmatched` names residue keys and atom names, and
  `report.netCharge` gives the total.
- Polarisable or geometry-dependent charges (see 6).

## 4. Template data: provenance and licence

- Source: PDB2PQR's `AMBER.DAT` (AMBER ff99 charges) and its topology
  definitions (bonds, for folding hydrogens), BSD-3-Clause, © Pacific Northwest
  National Laboratory and contributors. The Amber distribution's own files are
  not used; their licensing is less clear.
- A checked-in script (`packages/dynamics/scripts/gen-templates.ts`) turns
  pinned copies of those files into `src/templates.generated.ts`. The generated
  file records the upstream commit, the licence text and citations (Cornell et
  al. 1995; Wang, Cieplak & Kollman 2000; Dolinsky et al. 2004 for PDB2PQR).
  Tests check that net charges are integral and that per-atom values match the
  upstream table.

## 5. Net charge

- Fields are per-row, so a sum over a residue is not a field. Instead
  `residueNetCharge(data, column = "partialCharge")` in `@molgpu/dynamics`
  returns a residue-domain `Float32Array`. The caller stores it as
  `computed:residue-net-charge` under a namespaced name (`charge:residueNet`),
  not a well-known one. That keeps the table's well-known list to three.
- Chain and total net charge are numbers in the report, not columns. Attributes
  have no chain domain, and adding one is out of Phase 14's scope.
- `byCharge(options)` (1to.6) is a diverging colormap centred at 0 (red
  negative, white 0, blue positive) over `attribute("partialCharge")`.
  `options.domain` defaults to `[-1, 1]` e, and `options.column` accepts the
  residue net-charge name with `{ domain: "atom" }` lifting. It is CPU/GPU
  equivalent because it composes `linear` and `colormap`.

## 6. GPU EEM/QEq (1to.8), a later rung

- Start it only when a consumer needs charges that follow coordinates, such as
  Phase 16 fields under Phase 17 dynamics, and a CPU EEM reference exists to act
  as the oracle.
- It stays out of the Phase 14 gate. The gate already excludes 1to.8.

## Memory

- `partialCharge`: 4 B/atom on the CPU (0.4 MB at 100k atoms, 4 MB at 1M), plus
  4 B/atom on the GPU once, only while a field reads it (Phase 10 shared cache).
  `formalCharge`: 1 B/atom CPU, plus 4 B/atom on the GPU when coloured. The
  deprecated topology copy adds 1 B/atom until it is removed.
- Template assignment is O(atoms) with one hash lookup per atom. Gasteiger is
  O(iterations × bonds) over het groups only.
- PQR text for 1M atoms is about 80 MB. The reader tokenises one line at a time
  into typed arrays and never splits the whole file into an array of lines.

## Build bead amendments

- **1to.3:** set the derived `formalCharge` in `structureFromBcif` (either
  `imported:mmcif` or `default` zeros) and deprecate the topology field. No
  corpus fixture has a nonzero `pdbx_formal_charge`; all seven are all-zero.
  Tests therefore write a synthetic BCIF in-test with Mol*'s `CifWriter` (a
  charged ligand with N+ and O− atoms, and a Zn2+ ion), in the same style as the
  synthetic CCP4 maps. They also check that the corpus resolves as
  `imported:mmcif` zeros and that a block without the field resolves as
  `default`. Adding a small real entry with Zn2+ to the corpus is optional and
  needs a download.
- **1to.4:** `structureFromPqr` and `applyPqr` as above. Tests: a PDB2PQR-shaped
  whitespace fixture with wide coordinates, a Mol* oracle on a column-aligned
  fixture, hydrogen folding that preserves residue net charge, and report
  contents.
- **1to.5:** `templateCharges` and `residueNetCharge` in `@molgpu/dynamics`, the
  generator script and the licence header. Acceptance unchanged.
- **1to.6:** depends on 1to.4 instead of 1to.5, because `byCharge` needs a
  `partialCharge` column but not templates. Site gallery entry uses PQR or
  template charges, whichever lands first.
- **1to.7:** bond-order requirement and refusal report as above. RDKit fixture
  numbers are stored and RDKit is not a dependency.
