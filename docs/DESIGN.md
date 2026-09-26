# molgpu — design

> Architecture refinement (2026-09-17): read [the JSX/domain review](findings/2026-09-17-architecture-review.md) alongside this original plan. It updates domain identity, cache invalidation, package boundaries, renderer fallbacks and acceptance gates. These contracts are planned, not implemented.

A use.gpu-native molecular visualization library. GPU-first, declarative,
timeline-native.

## What this is, and what it is not

**Is:** a library, intended to be depended on and eventually published. API
design, package boundaries and tests matter from early on.

**Is not:** a MolViewSpec implementation. MVS is the *inspiration* — the scene
grammar, the vocabulary, the idea that a molecular scene is a declarative
value — but there is no `fromMVS()` and no `toMVS()`. We are not constrained
by what a portable JSON format can express, and we do not owe any other viewer
compatibility.

Dropping MVS interop buys design freedom and costs us two things that the plan
has to replace deliberately:

1. **No correctness oracle.** There is no reference renderer consuming the same
   input to diff against. Replaced by a golden-file harness run against Mol*
   directly (see Testing).
2. **No ready-made test corpus.** Replaced by a curated structure set chosen to
   cover the cases that actually break molecular renderers (see Testing).

## Why not just use Mol*

Mol* is excellent and we reuse its geometry kernels. But its appearance model
is a state tree of modifier nodes, its color model is a closed set of enumerated
themes because the format it serves cannot ship code, and its time model is a
list of static scenes with snapshot-local clocks. Those are all consequences of
serving a portable archival format.

With a real runtime underneath — shader linking, keyframe interpolation, PBR
materials — those constraints stop paying for themselves. The bet of this
project is that removing them collapses a dozen concepts into three: **tables,
fields, and a timeline.**

## Pillars

### 1. One columnar atom table

A structure resolves to a columnar table: positions plus per-atom attribute
buffers (element, chain, seq, comp, b-factor, occupancy, altloc, instance).
Published via **context, not props**, so representations pull what they need
without threading.

Everything else in the design is a function of this table.

### 2. Selections are values, not nodes

A selection compiles to a sorted index buffer. That makes union / intersect /
difference cheap, and lets one selection be reused in five places. MVS leaks
DAG-ness through `ref` and `structure_ref` precisely because it has to pretend
a selection is tree-shaped; we do not pretend.

### 3. Fields are the unifying abstraction

Any styling prop — `color`, `size`, `opacity`, `visibility`, label `text` —
accepts one of:

- a constant
- an expression over atom attributes
- a joined external annotation
- a keyframe curve

One concept replaces MVS's entire
`color` / `color_from_uri` / `color_from_source` × categorical / discrete /
continuous × domain / overflow / sort-order matrix. Fields compile to WGSL and
bind as `ShaderSource`, which upstream supports directly (see findings).

Annotations are **joins that produce fields**: `useAnnotation(uri, schema)`
joins external per-residue or per-chain data onto the table and returns
something indistinguishable from any other field.

### 4. One global timeline

Named beats, not snapshots. Any field can hold a curve, camera included.
Scrubbing is setting `t`. Chapters exist for narration and export, not as
containers that scope time.

**Upstream constraint:** `Animate` is self-driving and cannot be sampled at an
arbitrary `t`. The timeline is therefore ours, built on use.gpu's exported
`EaseTypes` / `automaticKeyframes` interpolation machinery. This is a real
piece of work, not a wrapper. See `@molgpu/timeline`.

### 5. Geometry memoizes on structure; style does not touch it

Representations memoize geometry on `(selection, geometry params)` only. Style
fields change uniforms and bound buffers. This is what makes animation cheap
and is the main reason to be on use.gpu rather than porting naively.

### 6. Framing derives from selections

`focus(selection)` computes bounds at evaluation time, so camera keyframes
survive data swaps and trajectory frames.

### 7. Materials, lights and postprocessing are first-class

We have committed to a shading model, so we are allowed to name it. PBR
materials, real lights, SSAO / outline / DoF / OIT all exist upstream.

### 8. Picking wires back into the timeline

Hover yields a tooltip field; click seeks to a beat. That subsumes MVS's
`snapshot_key` without a special-case parameter.

## Target API shape

Illustrative, not settled:

```jsx
<Molecule>
  <Structure id="cyp" src="1tqn.bcif">
    <Cartoon      select="polymer" color={byPlddt} />
    <BallAndStick select={site}    color={byElement} material={glossy} />
    <Surface      select="polymer" opacity={fade} />
  </Structure>
  <Focus on={site} at={4000} />
</Molecule>
```

Note what is *absent*: no modifier child nodes. `color`, `opacity` and `clip`
are props, not children. MVS makes them children as a state-construction
idiom; with real props and keys we keep diffing granularity and animation
targeting without components that render nothing and reach upward.

## Package layout

A monorepo. The boundaries are chosen so that (a) all Mol* coupling sits behind
exactly one wall, and (b) everything correctness-critical is a pure function.

| Package | Depends on | Purpose |
|---|---|---|
| `@molgpu/table` | — | Columnar atom table, schema, typed attribute buffers. No GPU, no Mol*. |
| `@molgpu/io` | `table`, `molstar` (optional peer) | Importers. Lowers a Mol* `Structure` into a table. **The only package that knows Mol* exists.** |
| `@molgpu/select` | `table` | Selection language → sorted index buffers. |
| `@molgpu/fields` | `table`, `@use-gpu/shader` | Field abstraction, expression sublanguage → WGSL. |
| `@molgpu/geo` | — | Geometry kernels: ported ribbon/spline math, molecular surface, sphere/cylinder instancing. Typed arrays in, typed arrays out. No GPU, no Live. |
| `@molgpu/timeline` | `@use-gpu/workbench` | Global scrubbable timeline, beats, curve sampling. |
| `@molgpu/viewer` | all of the above | The Live components. **The only package that imports `@use-gpu/workbench` components.** |

Two rules make the layout load-bearing rather than decorative:

- **Mol* behind one wall.** `@molgpu/io` is the sole Mol* consumer, so the
  dependency can later be made lazy, swapped for a native parser, or dropped
  without touching the rest.
- **use.gpu types do not leak.** Lower packages never expose use.gpu types in
  their public API. use.gpu is pre-1.0 (0.20.0) from a small maintainer; churn
  is a real risk on a library we intend to publish, and this containment is the
  mitigation.

## Source language and publishing

The packages are moving from hand-written `.mjs` plus `.d.ts` to TypeScript
source, published to [JSR](https://jsr.io) (epic `0lg`; findings in
`docs/findings/2026-09-26-jsr-spike.md`). During the move both forms coexist:

- **Toolchain minimums:** Node 26 (runs `.ts` directly through type stripping)
  and Deno 2.9. The repo is an npm workspace and a Deno workspace at once.
- **Manifests:** `package.json` is the single source for name, version, license,
  exports and dependency ranges. Each package's `deno.json` (its JSR manifest)
  is generated from it by `npm run sync:deno`, and hardening H1 checks they
  match. Internal `@molgpu/*` imports resolve through the workspace, and JSR
  rewrites them to `jsr:` ranges on publish.
- **Unconverted packages** stay JSR-publishable: each `.mjs` entry names its
  declarations with `// @ts-self-types="./index.d.ts"`.
- **TypeScript source** follows `tsconfig.base.json`: `isolatedDeclarations`
  (explicit types on every export, which is JSR's "no slow types" rule),
  `erasableSyntaxOnly` (so Node can strip types), `verbatimModuleSyntax`, and
  relative imports ending in `.ts`.
- **JSR has no peer dependencies.** use.gpu stays an exact `npm:` pin, Mol*
  must stay optional through a computed dynamic import, and internal ranges stay
  broad so a single copy of `@molgpu/table` is shared.

## Testing strategy

Because MVS interop is out, the oracle has to be manufactured.

- **`@molgpu/geo` — golden typed-array tests against Mol*.** The kernels are
  pure functions, so we can run Mol*'s equivalent headless in the test process
  and diff vertex/normal/index output within tolerance. This is the highest-value
  test surface in the project and should exist from Phase 1, not Phase 6.
- **`table` / `select` / `fields` — ordinary unit tests.** No GPU needed.
- **`viewer` — screenshot tests.** Needs real WebGPU; drive headless Chrome via
  Playwright rather than fighting Node WebGPU polyfills (see findings: upstream
  touches `GPUBufferUsage` at module scope).

**Curated structure corpus**, chosen for what breaks renderers rather than for
being pretty. Each entry pins a PDB id and the case it covers:

- a small single-chain peptide (fast baseline)
- a multi-chain complex (chain coloring, inter-chain bonds)
- a nucleic acid structure (non-protein cartoon path)
- a structure with chain breaks / missing residues (gap handling — a classic
  cartoon failure)
- a structure with altlocs and partial occupancy
- a membrane protein (large, lipids, het groups)
- a multi-model NMR ensemble (instance/model axis)
- a structure requiring assembly/symmetry expansion

## Risks

**R1 — Polymer traversal reimplementation (highest).** Cartoon correctness
lives in the half of Mol* we cannot port: trace iteration, secondary-structure
assignment, helix orientation. *Mitigation:* port `curve-segment` math verbatim;
write our own iterator over the table; gate it behind the golden-file harness
on the gap/altloc/nucleic corpus entries. Budget this as the long pole, and
schedule it late (Phase 4) so the thesis is proven without it.

**R2 — No oracle, no corpus.** Addressed by the Testing section above. The
failure mode is doing it late; the harness is a Phase 1 deliverable.

**R3 — use.gpu is pre-1.0 from a small maintainer.** *Mitigation:* pin exact
versions; contain imports to `@molgpu/viewer`; do not leak its types; be
prepared to vendor-patch.

**R4 — Headless rendering.** Server-side figure generation from Python
pipelines is not possible until Node WebGPU is dependable, and upstream
dereferences WebGPU globals at import time. *Mitigation:* defer, but do not
design it out — keep `@molgpu/geo` and `@molgpu/table` renderer-free so a
future headless backend is additive.

**R5 — The field expression language is a compiler.** Classic scope-creep
magnet. *Mitigation:* start with a small closed set of built-in fields; no
user-facing parser until Phase 2 has proven the shape.

**R6 — Selection language scope creep.** Same shape as R5; start with
structural predicates only, resist a query language until asked for.

**R7 — Rewriting what is not interesting.** Cartoon and molecular-surface
generation is years of accumulated work in Mol*. The rule: port kernels, never
reinvent them. Any PR that reimplements a Mol* geometry algorithm from scratch
needs an explicit reason.
