# Cartoon parity — 2026-10-02

Work item: `molgpu-sept-bxl`; site follow-up: `molgpu-sept-fwf`. Supersedes the
open gap list in
[2026-09-28-cartoon-visual-review.md](2026-09-28-cartoon-visual-review.md).
Reference: the installed Mol* 5.12.0 viewer and its default `cartoon`
representation, rendered from the same BCIF.

## Decision: replace the trace extrusion with a port of Mol*'s builders

The 2026-09-28 extrusion swept one continuous superellipse profile along each
run. Its remaining gaps (soft sheet edges, weak arrow shoulders, different
termini) came from that design, not from tuning: Mol* draws each residue as its
own half-shifted curve segment and picks a builder per residue. The trace is now
a direct port of Mol*'s MIT-licensed polymer-trace visual:

- `PolymerTraceIterator` neighbourhood per residue within a run: clamped
  neighbours, 1.5 Å terminal extension, sheet-smoothed control points,
  neighbour-matched carbonyl directions and `secStrucFirst/Last`.
- Per-residue segment with shift 0.5 (0.3 for nucleic), helix tension 0.9, run
  ends clipped to half a segment with Mol*'s 2 × size overhang; a one-residue
  run is a sphere.
- `addSheet` (flat box; a 1.5× arrowhead on the last sheet residue with tilted
  face normals and back faces), `addTube` (elliptical helix, round coil) and the
  square nucleic strand, at Mol*'s sizes: 0.2 Å, aspect ratio 5.

Alternatives considered: keep tuning the superellipse (rejected — it cannot
produce a hard arrow shoulder without a discontinuous profile, which is what the
per-residue builders already are), or call Mol* at runtime (rejected — Mol*
stays an IO adapter and test oracle). Not ported: tubular helices
(helix-orientation axis fit), rounded profiles, cyclic polymers, coarse-model
scaling, and triangle-normal directions for residues lacking direction atoms.

The builders live in `packages/viewer/src/internal/ribbon-geometry.ts` and
`cartoon-geometry.ts`, the single geometry owner for both components. They are
pure typed-array code with no use.gpu imports; moving them to `@molgpu/geo`
would add public API without a second consumer, so they stay internal.

## Complete composition: `<Cartoon>`

`<Cartoon>` is `<Ribbon>`'s trace plus Mol*'s other two cartoon visuals in the
same mesh, so colour Fields, opacity, materials, assembly copies and
snapshot/generation handling are shared rather than duplicated:

- **Nucleotide rings** (`nucleotide-ring-mesh.js`): stick and ball from the
  trace atom to N9/N1, base ring(s) as a ±0.2 Å slab using Mol*'s strip/fan
  order, comp-id purine/pyrimidine with the C4–N9 geometry fallback.
- **Polymer gaps** (`polymer-gap-cylinder.js`): five dashes from each stem
  halfway to the other. A gap is consecutive runs of one chain with residues
  missing from the model; a break caused only by `select` is not a gap.

`<Ribbon>` remains trace-only.

## Evidence

Matched cameras, the same selected model, front and a quarter-turn side view:
`CARTOON_COMPARE_OUT=<dir> deno run -A packages/viewer/test/run-cartoon-compare.mjs [ids]`.
Saved panels: [evidence/2026-10-02-cartoon](evidence/2026-10-02-cartoon/)
(`1crn`, `2k39`, `1bna`, `1tqn` × `front`, `side`).

| Structure | Role                  | Review                                                                                        |
| --------- | --------------------- | --------------------------------------------------------------------------------------------- |
| 1CRN      | Site protein          | Helices, both arrowheads, coil and termini match Mol* in shape and placement from both views. |
| 2K39      | Sheet-heavy NMR       | Strands are flat boxes with arrowheads at the same residues as Mol*; no fragmented faces.     |
| 1BNA      | Nucleic               | Flat strands, base slabs and sticks at every nucleotide, matching Mol*.                       |
| 1TQN      | Polymer gap (261-264) | The dashed gap appears between the same stems as Mol*'s.                                      |

Remaining visible differences are renderer-level: our harness uses a world-fixed
directional light (Mol* uses a camera headlight), so some faces render darker or
brighter, and Mol*'s camera frames the same view at a slightly smaller scale.
Neither is a geometry difference.

## Gates

| Gate             | Result                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure geometry    | `ribbon-geometry.test.ts`: vertex/triangle-count oracle, overhang and caps, sphere for a 1-residue run, outward winding for tube/sheet/arrow, extents, arrowhead 3.0 → 0 Å with 0.4 Å thickness, alternating carbonyls, nucleic strand.     |
| Corpus           | `ribbon-corpus.test.ts` (1tqn, 1ejg, 1bna, 1crn, 2k39: finite, in bounds, no cross-run triangles, outward winding); `cartoon-geometry.test.ts` (1bna rings, 1tqn gap, no selection gaps).                                                   |
| Runtime          | `test:viewer:ribbon`, `test:viewer:invalidation` (new `cartoon` rows: colour/opacity style-only, selection, coordinates, smooth and ssCode rebuild only the trace; mount/unmount lifetime), `run-selection`, `run-tube`, `test:components`. |
| Visual shape     | Front and side panels above.                                                                                                                                                                                                                |
| Full Cartoon API | `<Cartoon>` exported (experimental), README/CHANGELOG/api.txt updated.                                                                                                                                                                      |

Not covered: a Mol*-side per-residue secondary-structure diff (both viewers read
the file's annotation; the panels agree on helix/sheet placement) and GPU-native
extrusion, which remains outside this work.

## Site integration (`molgpu-sept-fwf`)

The secondary-structure demo drew `<Ribbon>` with the unlit `basic` material,
which flattened 1CRN into a single-colour silhouette. It now draws a shaded
`<Cartoon color={bySecondaryStructure()} />` (Mol*'s palette: magenta helix,
yellow strand, white coil), framed at 1.2× the structure extent instead of 1.7×,
under the title "Secondary-structure cartoon" with copy that names the visual
accurately. The route id stays `ribbon` so existing links keep working. The
Backbone tube demo is unchanged
([site-tube.png](evidence/2026-10-02-cartoon/site-tube.png)).

Rendered result:
[site-cartoon.png](evidence/2026-10-02-cartoon/site-cartoon.png).
`deno task test:site` keeps the trace-count assertion and adds a pixel check on
the rendered canvas: lit pixels cover over 1% of the frame, helix, strand and
coil colours each exceed 5% of lit pixels, and over 15% of helix pixels are
darker than 80% of the brightest (shaded 0.31; the previous unlit material
measured 0.05 and fails the check).
