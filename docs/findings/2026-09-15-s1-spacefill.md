# S1 finding — the spacefill path

Bead: `molgpu-sept-cqm.1`. Spike code: `spikes/s1-spacefill/`.
`@use-gpu/* 0.20.0`, vite 8.3.0, macOS arm64, Chrome/WebGPU.

## Verdict: use `PointLayer` impostors. Decision is settled; frame timings are not.

`PointLayer` with `shaded: true` and `depth: 1` is the spacefill path. The
merged-real-geometry alternative is disqualified on memory and CPU build cost
before frame rate even enters the argument.

**Caveat, stated up front:** the frame-timing half of this spike's acceptance
criteria is **not done** — it is blocked, see "What is still missing". The path
decision does not depend on it.

## 1. `PointLayer` `shaded` gives true sphere impostors

Not flat sprites. Four deliberately overlapping spheres render with **curved
sphere-sphere intersection seams**, which is only possible if the fragment
shader writes per-fragment depth. Flat billboards would show one circular edge
hard-occluding the next. Shading includes a specular highlight that tracks the
light.

This was the spike's central unknown and it comes back positive.

## 2. `depth` selects screen- vs world-space sizing

- `depth: 0` — size in **pixels**. Constant on screen, does not scale with zoom.
  Wrong for spacefill: atoms must be vdW radius in Ångström.
- `depth: 1` — **world-space, perspective-correct**. Verified by doubling the
  camera radius (37 → 74) and observing apparent size halve.

`depth: 1` is what we want.

**Open detail:** the `sizes` value at `depth: 1` is not raw Ångström. Empirically
a world radius of 5 Å needed `sizes ≈ 1480`, i.e. a factor of ~296 that must
depend on fov and viewport. `@molgpu/viewer` needs to **derive** that factor
rather than hardcode it — and it should be pinned by a test, because a silent
change there mis-sizes every atom.

## 3. Cost: impostors beat merged geometry by ~200x on memory

Measured (`window.__prep`), synthetic globular clouds at protein-like density:

| path | atoms | CPU build | GPU bytes | bytes/atom |
|---|---|---|---|---|
| PointLayer impostor | 100k | 0.9 ms | 1.6 MB | 16 |
| PointLayer impostor | 1M | 4.1 ms | 16 MB | 16 |
| merged mesh (FaceLayer) | 20k | **593 ms** | **78 MB** | ~3 900 |

Impostors pay **no geometry build at all** — just position and size buffers.

Corrected per-sphere cost for the merged path (see the stride note below):
77 verts x (vec4 position + vec4 normal = 32 B) + 360 u16 indices
= **~3.2 KB per atom**. Extrapolated: **~320 MB at 100k atoms, ~3.2 GB at 1M**,
with a CPU build of ~3 s and ~30 s respectively. Non-viable at both scales.

A further structural nail: `makeSphereGeometry` ships **`u16` indices**, which
overflow past 65 535 verts — about **851 spheres**. Any merged-mesh approach
must re-index to u32 itself.

This matches why Mol* uses impostors for large structures. Per INVARIANT 3
(port, don't reinvent), following that precedent is the right call.

## 4. `makeSphereGeometry` API shape (worth recording for ball-and-stick)

```
makeSphereGeometry({ detail: [6, 10] }) ->
  count: 360                      // INDEX count, not vertex count
  topology: 'triangle-list'
  formats: { positions: 'vec4<f32>', normals: 'vec4<f32>',
             uvs: 'vec4<f32>', indices: 'u16' }
  attrLens: { positions: 308, normals: 308, uvs: 308, indices: 360 }
```

So **stride 4, not 3** — 308 floats / 4 = 77 vertices. It is exported from
`@use-gpu/workbench`.

**My merged-mesh baseline used stride 3 and was therefore malformed**, so its
*visual* correctness was never established. The cost numbers above stand
regardless (they are driven by vertex count and byte width, and the corrected
figures are computed from the real vec4 stride), and they are what disqualify
the path — but do not cite the mesh mode's rendering as validated, because it
was not.

## 5. Instanced `RawFaces` is not a drop-in third option

`RawFaces` merges `mesh.attributes` **over** props
(`attr = mesh ? {...props, ...mesh.attributes}`), so per-instance positions
cannot be supplied via `positions` while a `mesh` is set. `instance` is a repeat
count and `instances` is a random-access source for a *custom* vertex shader;
the built-in face vertex shader applies no per-instance transform. So instanced
spheres would need our own vertex shader. Not worth it given result 3.

## What is still missing

**Frame timings at 10k / 100k / 1M were not obtained.** `requestAnimationFrame`
never fires in this environment because the desktop app's Browser pane is
hidden, and a hidden pane is not composited. Confirmed: 0 frames sampled over
25 s and 30 s runs; `document.visibilityState` probes time out. Fronting the tab
does not help — it is the *pane*, not the tab, and `show_pane` has no "browser"
option, so it cannot be revealed programmatically.

The harness is written and ready (`bench.mjs` samples 180 frames after a
60-frame warmup and publishes median / p95 / min / max / fps to
`window.__bench.stats`). It needs only a visible Browser pane:

```bash
cd spikes/s1-spacefill && npx vite .
# then, with the Browser pane open:
#   /?mode=point&n=10000&depth=1&size=74
#   /?mode=point&n=100000&depth=1&size=74
#   /?mode=point&n=1000000&depth=1&size=74
```

Two caveats for whoever runs it: timings from an embedded pane at unknown
size are indicative, not authoritative — prefer a real browser window at a
fixed viewport. And the 1M case should be checked for whether it is
GPU-bound or fill-bound by varying `size`.

## Consequences for the plan

- Spacefill uses `PointLayer` + `shaded` + `depth: 1`. Record it as decided.
- `@molgpu/viewer` owes a derived (not hardcoded) Å-to-`sizes` conversion,
  covered by a test.
- Do **not** plan on merged real sphere geometry at any realistic atom count.
- The `RawData` -> `ShaderSource` -> layer path is now confirmed for two layers
  (`PointLayer` here, plus the S3 control), reinforcing CONCEPT 3 and INVARIANT 4.
- Benchmarking needs a visible browser. Worth solving properly before Gate 2,
  which requires *asserting* on memoization rather than eyeballing frames.
