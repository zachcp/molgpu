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

Final-tree validation is recorded here after completion. Checks distinguish the
unchanged API/publish contents, static source equivalence, path-sensitive
browser execution and hosted acceptance. No publication or deployment is part of
this migration.
