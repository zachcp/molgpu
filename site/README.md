# molgpu site

The project landing page and maintained WebGPU examples. Application pages are
TSX; `index.html` is only Vite's document shell.

The gallery includes an opaque molecular surface by default, atom-element
surface coloring, material and selection controls, a moving camera timeline,
tube or ball-and-stick trajectory playback, and adjustable electrostatic grid
and field-line settings. The 3D solvent-excluded surface uses marching cubes.

```bash
deno task dev:site
deno task typecheck:site
deno task build:site
deno task test:site
```
