# Residue distribution planning sketch

Application-only proof for `molgpu-sept-r50`; see the
[decision](../../../docs/findings/2026-10-11-residue-distributions-decision.md).
Original synthetic backbone and authored probability values are MIT licensed
with the repository. They are not experimental coordinates, calibrated mutation
likelihoods or model predictions. No inference or new package API is included.

From the repository root, run:

```sh
deno run -A test/spikes/residue-distributions/serve.mjs
```

Open `/test/spikes/residue-distributions/index.html`. Activate a heatmap cell to
inspect the exact probability and highlight its residue. Chain and overlapping
seven-residue window filters affect the panel; missing imported rows remain
visible. X is an explicit category. Enter activates focused buttons. The scene
can be unmounted. This first sketch demonstrates panel-to-backbone selection;
bidirectional molecular picking is tracked separately.

Checks:

```sh
deno test -A test/spikes/residue-distributions/fixture.test.ts
deno check test/spikes/residue-distributions/page.tsx
deno test -A test/spikes/residue-distributions/run.mjs
```

The browser runner uses the shared Chrome/WebGPU harness and writes a screenshot
only to `/private/tmp/molgpu-r50-sketch.png`. Public molecular package entries
compose the scene. Test-only private instrumentation verifies zero coordinate
uploads and geometry rebuilds during inspection and filtering.
