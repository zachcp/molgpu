# Per-atom charge (Phase 14 plan)

Decision record for molgpu-sept-1to.1. It answers the six questions on that bead
and amends build beads 1to.3–1to.8. The counter-review (1to.2) at the end of
this note attacked it before any build bead started. Accepted findings are
already folded into the body below. It builds on the Phase 10 attribute channels
(`docs/findings/2026-09-26-attribute-channels-plan.md`), which shipped
`withAttributes`, `attributeColumn` and the well-known `formalCharge` /
`partialCharge` names.

## What the code does today (evidence)

| Piece                         | Today                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `topology.atoms.formalCharge` | Optional `Int8Array`, written by `structureFromBcif` only when `atom_site.pdbx_formal_charge` exists (922.13). io reads every value with `float(row) ?? 0` and ignores the value kind.           |
| Corpus charges                | All seven fixtures carry the field, but every row is `?` (value kind Unknown), including the Cl⁻ ions in 4c7r and the heme iron in 1tqn. None has a known charge, zero or otherwise.             |
| Resolver                      | `attributeColumn(data, "formalCharge")` returns a derived column first, else the topology column with provenance `legacy`.                                                                       |
| Well-known names              | `formalCharge` (atom, `Int8Array`, code), `partialCharge` (atom, `Float32Array`, scalar) and `ssCode` are pinned in `@molgpu/table`.                                                             |
| `attribute()` lifting         | Only a _well-known_ residue column lifts to atoms (`fields/src/index.ts`, `lift = known === "residue" && ...`). A namespaced residue column cannot be lifted today.                              |
| Radii                         | `createStructure` rejects any `atoms.radius` ≤ 0.                                                                                                                                                |
| Altlocs and models            | `activeAtoms(data)` in `@molgpu/table` picks the first model and the primary conformer. 1ejg has 381 altloc atoms and 419 hydrogens; 2k39 has 116 models.                                        |
| Selections                    | `pdbx_formal_charge` reads through the resolver and throws when the column is absent.                                                                                                            |
| Readers                       | `@molgpu/io` reads structures only from BinaryCIF. There is no PDB-format text reader. `polymerKind` knows HID/HIE/HIP/ASH/GLH/LYN (as Mol* does), not CYX/CYM or N/C-prefixed names.            |
| Mol* PQR                      | `parsePDB(data, id, "pqr")` reads the charge from fixed columns 55–62 and drops the radius ("TODO: radius").                                                                                     |
| Mol* charge colouring         | `mol-theme/color/partial-charge.js`: domain `[-1, 1]`, red-white-blue.                                                                                                                           |
| `@molgpu/dynamics`            | Scaffolded by Phase 13 (9g3.3): renderer-free, CPU reference code plus WGSL strings. The scaffold is not yet on `main` or this branch.                                                           |
| Local template reference      | PyMOL bundles PDB2PQR 2.1.2 (`/Applications/PyMOL.app/.../site-packages/src/dat/AMBER.DAT`, "Amber 99 parameters"). It is a local cross-check only; the pinned copy comes from upstream (see 4). |

## 1. Columns

- **`formalCharge`**: atom, `Int8Array`, code. **`partialCharge`**: atom,
  `Float32Array`, scalar, in elementary charges (e). Both enter only through
  `withAttributes` with a provenance. Nothing new goes into topology.
- **One implementation, one copy, for formal charge.** `structureFromBcif` sets
  only the derived column and stops writing `topology.atoms.formalCharge`.
  Nothing outside the resolver reads the topology field, so no consumer changes.
  The provenance is `imported:mmcif` when at least one `pdbx_formal_charge` row
  is present (not `?` or `.`), and a row that is unknown reads 0, as in Mol*.
  When the field is missing or every row is unknown, the column is zeros with
  provenance `default`. So the whole corpus resolves as `default`. Mol* reads a
  missing value as 0, so a structure from io always resolves `formalCharge`.
  Selections, fields and 922.13 all read the same resolver, and nothing parses
  mmCIF twice.
- The topology field stays in the type for hand-built structures, which resolve
  it as `legacy`. Structures built by hand keep today's behaviour: no column
  means `pdbx_formal_charge` selections throw by name.

## 2. Sources, in order

1. **mmCIF `pdbx_formal_charge`** (1to.3): above.
2. **PQR import** (1to.4): a new tokenised reader in `@molgpu/io`, not Mol*'s.
   PDB2PQR writes whitespace-separated fields that drift out of the PDB columns
   once coordinates or serials widen, and Mol* drops the radius. Mol* stays the
   oracle on column-aligned fixtures. Elements are guessed with Mol*'s
   `guessElementSymbolString`, which io may import (lkd.8). The input is
   `string | Uint8Array`, tokenised one line at a time.
   - `structureFromPqr(text)` builds a structure. Topology comes from
     ATOM/HETATM records (with an optional chain ID and insertion code).
     `partialCharge` is set with `imported:pqr`. The raw PQR radii go into
     `pqr:radius` (atom, scalar, `imported:pqr`). `atoms.radius` takes the PQR
     radius where it is positive and the element radius where it is 0 (AMBER
     hydroxyl and water hydrogens have radius 0, which `createStructure`
     rejects). The report counts the substitutions. Force-field residue names
     that PDB2PQR writes (CYX, CYM, and any N/C-prefixed terminal names seen in
     the fixture) classify as protein, and the name is kept in `comp`.
   - `applyPqr(data, text)` returns
     `{ data, report: { matched, unmatchedAtoms, unmatchedRecords,
     residueDelta } }`.
     It matches by (auth chain, auth seq, insertion code, atom name), because
     PDB2PQR may rename residues (HIS→HIE, CYS→CYX). The structure is indexed by
     residue first, and atom names are looked up within the residue, so no
     per-atom string key is built. The same record applies in every model, and
     every altloc copy of an atom gets the record's charge. When the PQR has no
     chain IDs and two chains share a (seq, insertion code), `applyPqr` throws
     and names the ambiguity. Hydrogen records that don't exist in `data` fold
     their charge onto the nearest heavy atom of the same residue within 1.3 Å,
     in the PQR's own coordinates, if that heavy atom matched. That keeps
     residue net charge when a heavy-atom crystal structure gets all-atom
     charges. Structure atoms with no record get 0 and appear in the report.
     `residueDelta` lists residues whose assigned sum differs from the PQR
     residue's sum by more than 1e-3 e, for example heavy atoms that PDB2PQR
     rebuilt and the structure lacks. Radii are not applied by `applyPqr`,
     because display radii are a topology column. They are available as
     `pqr:radius` if a caller wants them.
3. **Residue templates** (1to.5, in `@molgpu/dynamics`):
   `templateCharges(data, options)` returns
   `{ values: Float32Array, assigned: Uint8Array, report }`. The caller applies
   it with provenance `template:amber-pdb2pqr`. The function is pure CPU and has
   no viewer dependency.
   - Standard amino acids, DNA/RNA nucleotides and water. Each atom's charge is
     looked up by (component, atom name). The component is `atoms.comp` when
     present (microheterogeneity, 1ejg), else `residues.comp`. Lookup is per
     residue template first, then per atom name within it.
   - Names: AMBER.DAT uses force-field names (O1P/O2P, H5'1, WAT/OW/HW). The
     generator emits an alias table for PDB v3 names (OP1/OP2, H5'/H5'',
     HO5'/HO3', HOH/O and so on) from the PDB2PQR name files plus explicit
     additions, so standard residues in the corpus match with no unmatched heavy
     atom.
   - Hydrogens: **per heavy atom**, each template hydrogen that is absent from
     `data` has its charge summed onto the heavy atom it bonds to in the
     template. Hydrogens that are present keep their own charge. A heavy-atom
     crystal structure gets united-atom charges, an all-atom structure gets
     all-atom charges, and a structure with riding or polar-only hydrogens gets
     a consistent mix. Either way the residue's net charge is the template's
     integer.
   - Defaults: pH-7 charge states (ASP−, GLU−, LYS+, ARG+). AMBER.DAT has no
     plain HIS: HIS is HIE unless the residue's hydrogens say otherwise (HD1
     only → HID, both → HIP). Cysteine is CYX when a link carries the disulfide
     flag or, without links, when SG–SG is under 2.5 Å (as PDB2PQR does);
     otherwise CYS. The first and last observed polymer residue of each chain
     take the N/C (protein) or 5/3 (nucleic) template variants, which change the
     whole residue's charges, not only the terminus. A nucleic 5′ residue that
     has P uses the internal template. Internal chain breaks (C–N or O3′–P over
     2 Å) keep internal templates and are listed in `report.gaps`.
   - Overrides: `options.his` (`"HID" | "HIE" | "HIP"`) globally, and
     `options.residues`, a map from `residueKey` to a template name (`"ASH"`,
     `"GLH"`, `"LYN"`, `"HIP"`...), for known exceptions.
   - Monatomic ions (NA, K, CL, MG, CA, ZN, MN, FE...) take a nonzero imported
     formal charge, else a small component table of standard charges. AMBER.DAT
     has no ions, so that table is ours, cited to the wwPDB Chemical Component
     Dictionary. An imported 0 does not override it, because io cannot tell a
     real 0 from `?` per row. The report names the source per ion.
4. **Gasteiger–Marsili** (1to.7, in `@molgpu/dynamics`): PEOE over bonds for het
   groups that the templates don't cover, with provenance `computed:gasteiger`.
   It needs bond orders, from `links` component templates (every corpus file
   carries `chem_comp_bond`). It runs on connected components of non-polymer
   residues (so a glycan is one component), and only when every bond has a known
   order and every element has parameters. Components linked covalently to a
   polymer residue, and modified polymer residues (MSE, SEP, TPO...), are
   refused by name in the report. It never runs on residues a template already
   covered. The formal charge seeds the initial charges as RDKit does; the
   corpus has none, so a carboxylate is a neutral acid unless the caller sets
   `formalCharge`. Implicit hydrogens come from valence, bond orders and formal
   charge, take part in PEOE, and their charges fold onto the parent heavy atom,
   consistent with the united-atom templates.

A caller combines sources explicitly, for example PQR if given, else templates
plus Gasteiger. Each source returns an `assigned` atom mask, so merging is a
loop, shown in the README. The library has no hidden precedence among
partial-charge sources. A column produced by one source carries that source's
provenance. A merged column names the combination (for example
`template:amber-pdb2pqr.gasteiger`), never only the dominant method; the
per-residue method is in the reports.

## 3. Out of scope, stated

- Protonation-state and pKa prediction, adding hydrogens, and force-field atom
  typing. X-ray structures lack hydrogens and protonation states. The templates
  assume pH-7 defaults, and callers override the known exceptions.
- Atoms that no source covers get 0 and are listed in the report, never silently
  guessed. `report.unmatched` is aggregated by (component, atom name) with
  counts and the first residue keys, so it stays small at 1M atoms.
  `report.netCharge` gives the total over `activeAtoms(data)` (first model,
  primary conformer), so altloc copies and NMR models are not double-counted.
- Precomputed partial charges from other formats (Mol* reads the mmCIF
  `sb_ncbr_partial_atomic_charges` categories, MOL2 and PDBQT) are a possible
  later source, not Phase 14.
- Polarisable or geometry-dependent charges (see 6).

## 4. Template data: provenance and licence

- Source: PDB2PQR's `AMBER.DAT` (header "Amber 99 parameters for use with
  PDB2PQR": charge, radius and atom type per residue and atom), its name files,
  and its topology definitions (bonds, for folding hydrogens). PDB2PQR is under
  a BSD-3-Clause-style licence. In 2.1.2 the copyright holders are J. E. Nielsen
  (University College Dublin), N. A. Baker (Battelle Memorial Institute, PNNL)
  and P. Czodrowski & G. Klebe (University of Marburg). The holders and exact
  text at the pinned upstream commit must be copied from that commit, not from
  this note. The Amber distribution's own files are not used.
- A checked-in script (`packages/dynamics/scripts/gen-templates.ts`) turns
  pinned copies of those files into `src/templates.generated.ts`. The generated
  file records the upstream commit, the verbatim licence text and citations
  (Cornell et al. 1995; Wang, Cieplak & Kollman 2000; Dolinsky et al. 2004 for
  PDB2PQR). The dynamics `deno.json` licence becomes `MIT AND BSD-3-Clause`, and
  its README names the bundled data.
- Tests check that net charges are integral, that per-atom values match the
  upstream table, and, independently of the generator, that templates agree with
  a PDB2PQR `--ff=AMBER` PQR of a corpus protein applied with `applyPqr` (per
  heavy atom, after hydrogen folding). A few values are also checked by hand
  against Cornell et al. 1995.

## 5. Net charge

- Fields are per-row, so a sum over a residue is not a field. Instead
  `residueNetCharge(data, column = "partialCharge")` in `@molgpu/dynamics`
  returns a residue-domain `Float32Array`, summed over `activeAtoms(data)`. The
  caller stores it as `computed:residue-net-charge` under a namespaced name
  (`charge:residueNet`), not a well-known one. That keeps the table's well-known
  list to three.
- Chain and total net charge are numbers in the report, not columns. Attributes
  have no chain domain, and adding one is out of Phase 14's scope.
- `byCharge(options)` (1to.6) is a diverging colormap centred at 0 (red
  negative, white 0, blue positive) over `attribute("partialCharge")`, matching
  Mol*'s partial-charge theme. `options.domain` defaults to `[-1, 1]` e.
  `options.column` accepts a namespaced residue column such as
  `charge:residueNet`, lifted to atoms. Lifting a custom residue column is a
  small `attribute()` extension in 1to.6, because today only well-known residue
  columns lift. It is CPU/GPU equivalent because it composes `linear` and
  `colormap`.

## 6. GPU EEM/QEq (1to.8), a later rung

- Start it only when a consumer needs charges that follow coordinates, such as
  Phase 16 fields under Phase 17 dynamics, and a CPU EEM reference exists to act
  as the oracle.
- It stays out of the Phase 14 gate. The gate already excludes 1to.8.

## Contract for Phase 16

- `partialCharge` is f32 in e, in topology order, on the GPU through the Phase
  10 shared attribute cache (`useAttributeSource("partialCharge")`). Charges do
  not follow coordinates; the column object changes only through
  `withAttributes`. A packed xyzq buffer, if `<EField>` wants one, is Phase 16's
  cost (16 B/atom, 16 MB at 1M, per coordinate generation).
- Altloc copies and all NMR models carry charges. A Coulomb sum must use
  `activeAtoms` or occupancy weights, or it double-counts (egp.1 decides).

## Memory

- `partialCharge`: 4 B/atom on the CPU (0.4 MB at 100k atoms, 4 MB at 1M), plus
  4 B/atom on the GPU once, only while a field reads it (Phase 10 shared cache).
  `withAttributes` copies its input, so applying a source holds two copies
  transiently (8 MB at 1M). `formalCharge`: 1 B/atom CPU, plus 4 B/atom on the
  GPU when coloured. io no longer writes a second topology copy.
- Template assignment is O(atoms) with one template lookup per residue and a
  small per-template name lookup per atom. Gasteiger is O(iterations × bonds)
  over het groups only.
- PQR text for 1M atoms is about 80 MB. The reader tokenises one line at a time
  into typed arrays and never splits the whole file into an array of lines.
  `applyPqr` indexes the structure by residue (about 100k keys at 1M atoms), not
  by atom.

## Build bead amendments

- **1to.3:** set the derived `formalCharge` in `structureFromBcif`, with
  `imported:mmcif` only when some row is present, else `default` zeros, and stop
  writing `topology.atoms.formalCharge` (CHANGELOG). No corpus fixture has a
  known `pdbx_formal_charge`; every row is `?`. Tests therefore write a
  synthetic BCIF in-test with Mol*'s `CifWriter` (a charged ligand with N+ and
  O− atoms, and a Zn2+ ion), in the same style as the synthetic CCP4 maps. They
  also check that the corpus and a block without the field resolve as `default`,
  and that `pdbx_formal_charge = 0` on such a structure selects every atom, as
  Mol* does. Adding a small real entry with Zn2+ to the corpus is optional and
  needs a download.
- **1to.4:** `structureFromPqr` and `applyPqr` as above. Tests: a PDB2PQR-shaped
  whitespace fixture with wide coordinates and zero hydrogen radii, a Mol*
  oracle on a column-aligned fixture, hydrogen folding that preserves residue
  net charge, altloc and multi-model matching, the chain-less ambiguity error,
  CYX classified as protein, and report contents including `residueDelta`.
- **1to.5:** `templateCharges` and `residueNetCharge` in `@molgpu/dynamics`, the
  generator script, the alias table and the licence header. Acceptance adds: no
  unmatched heavy atom on corpus standard residues (1crn, 1a4y, 1tqn, 4c7r,
  1bna), per-heavy-atom folding on 1ejg, altloc/model-safe net charge on 1ejg
  and 2k39, termini and gap rules, the ion rule on 4c7r Cl⁻, and the PQR
  cross-check once 1to.4's fixture exists. Needs the 9g3.3 scaffold on `main`.
- **1to.6:** depends on 1to.4 instead of 1to.5, because `byCharge` needs a
  `partialCharge` column but not templates. `byCharge` is tested on synthetic
  `withAttributes` columns, including a lifted namespaced residue column. The
  site gallery entry uses 1to.4's PQR fixture.
- **1to.7:** bond-order requirement, implicit hydrogens folded onto parents,
  connected components and the refusal report as above. RDKit fixture numbers
  come from the heavy-atom molecule and are compared as the heavy-atom charge
  plus its implicit hydrogens' charges. RDKit is not a dependency.

## Counter-review (1to.2)

The reviewer did not write the plan. Claims were checked against the code, the
corpus (by parsing all seven fixtures) and a local PDB2PQR 2.1.2 copy bundled
with PyMOL. Upstream PDB2PQR 3.x was not reachable offline, so claims about it
are flagged, not asserted.

1. **The corpus is not "all-zero"; every charge is unknown.** Parsing the
   fixtures with Mol*'s CIF reader shows value kind Unknown (`?`) on every
   `atom_site.pdbx_formal_charge` row, including 4c7r's Cl⁻ and 1tqn's heme
   iron. io reads them as 0 through `float(row) ?? 0`. Labelling that
   `imported:mmcif` asserts a source for values nobody supplied, which the 5wy.2
   counter-review (finding 2) ruled out. _Accepted:_ `imported:mmcif` only when
   some row is present; otherwise `default`. Per-row unknowns inside a present
   column still read 0, as in Mol*. Changes 1to.3.
2. **The ion rule would give 4c7r's chloride a charge of 0.** "Take the formal
   charge from the column when it is imported" meets an Int8 column that cannot
   tell 0 from `?`. _Accepted:_ a nonzero imported charge wins, else the
   component table, and the report names the source. AMBER.DAT (local copy) has
   no ions, so the table is ours, cited to the CCD. Changes 1to.5.
3. __Default zeros change selection semantics, but towards Mol_._* Today an io
   structure without the field throws on `pdbx_formal_charge`. Afterwards it
   matches `= 0` on every atom. Mol* reads a missing column as 0 too, so parity
   improves, and hand-built structures still throw. _Accepted as documented:_ a
   test pins the Mol*-equal behaviour. Changes 1to.3.
4. **Writing formal charge twice is a cost with no reader.** Only `BUILT_INS` in
   table reads `topology.atoms.formalCharge`; select goes through the resolver
   and no io test reads the field. Two copies also create a trap:
   `withAttributes({ formalCharge: null })` would silently fall back to the
   topology copy, labelled `legacy`. _Accepted:_ io writes only the derived
   column; the type keeps the field for hand-built data. Changes 1to.3 (with a
   CHANGELOG entry, since io's output shape changes).
5. **A namespaced residue column cannot be lifted, so the net-charge colouring
   as written fails.** `attribute()` sets `lift` only for well-known residue
   names. `attribute("charge:residueNet", { domain: "atom" })` declares an atom
   column, and evaluation then fails with "has domain residue; expected atom".
   Alternatives: make it well-known (the plan rejects that), or store the net
   charge per atom (10× the memory of a residue column). _Accepted:_ 1to.6 adds
   custom residue-column lifting to `attribute()`, with a CPU/GPU test. It is a
   column option, not new language, so lkd.14 holds. Changes 1to.6.
6. **Altlocs and NMR models double-count net charge, and would double-count
   Phase 16's Coulomb sum.** 1ejg has 381 altloc atoms; 2k39 has 116 models.
   Every copy gets a charge, and a plain sum counts each one. _Accepted:_ net
   charges and report totals sum over `activeAtoms(data)`. The per-atom column
   keeps a charge on every copy, so colouring works on any conformer. Phase 16
   must choose `activeAtoms` or occupancy weights; this is recorded under
   "Contract for Phase 16" for egp.1 and not applied to egp beads here. Changes
   1to.5.
7. **The with/without-hydrogens switch per residue mishandles partial
   hydrogens.** 1ejg has riding hydrogens on some atoms; structures with only
   polar hydrogens are common. A residue-level switch either drops the charge of
   absent hydrogens or double-counts. _Accepted:_ fold per heavy atom, only
   hydrogens absent from `data`. HIS tautomers are inferred from HD1/HE2 when
   present. Changes 1to.5.
8. **Template lookup must use the atom's own component.** Under
   microheterogeneity `residues.comp` is the first atom's component (1ejg
   PRO/SER). _Accepted:_ use `atoms.comp` when present. Changes 1to.5.
9. **Termini and chain breaks are underspecified.** The local AMBER.DAT has
   N/C-prefixed protein variants (NALA, CALA...) and 3/5/N nucleic variants
   (DA3, DA5, DAN...). These re-charge the whole residue, so "NH3+ and COO−
   variants" is too loose. A missing loop must not create charged ends
   mid-chain. _Accepted:_ variants only at the first and last observed polymer
   residue, a 5′ residue with P uses the internal template, gaps are reported.
   Whether PDB2PQR 3.x keeps the same variant names is unverified; the generator
   fails if any needed variant is missing. Changes 1to.5.
10. **Name mapping is part of the template data, and without it DNA fails.** The
    local AMBER.DAT uses O1P/O2P, H5'1/H5'2 and WAT/OW/HW. PDB v3 files (1bna)
    use OP1/OP2 and HOH/O. AMBER.names has only ten residue patches, and NA.xml
    aliases the old `*` names, not OP1/OP2. _Accepted:_ the generator emits an
    alias table. The acceptance is zero unmatched heavy atoms on corpus standard
    residues, which is testable. Changes 1to.5.
11. **"Per-atom values match the upstream table" is circular.** The table is
    generated from that file, so the test only checks the generator against
    itself. _Accepted:_ add an independent check. Apply a PDB2PQR `--ff=AMBER`
    PQR of a corpus protein with `applyPqr` and compare per heavy atom with
    `templateCharges`. Also check a few values by hand against Cornell et al.
    The PQR test needs 1to.4's fixture. Whichever of 1to.4 and 1to.5 lands
    second adds it, and the gate checks it. Changes 1to.5.
12. **The licence statement is partly wrong and cannot be fully verified
    offline.** The local PDB2PQR 2.1.2 headers are BSD-3-style, with copyright
    held by Nielsen (UCD), Baker (Battelle/PNNL) and Czodrowski & Klebe
    (Marburg), not "PNNL and contributors". AMBER.DAT itself has no header, and
    the conda metadata says "BSD-like". The 3.x holders and text were not
    checked. Also, `@molgpu/dynamics` is MIT and would ship BSD data. _Accepted
    as documented:_ section 4 names the 2.1.2 holders and requires the verbatim
    text from the pinned commit. The dynamics licence field becomes
    `MIT AND BSD-3-Clause`. Changes 1to.5.
13. **`structureFromPqr` would throw on real AMBER PQR files.**
    `createStructure` rejects `atoms.radius` ≤ 0, and the local AMBER.DAT gives
    radius 0 to every hydroxyl and water hydrogen (SER HG, TYR HH, WAT HW...).
    _Accepted:_ raw radii go to `pqr:radius`, and `atoms.radius` falls back to
    the element radius where the PQR gives 0. `user:pqrRadius` becomes
    `pqr:radius` (`user` provenance is for application code). Changes 1to.4.
14. **The PQR match key collides across models and altlocs, and it is ambiguous
    without chain IDs.** 2k39 has 116 models with identical keys, and altloc
    copies share names. Charge from rebuilt heavy atoms is lost without notice.
    _Accepted:_ one record applies to every model and altloc copy. Chain-less
    PQR throws on an ambiguous structure. Hydrogens fold only onto a matched
    heavy atom. `residueDelta` reports residues whose sum changed. Changes
    1to.4.
15. **PDB2PQR residue names break polymer classification.** io's `polymerKind`
    (like Mol*'s `AminoAcidNamesL`) knows HID/HIE/HIP but not CYX/CYM, so a PQR
    structure would lose cartoons and `protein` selections at disulfides.
    _Accepted:_ `structureFromPqr` classifies the force-field names it sees in
    the fixture as protein and keeps `comp` unchanged. This departs from Mol*
    for those names, which the test documents. Changes 1to.4.
16. **Element guessing need not be re-derived.** io may import Mol*, and Mol*
    has `guessElementSymbolString`. _Accepted:_ reuse it (lkd.8 and the spirit
    of lkd.10). Changes 1to.4.
17. **At 1M atoms, per-atom string keys cost more than the charges.** A Map of
    1M (chain, seq, icode, name) keys and per-atom `comp+name` concatenations
    cost 100 MB-scale transients, and an unbounded unmatched list could be huge.
    _Accepted:_ index by residue then name, accept `Uint8Array` input, aggregate
    the report. Changes 1to.4 and 1to.5.
18. **A merged column labelled with its dominant method misstates its
    provenance.** That is the invented-provenance problem again. _Accepted:_
    merged columns name the combination, and every source returns an `assigned`
    mask so the merge is a visible loop, not hidden precedence. Changes 1to.5
    and 1to.7.
19. **Gasteiger parity with RDKit is undefined for heavy-atom ligands.** Crystal
    ligands lack hydrogens. RDKit adds implicit hydrogens into PEOE and reports
    their charge separately. Per-residue runs also break glycans across
    glycosidic links, and modified polymer residues are neither templated nor
    clean het groups. _Accepted:_ implicit hydrogens folded onto parents,
    fixtures compared as heavy plus hydrogen charges, connected components of
    non-polymer residues, and explicit refusals (polymer-linked components,
    modified residues, elements without parameters such as heme Fe). Every
    corpus file carries `chem_comp_bond`, so bond orders are available. Changes
    1to.7.
20. **`templateCharges` stretches `@molgpu/dynamics`' identity.** Its README
    says "pure coordinate mathematics" over packed xyz arrays, and the Phase 13
    plan puts parameterisation out of scope. A force-field charge table is a
    small piece of parameterisation. _Rejected_ as a reason to move it. Table is
    the data model and every consumer would pay for the data. A new package is
    scope creep. Dynamics already may import table types (dynamics plan §1).
    _Accepted as documented:_ the dynamics README gains a charge-assignment
    section. Related coupling: the 9g3.3 scaffold exists only uncommitted in the
    main checkout. It is not on `main` or this branch, so 1to.5 and 1to.7 cannot
    start until it merges. Changes 1to.5 and 1to.7 (notes).
21. **`byCharge` needs neither source to be correct.** It is a colormap over a
    column, testable with synthetic `withAttributes` data. Only the gallery
    needs real charges, and "whichever lands first" is not a testable criterion.
    _Accepted:_ 1to.6 depends on 1to.4 instead of 1to.5, and the gallery uses
    1to.4's PQR fixture. The Mol* partial-charge theme defaults (`[-1, 1]`,
    red-white-blue) were checked and match. Dependency changed.
22. **The plan misses cheaper, higher-quality imported charges.** Mol* reads
    ACC2 charges from mmCIF (`sb_ncbr_partial_atomic_charges`) and charges from
    MOL2/PDBQT. _Accepted as documented_ as a later source in section 3. It is
    not added to Phase 14, which already has a PQR import path.
23. **Phase 16 needs a stated GPU and unit contract.** _Accepted as documented:_
    the "Contract for Phase 16" section gives f32 e in topology order through
    the shared attribute cache, no coordinate dependence, xyzq packing as Phase
    16's cost, and the altloc/model rule. Also, `pdbx_formal_charge` selections
    depend on the whole `attributes` revision, so adding `partialCharge`
    re-resolves them. That is correct and cheap. No bead change beyond this
    note; egp.1 should read it.
24. **Invariants hold.** lkd.8: the PQR reader lives in io, Mol* is imported
    only there, plus test oracles. lkd.9: dynamics stays free of use.gpu.
    lkd.11: charges change only attributes, and `byCharge` is style. lkd.14: no
    new MolQL symbols. lkd.19: every charge column enters through
    `withAttributes` with provenance. _Rejected_ as a finding; recorded so the
    gate can check the same list.
