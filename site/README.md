# molgpu site

The project landing page and maintained WebGPU examples. Application pages are
TSX; `index.html` is only Vite's document shell.

The gallery has five capability examples, each with a few controls: Compose
(layer cartoon, tube, sticks, spacefill, glass surface, sulfur highlight),
Select + color (queries coloured by element or partial charge), Surface +
material, Motion (XTC trajectory, GPU wobble, elastic-network dynamics, camera
move) and Volumes (density map, electrostatic potential). Hashes from the former
16-demo gallery redirect to the matching settings.

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
