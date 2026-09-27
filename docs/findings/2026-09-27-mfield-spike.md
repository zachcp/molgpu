# What `<MField>` should mean (Phase 16 spike, egp.8)

Dated finding for molgpu-sept-egp.8, written after `<EField>` shipped
(`2026-09-27-efield-plan.md`). The question is whether a magnetic counterpart to
`<EField>` would show something true and useful, and which of the two candidates
on the bead to build, if either.

**Recommendation: drop the name `<MField>`. Build neither candidate in the
current roadmap.** If NMR users ask for it, ring-current shielding is worth a
small, separately named feature (`ringCurrentShift`), produced as a Volume with
the `<EField>` machinery. Velocity-derived fields should not be built.

## Why there is no "magnetic field of a molecule" to draw

Static partial charges produce no magnetic field. A molecule's own magnetic
effects are either quantum (spin, electronic currents) or induced by an external
field, as in NMR. So a `<MField>` beside `<EField>` would suggest a symmetry
that the physics doesn't have. Each candidate below is really a different
quantity with its own unit and use.

## Candidate 1: velocity-derived Biot–Savart fields

B(p) = (μ₀/4π) Σ q_i v_i × r_i / r_i³ from moving partial charges.

- **Magnitude.** A unit charge at a thermal speed of about 500 m/s (5 Å/ps), 3 Å
  away, gives about 0.09 mT. Every atom's velocity is thermal noise, so the sum
  fluctuates frame to frame and averages to about zero. Nothing in it
  corresponds to an observable a structural biologist uses.
- **Data.** DCD and XTC, the readers Phase 12 ships, carry no velocities, and
  TRR is not read yet. Finite differences between saved frames (usually 1–100 ps
  apart) alias thermal motion completely, so they don't approximate v.
- **Stateful dynamics (Phase 17).** An elastic-network integrator has
  velocities, but they belong to a coarse-grained model with no charges. The
  field would be an artefact of the model.
- **Verdict: reject.** Cheap to compute with `coulombWgsl`'s tiling, but not
  meaningful.

## Candidate 2: aromatic ring-current shielding

An external field B₀ (an NMR magnet) induces a current in each aromatic ring.
The ring's induced field shifts nearby nuclear resonances. In the standard
point-dipole approximation (Pople; Johnson–Bovey and Haigh–Mallion refine the
geometry), the isotropically averaged shift at p is

Δσ(p) ∝ I_ring · (1 − 3 cos²θ) / r³

where r is the distance from the ring centre, θ the angle to the ring normal,
and I_ring an empirical intensity per ring type. Case (1995) fits intensities
for Phe, Tyr, the two Trp rings and His, and there are nucleic-acid base values.
Protons stacked on a ring shift by up to about 1–2 ppm. This is a real, measured
effect, and SHIFTX-style predictors use it.

- **Output.** A **scalar** shielding field (ppm), not a vector B field. It fits
  CONCEPT 9 exactly: a computed Volume, coloured with `volumeSample()` or
  sampled at protons.
- **Machinery.** It is the same tiled direct sum as `sumGrid`: sources are ring
  centres with a normal and intensity (vec4 + vec4 per ring, a few hundred per
  protein), and the kernel is dipolar instead of Coulombic. The grid, budgets,
  snapshots, slices, isosurfaces and live recompute under trajectories would all
  be reused unchanged.
- **Work that is not there yet.**
  - Ring perception: a residue-template table for the standard aromatics and
    bases, ring centres and normals per frame (they move with coordinates, so
    they need a small `packRings` stage).
  - The intensity table and its licence: Case 1995's values are published
    numbers; the pinned source must be cited as the charge templates were.
  - An oracle: SHIFTX2 or a published table of ring-current shifts for a corpus
    protein.
- **Risk.** A ring-current map is only one term of a chemical-shift prediction.
  Presented alone it invites over-reading. A per-proton attribute
  (`computed:ring-current`) may serve NMR users better than a volume.
- **Verdict: defer.** Worth about one bead of plan and two of build if a user
  asks. Name it for what it computes (`<RingCurrent>` or a `ringCurrentShift`
  attribute), not `<MField>`.

## Consequences for the beads

- egp.8 closes with this finding. No `<MField>` component, export or doc mention
  ships.
- No follow-up bead is filed now. The ring-current option is recorded here so a
  future request can start from the analysis above.
