# Cartoon visual review — 2026-09-28

> Superseded: the gap list below was resolved by
> [2026-10-02-cartoon-parity.md](2026-10-02-cartoon-parity.md).

Work item: `molgpu-sept-bxl`; site follow-up: `molgpu-sept-fwf`. Reference: the
installed Mol* 5.11.0 viewer and its default `cartoon` representation, rendered
from the same BCIF as `@molgpu/viewer`.

## What the comparison actually compares

The Mol* viewer's polymer preset creates a `cartoon` representation. Its
`CartoonRepresentation` is a composition: `polymer-trace` is always on;
`nucleotide-ring` is added for nucleotides and `polymer-gap` for gaps. The
`polymer-trace` visual uses elliptical helix and coil profiles, a sheet mesh,
secondary-structure dependent curve tension, and per-residue direction matching.
`Ribbon` currently draws one trace mesh. It is an appropriate place to improve
the **protein trace**, but calling it the complete Mol* Cartoon would misstate
its behavior. Keep the existing public `Ribbon` component and add `Cartoon` only
when the other visuals can be composed without duplicating trace extraction or
changing the selection contract.

The local visual harness now loads the same BCIF, selects the first active model
in MolGPU, asserts that Mol* created a `cartoon` representation, and sets both
cameras to the same world-space view around that model's trace. Framing all
atoms of an NMR ensemble had made the 2K39 MolGPU panel much smaller. Colors and
renderer lighting still differ, so visual acceptance is about shape and
continuity, not pixel equality.

| Structure |                    MolGPU selected trace | Role                    | Review                                                                                                                                                       |
| --------- | ---------------------------------------: | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1CRN      |  46 residues: 21 helix, 8 sheet, 17 coil | Site protein fixture    | Helix, sheet, and coil are recognizable. Sheet direction is now continuous. Mol* has crisper sheet edges and different terminal shaping.                     |
| 2K39      | 76 residues: 13 helix, 24 sheet, 39 coil | Sheet-heavy NMR model 1 | Matched direction vectors and smoothed sheet guides removed the fragmented, alternating faces. Mol* still has flatter strands and different arrow shoulders. |
| 1BNA      |                            Nucleic trace | Scope check             | A narrow trace renders, but Mol*'s default Cartoon also draws nucleotide rings. No full-cartoon parity claim is possible here.                               |

Saved side-by-side evidence: [1CRN](evidence/2026-09-28-cartoon/1crn.png),
[2K39](evidence/2026-09-28-cartoon/2k39.png). Regenerate with
`deno run -A packages/viewer/test/run-cartoon-compare.mjs`; its output in `/tmp`
is review evidence rather than a cross-platform pixel oracle.

## Changes in this pass

- Match Mol*'s default 0.2 size factor and 5:1 broad-to-thin ratio on the
  correct normal/binormal axes. A sheet arrow tapers in its broad axis and
  retains thickness at its tip.
- Match consecutive direction vectors, average their neighbors, and smooth sheet
  guide points within each trace run. This removes visible flips and repeated
  kinks in 2K39 without crossing a chain/model/selection gap.
- Use a flatter cross-section for sheet runs, elliptical helix and coil
  sections, and caps at drawn run ends. The continuous profile is an
  approximation of Mol*'s separate sheet and tube builders.
- Describe `Ribbon` as the polymer-trace visual in the public README and
  component docstring.

## Focused gaps and expanded work

1. **Parity of the protein trace.** Compare residue-level secondary-structure
   blocks and guide positions with Mol* on 1CRN and 2K39. Current source code
   uses a segment from residue `k` to `k+1` with shift zero; Mol* uses a
   half-shifted per-residue iterator plus explicit terminal clipping and
   overhangs. Port that iterator behavior to the plain trace table if the
   remaining end shape and shoulder differences survive aligned views. Preserve
   the table/geometry split and add a pure geometry oracle for a small fixed
   trace rather than depending on Mol* in `@molgpu/viewer`.
2. **Profiles and material.** Mol*'s sheets have hard planar faces and caps; our
   continuous superellipse rounds their corners. Compare broad-axis extent,
   arrow length, end caps, normal orientation, and visible edge contrast. If the
   difference remains visible at normal figure size, port Mol*'s sheet/tube
   builders into `@molgpu/geo` and keep one geometry owner.
3. **Complete Cartoon composition.** Add polymer gap and nucleotide ring visuals
   on the existing trace/topology, then expose `<Cartoon>` as the composition.
   Leave `<Ribbon>` as the trace-only API for figures that want it. Do not alias
   `Cartoon` to `Ribbon` while 1BNA visibly differs.
4. **Site integration.** Once the protein trace passes, `molgpu-sept-fwf` should
   frame and light 1CRN, use accurate Ribbon/Cartoon copy, and check the
   rendered result as well as trace counts. The Backbone tube demo is a
   continuity reference.

## Comparable gates

| Gate             | Evidence required                                                                                                  | Pass condition                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Input identity   | Same BCIF, selected model, primary altloc policy and per-residue helix/sheet/coil blocks reported for both viewers | No silent model or secondary-structure mismatch; record any deliberate annotation/DSSP difference.                                                                                                                                           |
| Pure geometry    | 1CRN, 2K39, gap, altloc and nucleic corpus; explicit alternating-direction and arrow fixtures                      | Finite vertices, outward winding, sealed run ends, no triangles across runs, continuous sheet faces, arrow broad-axis taper with nonzero thickness.                                                                                          |
| Visual shape     | Matched camera and selected-model framing; saved 1CRN and 2K39 panels, plus a rotated view of each                 | No empty mesh, flipped faces, fragmented sheet, abrupt helix/coil step, or visibly open end. Sheet arrows and helix coils recognizable at figure scale. Review remaining differences against Mol* rather than relying on raw pixel equality. |
| Runtime          | Browser WebGPU diagnostics and existing geometry invalidation probe                                                | No GPU errors; color/opacity changes do not rebuild geometry; coordinate or cartoon-code changes rebuild from the correct generation.                                                                                                        |
| Full Cartoon API | 1BNA plus a structure with a polymer gap, compared with Mol* default Cartoon                                       | Nucleotide rings and gap visuals appear at the right residues; `Ribbon` remains trace only. Introduce `<Cartoon>` only at this gate.                                                                                                         |

Architecture constraints from `docs/DESIGN.md` and `docs/ROADMAP.md`: geometry
consumes typed arrays and stays renderer-independent; Mol* remains an oracle in
the test harness and an importer behind `@molgpu/io`, never a viewer runtime
dependency. Styling stays in GPU-bound fields. Current Ribbon geometry follows
the repo's shared, throttled CPU coordinate snapshots; any GPU-native extrusion
must preserve these shape and generation gates before replacing that path.
Selections, model identity, and run segmentation remain explicit. This work
lives on `codex/cartoon-molstar-parity`, branched from current `origin/main` in
an isolated worktree. The original checkout retains its unrelated edits.
