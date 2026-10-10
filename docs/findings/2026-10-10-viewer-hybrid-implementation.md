# Viewer hybrid organization implementation

Date: 2026-10-10. Decision: `molgpu-sept-9fw`. The owner accepted the corrected
hybrid after the proposal, counter-review and review response. PR #91 is merged;
its production tree is the starting point. Work branch:
`codex/viewer-hybrid-layout`.

## Selected layout

Structure, Trajectory and Volume have visible top-level homes. Coordinate and
attribute pipelines remain shared topics. Volume visuals live with Volume;
molecular surface/ribbon/bond features group their own implementation. Viewer
field adaptation is named `field-binding`, and named mechanics folders avoid a
second large runtime umbrella.

The authoritative
[migration map](evidence/2026-10-10-viewer-hybrid-migration.json) maps all 114
original source paths to the selected paths. Earlier inventories retain their
historical alternative mappings. Four root files remain: the ordinary and
advanced entries, shared public types and independent timeline context.

The package README's source reading guide explains ownership, nearest scopes,
cross-topic imports and public entries. The two Deno manifest export paths and
publish allowlist are unchanged. No new barrel, public API, package or runtime
framework was introduced. The mixed representation helper remains intact in
rendering; splitting it is a separate task.

## Pilot and migration

The trajectory pilot moved six files in commit `8cda705`. Its component,
metadata context, reader, player, cache and window can now be found together.
Shared request and coordinate-publication modules are linked in the guide. It
required only the enumerated path changes and formatting, with no logic cleanup.
This met the pilot's navigation criterion and allowed the remaining authorized
layout to proceed.

Pilot acceptance:

- Frame cache/window: 11 unit tests passed.
- Trajectory, components and nearest-source Superpose: three browser tests
  passed, including their browser/WebGPU error assertions.
- Component and site type checks passed.
- All eight packages passed H1–H6 on an authorized localhost-registry rerun.
- The viewer API snapshot remained byte-identical.
- The publish dry run contained the same 118 viewer files, after the six source
  path renames.
- All 114 source token streams matched the original after normalizing module
  paths and harmless formatting/trailing-import commas. Comments were excluded
  from that token comparison.

The remaining batch updates relative imports, export paths within the unchanged
entries, private test imports, browser dynamic imports and repository-source
URLs. Each resource owner, shader, scope reset, snapshot token, frame policy and
teardown stays with its original implementation.

Rename commits are recorded in `.git-blame-ignore-revs` in a separate metadata
commit. Documentation and the import guard are separate from the path-move
commits. Historical findings and recorded evidence retain their baseline paths;
the executable field-alpha probe has its private import updated so it still
runs, with its scientific logic unchanged.

## Narrow import guard

The existing hardening check now rejects a production viewer import from a
provider or shared-mechanics module into any `representations/` folder. Public
entry exports and imports between visual implementations are exempt. It covers
both the molecular representation tree and `volume/representations/`.

Three focused tests check prohibited provider/visual dependencies, permitted
entry and visual dependencies, cross-topic provider imports, Windows separators
and paths outside this package. They pass. No strict walls were added between
other topic folders. The broader contract-import rule remains advisory because
some contract files also contain provider implementations.

## Final validation

Final static acceptance:

- Viewer units and the new import guard: 163 passed. Public-example,
  published-reference and import-wall unit checks: six passed.
- Workspace/component/site type checking and the public JSX invariance example
  passed. Viewer `api.txt` is byte-identical to the baseline.
- The publish dry run includes the same 118 viewer files after the authoritative
  path map. The README guide and changelog are declared documentation changes;
  source content changes are module paths and formatting only.
- The map covers exactly 114 source files, with 97 renames and 50 enumerated
  external code consumers. All 114 source token streams preserve the baseline
  after path normalization and harmless formatting/trailing-import commas.
- Repository formatting (642 files), repository lint (423 files) and scoped
  hardening-tool lint passed. R1 and advisory R2 have zero violations.

Final execution acceptance:

- Complete workspace unit run: 567 passed, zero failed.
- Final H1–H6: all eight packages passed, including the new viewer direction
  guard. The independent local JSR consumer passed.
- Nineteen final-tree browser runners passed across two invocations. Components,
  trajectory, nearest-source recovery, volume and DSSP passed first. The
  remaining fourteen runners passed 94 tests and 15 ElasticNetwork steps, with
  28 inapplicable cases ignored. These cover EField, ElasticNetwork, readback
  identity, Gate 2, postprocess, invalidation, materials, picking, annotations,
  tube, ribbon, surface, SES field and size fields, including their error
  checks.
- The first invocation was interrupted during EField's standalone throughput
  work; the remaining runners were restarted with CI's `MOLGPU_SKIP_TIMING=1`.
  Numerical/rendering/lifetime checks remained enabled. No new throughput or
  complete memory-retirement benchmark claim follows from this refactor.
- Draft PR #92 is pushed. On its initial implementation head `533d439`, hosted
  static/unit checks, Site build and the site/retirement/electric-field/
  invalidation WebGPU groups passed; the viewer group was still running when
  this record was written. Hosted checks must reflect the final documentation
  commit before merge.

Historical surface clipping acceptance is passing in the hosted site group on
this implementation. No production clipping change was included. The prior
bounded investigation remains independent of this layout.

No public-registry publication, merge or deployment is part of this migration.
