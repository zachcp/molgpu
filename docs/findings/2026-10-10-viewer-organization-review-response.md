# Viewer organization: response to the counter-review

Date: 2026-10-10. Review baseline: `f4afb2d`, including the counter-review
(`76f0ecd`) and stream-layout exploration (`f4afb2d`). Production source remains
at `d54ace6`. Tracking: `molgpu-sept-9fw`. Review only; no production changes.

## Revised recommendation

Keep the hybrid, with the counter-review's placement corrections and feature
subfolders. Use the stream model to explain composition, rather than making
every directory mirror a component's output. Preserve top-level `structure/`,
`trajectory/` and `volume/` because those are the entry concepts users search
for. Keep volume visuals beside their provider; retain named mechanics folders
instead of collecting 37 files under a new `runtime/` umbrella.

```text
src/
  index.ts  advanced.ts  types.ts  timeline-context.ts
  structure/              Structure, provider/resource, immutable-column owner
  trajectory/             source/playback, metadata, cache and GPU window
  coordinates/            coordinate contracts, publication, transforms/dynamics
  attributes/             attribute contracts, publication and producers
  volume/                 loaded/computed volume scopes and their buffers
    representations/      slice, isosurface, field lines/arrows and their helpers
  representations/        molecular visuals and annotations
    surface/              surface's seven owned implementation files
    ribbon/               Ribbon/Cartoon geometry and ribbon-DSSP row planning
    bonds/                Bonds and bond-column/position helpers
  selection/              viewer query resolution and pending/status behavior
  field-binding/          GPU adaptation of @molgpu/fields values
  rendering/              columns, materials, sizing, opacity and assembly copies
  interaction/            picking, pointer projection and camera/focus
  internal/               shared request, dispatch, readback and job mechanics
```

This is a revised recommendation, not a selected decision or an updated complete
file map. The two existing inventories remain historical alternatives. An
implementation plan should generate one authoritative revised map after the
layout is selected, so three competing maps do not silently disagree.

## What I accept

The counter-review improves the original proposal in substantive ways:

- Assembly instance expansion belongs with rendering, not Structure ownership.
  Its consumers are representations, picking and camera/focus. Structure never
  imports these helpers.
- The immutable attribute cache belongs with Structure ownership. Consumers
  borrow columns; StructureProvider releases the owner's references.
- GPU scan and frozen-position copy shaders serve several features and belong
  with shared GPU mechanics. Ribbon-DSSP row planning belongs beside Ribbon.
- `field-binding/` describes the viewer adapter more clearly than another
  `fields/` directory beside the renderer-free `@molgpu/fields` package.
- Surface, ribbon and bonds merit feature folders. They each own several files;
  grouping them improves the package's busiest browsing area.
- Guide-only and partial-move options must remain genuine alternatives. A full
  move should follow demonstrated navigation benefit from a small pilot.
- Public API stability, publish contents, path-sensitive browser fixtures and
  rename-commit hygiene need explicit acceptance, not a general promise to run
  relevant tests.

The original public JSX example is an API/composition invariance check. It does
not test whether a folder layout improves navigation. The pilot needs separate
human review for that.

## Corrections and qualifications

I independently re-scanned the current source and verified all 114 inventory
entries and their relative dependencies. The stream map's 419 imports, 125 deep
relative paths and zero R1/R2 violations reproduce. Placement corrections match
actual source importers.

Three details should be corrected when consolidating the planning documents:

1. **Representations are 32.5% of source lines**, not about 40%: 5,633 of 17,324
   lines under the original inventory's assignments. They are still the largest
   proposed folder. The original mapped layout has **11 directories**, plus root
   entry/types/time files, rather than 12 sibling directories.
2. **Folder cycles are aggregation, not demonstrated module cycles.** The 227
   cross-folder import edges and the two reported folder strongly connected
   components reproduce. With the same entry/types exclusions, the source-file
   graph has no strongly connected component with multiple files. This supports
   the warning against treating topic folders as layers; it does not justify a
   new cycle-removal refactor. The scan includes type imports and is not a
   runtime-load or bundle analysis.
3. **Public means exported, not merely reachable by imports.** A helper imported
   by an exported component remains private. Enumerate names exported by the two
   entries and types in their public signatures. Do not label every file in the
   transitive implementation dependency closure public.

I also disagree with making a `representation.ts` split a prerequisite for the
layout. Its mixed responsibilities are real, but a mechanical move can preserve
them honestly and document the exception. Both planning documents say semantic
refactors should be separate; making the split mandatory before folder moves
would couple the two efforts again. Neither a helper split nor renaming the
Structure reset hub is necessary for the trajectory pilot.

## Resolve the stream exploration's four choices

| Choice              | Recommendation                                                 | Reason                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trajectory location | Top-level `trajectory/`                                        | Preserves one of the three named entry concepts. The guide explains that it is also a coordinate provider.                                                 |
| Volume visuals      | `volume/representations/`                                      | The small loaded/computed volume family is debugged together. A common representation rule can still cover both representation locations.                  |
| Shared mechanics    | Named selection, field-binding, rendering and internal folders | Names explain responsibility without moving most of the old internal directory into a new runtime umbrella.                                                |
| R1/R2 checks        | R1 can be a narrow hard gate; R2 starts as an import report    | R1 expresses the existing provider/visual separation. R2's mixed contract files require more precise symbol rules before it becomes an architectural wall. |

R1 should exempt the public entries and apply to production viewer code. Tests
may directly import representation helpers. The rule should prevent providers
and general mechanics from depending on visual implementations; reusable code
needed outside a visual needs an appropriate shared home.

R2 currently passes, but its filename allowlist cannot distinguish reading
`useStructure()` from importing `StructureProvider` out of the same module.
Report it in the pilot; agree allowed hooks/types and intended exceptions before
blocking changes with it. Do not infer that R2 requires splitting all context
files, or add broad folder-level import walls across providers.

Deep relative paths are an editing cost, not a correctness or performance
metric. Feature folders introduce some longer imports in either layout. The
navigation benefit can justify those paths; avoid new barrels simply to hide
them.

## Concrete trajectory pilot

After PR #91 merges and the layout is chosen, move only the six trajectory files
and their import references. No new component, ownership split, shader change,
prop change or directory barrel belongs in that commit.

Before moving, enumerate every source/test/script reference to those six files,
including re-exports and dynamic paths. Every outside edit must correspond to a
recorded path reference. Use that exact list rather than an arbitrary maximum
number of outside edits. The original 69-candidate text scan is not an exact
per-batch dependency list.

The trajectory pilot's minimum validation is:

- Scoped formatting/lint and viewer unit tests, including frame cache/window.
- Component and site type checking; retain the public JSX invariance example.
- `run-trajectory.mjs`, `run-components.mjs` and `run-superpose-source.mjs`:
  playback/source recovery, nested owner boundaries, first-reference access and
  retained children.
- `check:hardening`, byte-identical viewer `api.txt`, and JSR publish dry run.
  Review publish contents for moved paths and unchanged content; any new reading
  guide is a separately declared documentation addition.
- Any additional runner named by the exact private-path reference scan. Broader
  hosted acceptance follows the repository's existing workflow.

For navigation acceptance, a reviewer should be able to locate source opening,
frame scheduling, GPU-window ownership, metadata publication and teardown from
`trajectory/` and its short reading guide. Shared source requests and coordinate
publication remain explicitly linked outside the folder. Compare this with the
guide-only alternative. If the pilot gives no useful improvement or needs logic
changes to work, stop at the guide/partial layout rather than force a full move.

Record rename commits in `.git-blame-ignore-revs` in a following metadata
commit; a commit cannot include its own final hash. Keep helper extraction in a
separate issue/diff. No full-migration browser or performance claim follows from
this planning review.

## Status

The new planning documents advance the decision. They do not authorize
implementation. Keep `molgpu-sept-9fw` open until the owner selects the revised
layout or a smaller alternative. No new implementation issue or production move
is necessary to complete this review.
