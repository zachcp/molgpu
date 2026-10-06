# molgpu site

The project landing page and maintained WebGPU examples. Application pages are
TSX; `index.html` is only Vite's document shell.

The gallery has five capability examples, each with a few controls:

- Compose: layer cartoon, tube, sticks, spacefill, glass surface and a sulfur
  highlight; click to measure; figure mode adds a ground plane, SSAO and
  key-light shadows.
- Select and color: queries coloured by element or partial charge; click an atom
  to fly to its residue.
- Surface and material: opaque, Fresnel glass or bump-mapped pumice, with
  roughness, use.gpu environment presets and tone mapping.
- Motion: XTC trajectory, GPU wobble, elastic-network dynamics, camera move.
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
button, so the displayed source is the source that runs. A structure picker
switches every example between 1CRN, 1TQN (P450 3A4 with heme), 1A4Y (inhibitor
complex) and 1C3W (bacteriorhodopsin, a membrane protein with resolved lipids);
each has a site selection preset. Partial charges and the XTC trajectory ship
for 1CRN only, so charge colour, the electrostatic potential and trajectory
playback are disabled for the other structures.

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
