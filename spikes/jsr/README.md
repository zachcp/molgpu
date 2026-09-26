# JSR feasibility spike

Evidence for [docs/findings/2026-09-26-jsr-spike.md](../../docs/findings/2026-09-26-jsr-spike.md).
A Deno workspace:

- `table/`: full TypeScript port of `@molgpu/table`, with its tests copied
  from `packages/table/test`, imports pointed at `../src/index.ts`.
- `viewer/`: TypeScript port of the viewer's point-rendering path (`.` and
  `./advanced` entries). Instrumentation is stubbed.
- `render/`: a page using only the two packages above, bundled by
  `deno bundle` and checked in Chrome WebGPU.
- `probes/`: Mol* (the real `@molgpu/io`) and use.gpu under Deno.
- `io-probe/`: a computed dynamic import for Mol* (publishes and runs in Deno, but breaks bundlers; see the findings correction).

```bash
cd spikes/jsr
deno publish --dry-run --allow-dirty          # type check + slow types, all members
(cd table && deno test -A test/)
(cd render && deno bundle --platform browser -o page.js page.ts) && deno run -A render/run.mjs
(cd probes && deno run -A io.ts && deno run -A usegpu.ts)   # usegpu.ts shows the CJS named-export failure
```
