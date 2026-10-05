# molgpu site

The project landing page and maintained WebGPU examples. Application pages are
TSX; `index.html` is only Vite's document shell.

The gallery has five capability examples, each with a few controls: Compose
(layer cartoon, tube, sticks, spacefill, glass surface, sulfur highlight),
Select + color (queries coloured by element or partial charge), Surface +
material, Motion (XTC trajectory, GPU wobble, elastic-network dynamics, camera
move) and Volumes (density map, electrostatic potential). Hashes from the former
16-demo gallery redirect to the matching settings.

Each example is one file in `src/demos/examples/`; the page shows that file's
text (Vite `import.meta.glob` with `?raw`) beside the canvas, with a copy
button, so the displayed source is the source that runs. A structure picker
switches every example between 1CRN, 1TQN (P450 3A4 with heme) and 1A4Y
(inhibitor complex); each has a site selection preset. Partial charges and the
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
