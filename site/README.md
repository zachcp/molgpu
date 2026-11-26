# molgpu site

The project landing page and maintained WebGPU examples. Application pages are
TSX; `index.html` is only Vite's document shell.

The gallery has five capability examples, each with a few controls:

- Compose: starts with the backbone tube; layer cartoon, sticks, spacefill, a
  glass surface and a sulfur highlight; click to measure; figure mode adds a
  ground plane, SSAO and key-light shadows.
- Select and color: starts with sulfur atoms coloured by element; other queries
  and partial-charge colour; click an atom to fly to its residue.
- Surface and material: a solvent-accessible (default) or solvent-excluded
  surface, opaque, Fresnel glass or bump-mapped pumice, with a two-handle clip
  slab (front and back cuts), roughness, use.gpu environment presets and tone
  mapping.
- Motion: XTC trajectory (with an optional Ramachandran inset), GPU wobble,
  elastic-network dynamics, camera move.
- Volumes: density map, electrostatic potential.

Hashes from the former 16-demo gallery redirect to the matching settings.

Click-to-focus samples a two-frame `CameraCurve` (current pose, then a `focus`
query on the picked residue) through the public `useCameraCurve` on a local
seconds clock, so interactive moves and timeline stories share one easing path.
use.gpu's `EaseToTarget` is not used: its wall-clock exponential ease depends on
history, so it cannot be scrubbed. Only the cartoon casts shadows in figure mode
(see `docs/findings/2026-10-06-shadow-probe.md`).

Each example is one file in `src/demos/examples/`; the page shows that file's
text (Vite `import.meta.glob` with `?raw`) beside the canvas, with a copy
button, so the displayed source is the source that runs. The numbered gallery
navigation switches examples without leaving the page. Scene settings sit next
to the viewer on wider screens, and beneath it on narrow screens; PNG export
lives in the viewer toolbar. The source panel is keyboard-accessible.

`demos/options.ts` owns typed settings and their defaults; `demos/controls.tsx`
renders ordinary React form controls. The page applies legacy presets as one
settings update and derives structure-dependent rendering values separately.
Keep the molecular examples as public-API Live JSX, not form or routing code.

A structure picker switches every example between 1CRN, 1TQN (P450 3A4 with
heme), 1A4Y (inhibitor complex) and 1C3W (bacteriorhodopsin, a membrane protein
with resolved lipids); each has a site selection preset. Partial charges and the
XTC trajectory ship for 1CRN only, so charge colour, the electrostatic potential
and trajectory playback are disabled for the other structures.

`public/data/` holds local example files (see `manifest.json`), served at
`<base>data/<file>` for examples and bundler-free pages. Structure and charge
files are copies of `packages/io/test/fixtures`; the site test checks they
match.

```bash
deno task dev:site
deno task typecheck:site
deno task build:site
deno task test:site
```

## Hidden experiments

`#experiments` lists standalone sketches that are built into the site but absent
from its public navigation. `#experiments/reveal` compares full atoms with an
outlined cartoon under one orbit camera. Drag its vertical divider, or focus it
and use Left/Right and Home/End. Both scenes stay mounted; only the fullscreen
shader's split changes. This deliberately renders two views, not a cheaper
single-pass representation.

The reveal's `assets/6cun.bcif` is from <https://models.rcsb.org/6cun.bcif>
(RCSB PDB, downloaded 2026-11-25). It contains engineered cytochrome c with HEC
heme and the CA1 carbene intermediate, described in
[PDB-101's Artificial Metalloenzymes](https://pdb101.rcsb.org/motm/323). Gold
marks CA1; the experiment compares representations, not a reaction trajectory.

`#experiments/pluck` treats a protein's Cα trace as an illustrative string. Its
protein picker reuses the gallery's local crambin, P450, inhibitor-complex and
bacteriorhodopsin structures. Switching proteins resets the wave, residue list
and camera; a superseded load cannot replace a newer selection. Each continuous
chain run has its own pinned endpoints. Choose a residue and press Pluck
(keyboard accessible), or right-click the line to pluck the picked residue.
Orbit and zoom remain available. A thin grey trace shows the unmodified
backbone; Reset restores it immediately. On narrow screens the controls sit
above the canvas rather than obscuring the protein.

The CPU prepares atom-row and segment mappings once per protein. A native
use.gpu compute pass samples the nearest molecular coordinate source and caches
the damped fixed-end displacement once per Cα. The line shader evaluates a
Catmull–Rom spline through those GPU positions. Plucking changes uniforms, not
the structure's coordinates or a CPU-generated mesh, and its animation clock
stops after the wave decays. Sequence distance and transverse displacement are
artistic choices: this is not a normal-mode calculation, force field or
molecular dynamics model.
