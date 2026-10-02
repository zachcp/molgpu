# Second pass: table, select, fields and geo

Date: 2026-10-02. Baseline: `e2b4df7`. Review task: `molgpu-sept-ktr.1`, beneath
`molgpu-sept-ktr`.

## Conclusion

Keep the four packages and their single public entries. Their dependency
boundaries are already small and correct: table and geo import only local
modules; select and fields import table through its public entry. No production
use.gpu, Mol* or sibling deep import was found in these packages. Reducing these
remaining cross-package edges would duplicate contracts or reverse ownership.

The strongest new opportunities are correctness repairs in existing pure
kernels, followed by documentation reconciliation and modest private-module
organization. There is no evidence here for replacing scientific ports with
use.gpu helpers or merging packages. The earlier architecture failures are not
being refiled: the ownership, chemistry and public-entry decisions have landed.

| Package | Assessment                                                                                                                                                                                                                                                                  | Useful next action                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| table   | Responsibility modules now separate structure, views, attributes, bonds, trace, DSSP, volume and trajectory. Constructors and read wrappers implement the documented ownership decision. Shared spatial grid and attribute registry already eliminate equivalent mechanics. | Remove a redundant private type barrel only if desired; retain scientific APIs and the copy/adopt distinction.                                     |
| select  | Public query/resolution and private MolQL evaluation are distinct concepts. Typed chemical graphs preserve semantics separate from display bonds. Large files reflect supported language breadth as well as accumulated responsibilities.                                   | Correct outdated README contracts; optionally separate the public barrel from implementation without expanding exports.                            |
| fields  | Pure field values, CPU evaluation, WGSL emission and plain bindings are the right adapter boundary. Standard attribute metadata comes from table.                                                                                                                           | Repair wrap endpoint parity and validate/serialize numeric literals; then separate node construction, CPU evaluation and WGSL emission internally. |
| geo     | Minimal attributed geometry ports and owned outputs; CSR nearest attribution has a different search contract from table's sparse neighbor grid.                                                                                                                             | Make spacing/origin lowering equivalent to the existing affine path, including normals and reflected winding.                                      |

## Findings requiring follow-up

### P2: F-PURE-1 — linear wrap disagrees at the upper endpoint

Evidence: `packages/fields/src/primitives.ts:527-539` wraps CPU values only when
normalized input is outside `[0,1]`; `:885-887` emits `fract(u)` unconditionally
for the WGSL wrap mode. An exact upper endpoint therefore returns the high end
on CPU and low end in WGSL.

Reproduced CPU result and emitted shader:

```ts
import { compile, constant, evaluate, linear } from "@molgpu/fields";
// data is any validated StructureData with atom rows.
const f = linear(constant(1), {
  domain: [0, 1],
  range: [10, 20],
  overflow: "wrap",
});
evaluate(f, data, { domain: "atom" }); // 20 for every atom
compile(f).wgsl; // return (fract(((1.0) - 0.0) / 1.0)) * 10.0 + 10.0;
// The emitted expression gives 10 at the same input.
```

This is a reproduced CPU/emitted-expression disagreement; the new endpoint case
was not dispatched in a browser during this review. The unit test named “linear
normalizes over a domain with clamp and wrap overflow”
(`packages/fields/test/fields.test.ts:135`) actually tests clamp/fail only. The
browser parity harness already exists in `packages/fields/test/run-browser.mjs`;
extend it rather than inventing another GPU test runner.

Acceptance: decide the wrap endpoint convention; assert CPU and dispatched WGSL
at both endpoints, slightly inside/outside and negative values, with reversed
finite domains if supported. Keep curve wrap semantics deliberate. Run fields
units and `deno task test:fields:gpu`, including compilation diagnostics.

Overlap: closed `molgpu-sept-x24.6` established fields hardening and parity;
`molgpu-sept-s5o.11` audits coverage. Neither is an open repair for this
endpoint. Tracked by `molgpu-sept-ktr.15`.

### P2: F-PURE-2 — field numeric literal acceptance exceeds WGSL support

Evidence: scalar `constant` at `packages/fields/src/primitives.ts:197-201`
accepts NaN/Infinity; `linear` at `:305-311` checks array shape and unequal
endpoints without checking finite values. The `f32` serializer at `:677` appends
`.0` to anything that `Number.isInteger` accepts, including exponent-form
JavaScript strings.

Reproduced compile output:

| Input                                     | Emitted return expression         |
| ----------------------------------------- | --------------------------------- |
| `constant(NaN)`                           | `NaN`                             |
| `constant(Infinity)`                      | `Infinity`                        |
| `constant(1e21)`                          | `1e+21.0`                         |
| `linear(constant(1), {domain: [NaN, 1]})` | Arithmetic with `NaN` identifiers |

The first two identifiers are not declared by the generated module; the third
places a decimal point inside the exponent. These are reproduced source outputs,
not a browser diagnostic captured in this review. Color construction already
checks finite components, and `normalizeValue` already rejects nonfinite scalar
categorical values (`:478-485`), so the current validation is inconsistent.

Acceptance: choose and document finite f32 representability policy; reject
nonfinite constructor parameters, nonfinite categorical keys and overflowing
literal values; emit valid scientific notation for finite representable values.
Test small exponent values, large finite values such as `1e21`, negative values,
zero and f32 bounds. Confirm generated WGSL compiles through the existing fields
browser harness. Do not add use.gpu to fields for literal formatting.

Overlap: closed `x24.6` and the generic `s5o.11` coverage audit; no matching
open numeric-literal bug was found in the full Beads inventory. New repair:
`molgpu-sept-ktr.16`.

### P2: F-PURE-3 — spacing path does not transform normals

Evidence: `packages/geo/src/index.ts:130-135` applies `spacing` to positions but
pushes the untransformed index-space normal. The affine path already applies
inverse-transpose normal transformation and reverses winding under reflection
(`:216-233`). Anisotropic spacing is therefore observably different from its
equivalent diagonal affine. Negative spacing also bypasses the affine path's
winding correction.

Reproduced with a plane `values = Float32Array.of(0,1,1,2,0,1,1,2)`,
`dims: [2,2,2]`, `level: .5`:

- `spacing: [2,1,1]`: first normal `[-0.70710677,-0.70710677,0]`.
- `transform: [2,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]`: first normal
  `[-0.44721359,-0.89442718,0]`.

Positions describe the same world-space surface, but only the affine result has
its expected perpendicular normal. Viewer surface callers normally pass
`transform`; this public pure API bug is not evidence that the current viewer's
surface shading is broken.

Acceptance: lower origin/spacing to the existing affine path or implement the
same normal/winding rules exactly once. Assert equivalent positions, normals and
winding for isotropic, anisotropic and negative spacing; preserve current
shear/mirror tests and Mol* curve oracles. Validate transform before expensive
mesh construction. Run geo units and scoped checks; include public API hardening
only if the contract changes.

Overlap: closed `molgpu-sept-e62` removed dead geo code, and closed
`molgpu-sept-cr2` repaired sample indexing. Neither addresses spacing normals.
New repair: `molgpu-sept-ktr.17`.

### P3: F-PURE-4 — package READMEs describe removed or superseded adapters

Source-confirmed documentation mismatches:

- `packages/select/README.md:228-231` says representations still accept only
  resolved selections and describes query props as future `crj.20` work. That
  issue is closed and the current scoped adapter supports query props.
- `packages/select/README.md:294-297` says expression connectivity uses
  `bondTopology`; `src/bond-graph.ts:1-2,262-311` owns separate chemical graph
  semantics and snapshot inheritance. The same README later describes those
  chemical semantics accurately, creating an internal contradiction.
- `packages/fields/README.md:210,258` advertises viewer `useAnnotation`, removed
  from the supported public API during `s5o.17.2`. Annotation joining remains a
  useful pure operation; remove the obsolete fetching-wrapper claim.
- `packages/table/README.md:176-178` describes `types.ts` as internal import
  compatibility, but the only current source importer is `src/index.ts:29`. Keep
  this explanation current if the optional barrel cleanup lands.

Acceptance: explain current scoped query props in the viewer docs, link the
pure-package docs to that contract, describe chemical/display connectivity
separately once and demonstrate annotation loading as application-owned IO plus
`joinAnnotation`. Check examples against real public entries and avoid new
published tracker identifiers.

Overlap: current review `molgpu-sept-ktr.4` owns consolidation; reuse it rather
than filing duplicate documentation tasks. Prior decisions `crj.20`, `crj.6`,
`s5o.17.2` supply the corrected contracts.

## Simplification opportunities and retained decisions

### Private layout: small changes, no additional public entries

`table/src/types.ts` is a 31-line compatibility barrel used only by the public
entry; the implementation already imports responsibility-specific type modules.
The curated root entry can export directly from those modules and remove the
extra file without changing `api.txt`. This is a source-confirmed organizational
opportunity, not a measured performance improvement. Preserve the names
currently published by `table/src/index.ts:3-29`.

`select/src/index.ts` contains approximately 1,100 lines of public types,
constructors, scope policy, resolution, identity and set/domain operations.
`fields/src/primitives.ts` contains approximately 1,040 lines spanning node
construction, evaluation and WGSL emission. Internal splits at those actual
responsibilities would make the public barrels easier to audit. Keep private
node types in one internal module and avoid one file per function.
`geo/src/index.ts` can similarly become a barrel over a marching-cubes module if
that materially helps the spacing repair. None requires another JSR subpath or a
package.

These are P3 choices tracked by `molgpu-sept-ktr.18` after correctness fixes.
Prior `s5o.17.7/8`, `e62` and `kc1` already pruned exports/helpers; do not
reopen them merely because file sizes remain large. Acceptance: unchanged API
snapshots, public hardening and JSR dry run, package tests, scoped
formatting/lint and no new runtime dependencies.

### Avoid false deduplication

- `table/src/spatial-grid.ts:17-119` is a sparse, partitioned radius-neighbor
  grid; `geo/src/attribution.ts:39-140` is a bounded dense CSR search with
  radius certification and exact exhaustive fallback. Their contracts and memory
  behavior differ. Sharing them would require a new dependency or a weaker
  geometry contract. Keep both unless a measured consumer demonstrates a common
  kernel.
- `table/src/bond-topology.ts` supplies display covalent inference, whereas
  `select/src/bond-graph.ts` preserves MolQL-specific chemical thresholds,
  flags, links and model/altloc rules. The October 1 ownership decision and
  closed `crj.6` settled this distinction. Do not merge them for fewer imports.
- `table/src/elements.ts` owns shared symbol identity and `attributes.ts:27`
  owns the shared domain registry. `select/src/elements.ts` keeps query mass/VDW
  semantics; `fields/src/builtins.ts` owns visualization palettes. Closed
  `molgpu-sept-6mn` already shared equivalent metadata.
- `geo/src/vec3.ts` contains attributed mutable Mol* vector/interpolation
  kernels; use.gpu core or timeline math is not automatically a scientific
  replacement. Preserve singular-case fallbacks and oracle tolerances. No
  runtime use.gpu dependency is justified in these packages.
- DSSP/trace stay in table for the current ownership decision. Moving them to
  dynamics/geo adds dependency edges and conflicts with the documented decision
  without creating a demonstrated additional consumer.

### Performance diligence without unsupported speed claims

`fields/src/primitives.ts:513-520` resolves an attribute view per row through a
cached table helper. A future CPU evaluator could resolve a column once per
evaluation and avoid allocating per-row color tuples (`:625-626`), but measure
this on representative static and snapshot consumers before adding a compiled
CPU-plan cache. The viewer's GPU field route should not be replaced by eager CPU
baking. This is a source-reviewed optimization possibility, not a new bug or
benchmark result.

Selection constructors and MolQL evaluation remain separate because compiled
expressions preserve grouped-set semantics (`select/src/atom-sets.ts:1-7`).
`molgpu-sept-922.8` already tracks the deferred proposal to express simple
builders as expression sugar. Keep that issue; do not introduce a second
reimplementation or assume all builders are equivalent to parser output.

## Verification and limitations

Passing check run in this review:

```sh
deno test -A packages/table/test packages/select/test packages/fields/test packages/geo/test
```

Result: **172 passed, 0 failed**, with type checking. This scoped command does
not run the external `test/selection` corpus/oracle suite, GPU parity harness,
published consumer browser gate or full repository hardening. Their previously
passing evidence is recorded in
[the architecture gate](2026-10-02-crj13-architecture-gate.md); it was not rerun
here. The new field wrap and geo spacing cases demonstrate gaps beyond the
passing scoped tests.

The saved
[public-entry evidence probe](evidence/2026-10-02-second-pass-pure-probe.ts)
asserts all three current discrepancies using one tiny validated structure. Run:

```sh
deno run docs/findings/evidence/2026-10-02-second-pass-pure-probe.ts
```

It passed, printing CPU wrap `20` versus emitted-expression `10`, malformed
numeric literal strings, and distinct spacing/affine normals despite identical
positions and indices. Scoped `deno fmt --check`, `deno lint` and `deno check`
also passed for the probe. These are historical discrepancy assertions; the
probe will need updating after the repair issues land. It does not dispatch GPU
work or replace the planned regression tests.

Ad hoc `deno eval` probes also reproduced the CPU field values, generated
literal strings and geo spacing/affine normal discrepancy described above. No
production source, public API or package test file changed. Pre-existing dirty
retirement evidence and browser-coverage files were untouched. No Beads mutation
was performed by this reviewer; the primary reviewer owns follow-up creation and
reconciliation.
