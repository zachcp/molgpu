# Post-overhaul diligence: table, select, fields and geo

Date: 2026-10-04. Baseline: `8bf1005`. Review: `molgpu-sept-0vs.1`.

## Decision

Retain the four packages and their single public entry each. Table and geo have
no production external imports. Select and fields depend only on table's public
entry. There are no production use.gpu, Mol* runtime, sibling deep imports, or
new subpath problems in this group. Removing these two package edges would
repeat contracts rather than simplify ownership.

The completed `ktr` repairs are present: fields separates construction,
evaluation and compilation; select has an explicit barrel; table's compatibility
type barrel is gone; wrap endpoints, numeric literals and geo spacing use their
corrected paths. Do not reopen the previous pure review's issues.

One new correctness issue needs implementation: selection IDs are not unique to
membership, but GPU consumers treat them as such. There is no evidence from this
pass for another package split, a generic math layer, or replacing scientific
ports with use.gpu.

## P2: distinct selections can share a viewer cache key

`packages/select/src/selection.ts:594-603` computes a 32-bit hash. The comment
claims changed membership yields a different ID, which a finite hash cannot
guarantee. `makeSelection` includes dataset, domain, revisions and length with
that hash (`:629-654`); set operations construct the same form (`:892-923`).

The saved [public-entry probe](evidence/2026-10-04-post-overhaul-pure-probe.ts)
constructs a valid 1,000-atom structure and resolves two topology-only queries:

```text
left:  [265,316,363,518,554]
right: [176,293,558,652,787]
id:    atom@0#topology=0:5:7005c825  (both)
```

This is a reproduced public-API collision, not a hypothetical birthday-bound
argument. The rows are disjoint, and the dataset and revision are identical.

Source-confirmed impact:

- `viewer/src/internal/representation.ts:42-49` memoizes selected rows on
  `select.id`. Its subsequent exact membership comparison cannot repair the
  collision because the memo returns the old rows before that comparison.
- `viewer/src/transform.ts:75-92` memoizes the uploaded selection mask on that
  ID, plus device, identity-matrix flag and coordinate count.
- `viewer/src/efield.ts:613` similarly keys selected charge/position
  preparation; Superpose and Unwrap pass selection IDs as row/center keys
  (`superpose.ts:368`, `unwrap.ts:388`).

No rendered collision was dispatched during this review. Stale rows/masks are
source-reviewed consequences of the observed collision and current memo keys.

Acceptance: do not use a hash as a proof of equality. Preserve dataset and
revision semantics and equal-membership reuse, but disambiguate hash buckets
with exact rows or use safe consumer membership invalidation. Avoid an unbounded
strong-reference registry. Add both collision sets to select regression tests,
including set-operation paths; a browser test must switch between them on the
same structure and verify representation membership and Transform mask update,
without geometry rebuilds for truly unchanged rows. Check uncaptured WebGPU
errors. A wider probabilistic hash alone does not establish the claimed
invariant. Primary reviewer checks existing Beads and owns the bounded
implementation issue.

## Per-package diligence

| Package | Retain                                                                                                                                                                                      | Simplification assessment                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| table   | Validated immutable-by-contract columns; private identity/revisions; molecular attributes; volume/trajectory contracts; trace and DSSP scientific derivations.                              | Responsibility modules are coherent. Keep its one entry. The uniform sparse grid, attribute domain registry and element identity already share equivalent work.                                                                                    |
| select  | Query recipes versus dataset-bound selections; scoped eligibility; chemical graph separate from display bonds; grouped expression semantics.                                                | Fix cache-key correctness first. `selection.ts` and `expr.ts` remain large, but splitting solely for line count would not remove a contract or dependency. The explicit entry is already easy to audit.                                            |
| fields  | Renderer-free CPU evaluation and WGSL strings/plain binding descriptions; contextual versus explicit volume inputs; owned constructor parameters and documented retained annotation arrays. | The new construction/evaluation/compile split matches actual responsibilities. Keep shader runtime/linking in viewer. Resolve attributes once per CPU evaluation only after measuring the hot path; no new plan cache is justified by this review. |
| geo     | Owned typed-array meshes, mutable reusable curve state, attributed Mol* kernels and deterministic fallback behavior.                                                                        | `index.ts` still includes marching cubes (271 lines); this is not a correctness or export problem. Moving it to a private module is optional and should not expand the public surface.                                                             |

The source inventory covers all 40 top-level implementation/type modules plus
select's private revision module, their import edges and package entries.
Focused line-level review followed structure ownership/attributes, volume and
trajectory validation, selection resolution/cache keys, field
construction/evaluation/WGSL, annotation joins, marching cubes and attribution.
Scientific DSSP, chemical threshold tables and the full expression language were
checked for boundaries and regression coverage, not independently rederived
mathematically.

## Redundancy and upstream decisions

Do not conflate table's display bond inference with select's MolQL chemical
graph, or select's atomic mass/VDW tables with display radii and CPK colors.
Their rules and provenance intentionally differ. The spatial grid in table is a
partitioned sparse radius query; geo's dense CSR nearest-attribution grid has a
certification/exhaustive fallback contract. A shared implementation would need
proof beyond similar loops.

Vector helpers in trace and geo preserve their own precision, mutation and
singular-case behavior. No replacement with use.gpu is proposed, so no new
renderer dependency or assumed upstream equivalence is introduced. The viewer
review owns the installed use.gpu primitive comparison.

A small remaining layout opportunity is test-only code within production source:
`table/src/bond-topology.ts:171` (`selectBonds`) and
`table/src/trajectory.ts:268,292` (`frameAtTime`, `trajectoryFromModels`) have
no production callers in the repository. Their callers are table/IO tests; none
is in table's public entry. If an existing pruning task is extended, remove the
unused wrapper or move test fixtures into test support, retaining the useful NMR
trajectory fixture. Do not create a new public export to justify keeping these
helpers. This is an organizational opportunity, not a measured startup or bundle
improvement, and does not warrant a standalone correctness issue.

## Structure, Trajectory and Volume boundary implications

Pure data already has the appropriate distinction: Structure owns topology and
row identity; Trajectory supplies coordinates plus optional row mapping over
that topology; Volume owns grid geometry and scalar/vector samples. Preserve
these contracts when organizing viewer sources and specialized
transforms/visuals. Fields' argument-free `volumeSample()` is a scoped volume
read at structure atom coordinates, not a generic inheritance relationship
between the molecular data types. Table should not absorb renderer scope or
specialized GPU ownership to make file names symmetric.

## Documentation and checks

The former select query-prop/connectivity and fields useAnnotation mismatches
have been corrected. Published README examples still contain `^0.1.0` dependency
illustrations while manifests are 0.2.0; the primary documentation pass owns
that small correction. Historical discrepancy probes remain dated evidence and
must not be reported as current passing regression tests after their repairs.

Fresh verification:

```sh
deno test -A packages/table/test packages/select/test packages/fields/test packages/geo/test
```

**180 passed, 0 failed (51 seconds), including type checking.** This includes
existing corpus snapshot-connectivity tests and geo Mol* curve/marching-cubes
oracles reached by that command. The public collision probe reproduced the ID
above. Scoped formatting passed for the report/probe; lint and type checking
passed for the probe.

No production implementation, package manifest, API snapshot or existing package
test changed. This pass did not run fields browser parity, the external
`test/selection` suite, full hardening, JSR publish dry run, or a full GPU gate.
Prior `ktr` browser checks are historical evidence only. No performance numbers
are claimed. Beads mutations remain with the primary reviewer.
