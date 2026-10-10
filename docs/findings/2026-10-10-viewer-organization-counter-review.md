# Viewer source organization: counter-review

Date: 2026-10-10. Reviews `ba25500`
([proposal](2026-10-10-viewer-organization.md), its
[inventory](evidence/2026-10-10-viewer-organization-inventory.json) and
[example](evidence/2026-10-10-viewer-organization-example.tsx)) against source
baseline `d54ace6`. Tracking decision: `molgpu-sept-9fw`. Review only. No files
moved.

## Verdict

**Accept the hybrid as the target layout, with the corrections below.** The
inventory is accurate and the alternatives are fairly weighed. However, three
claims go further than the evidence supports:

1. The folders do not express dependency structure, and their placement cannot
   make them do so. Six of the twelve proposed directories form one dependency
   cycle.
2. `structure/` would contain three files that `Structure` never imports. It
   also omits the cache that `StructureProvider` releases.
3. The proposal reorganizes the least of the code in its largest folder,
   `representations/`: 24 files, 5,633 lines and about 40% of the source.

The alternatives table also lacks a no-move baseline, even though the October 4
review recommended against a mass move.

## What was re-verified

- **Inventory accuracy.** A fresh scan of relative imports, including dynamic
  `import()`, matches every `relative_dependencies` entry for all 114 files.
- **File counts.** 48 top-level files plus 66 under `internal/` is correct.
- **Example.** `deno check` passes on the example. It uses only public exports.
- **Hardening and API safety.**
  - Rule H4's `src/internal` exception applies only to non-viewer packages that
    use `@use-gpu/core`, so the move does not affect it.
  - `packages/viewer/api.txt` contains no source paths.
  - The two `deno.json` export paths do not change.

## Findings

### F1. The folders are topic homes, not layers

Method: map each import to its proposed folder and ignore `index.ts`,
`advanced.ts` and `types.ts`. The result has 227 cross-folder edges and seven
two-way folder pairs. The strongly connected components are:

- `structure`, `trajectory`, `coordinates`, `attributes`, `selection`,
  `rendering`
- `volume`, `fields`

These cycles follow from how the scopes work, so moving files cannot remove
them. `structure-context.ts` is not a lightweight context definition. It holds
`StructureProvider`, which resets the coordinates, attributes, snapshots and
trajectory scopes. Every consumer also reads `useStructure()`.

I tested a variant that moves all context definitions into a `scopes/` folder.
It added edges (250) and still left a six-folder cycle. **Do not add a `scopes/`
folder.**

Corrections:

- The source reading guide should say plainly that folders group code by topic
  and that imports between them go both ways.
- Rename or document `structure-context.ts` as the reset hub, for example
  `structure-provider.ts`. A rename is a pure path change, so it is safe during
  the move. Splitting the file is a separate logic change.
- Do not add folder-level lint walls later on the assumption that the folders
  are layers.

### F2. Some files are placed by name, not by their importers

| File                                   | Proposed       | Actual importers                                                                           | Correction                                            |
| -------------------------------------- | -------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `instance-plan`, `-copies`, `-context` | `structure/`   | Representations, picking, `representation.ts`, camera; never `structure.ts` or its context | `rendering/` (expanding assembly copies at draw time) |
| `gpu-scan`                             | `attributes/`  | `gpu-dssp`, `marching-cubes-gpu`, `ses-field`, `attribution-gpu`                           | `internal/` (a shared compute primitive)              |
| `copy-positions-wgsl`                  | `coordinates/` | `gpu-dssp`, `ses-field`; no coordinate provider imports it                                 | `internal/`                                           |
| `ribbon-dssp`                          | `attributes/`  | `ribbon.ts` only                                                                           | `representations/`, beside ribbon                     |
| `immutable-attribute-cache`            | `attributes/`  | `structure-context` (release), `attribute-sources`                                         | `structure/` (Structure owns its release)             |

These moves leave the folder cycles unchanged (225 edges, same components). They
are about honest ownership: `structure/` would then contain only what
`Structure` uses. The proposal asked whether immutable attributes and
ribbon-DSSP have the right homes. They do not.

### F3. `fields/` shares a name with `@molgpu/fields`

The viewer's `fields/` folder would hold field planning and binding. A reader
looking for field logic would then find two `fields` locations with different
contracts: one renderer-free, one GPU binding. The folder also forms a cycle
with `volume/`, because `use-field` and `use-field-plan` read the volume context
and buffers. Rename the folder to `field-binding/`. That fixes the naming
hazard, which was the stated goal. `selection/` versus `@molgpu/select` is a
milder version of the same problem. It can stay if the reading guide names the
package.

### F4. Organize `representations/` by feature where a feature owns three or more files

The proposal mentions sub-foldering surface but defaults against it. Most
navigation happens in `representations/`, so feature groups pay off most there:

- **`surface/`, 7 files.** Includes `ses-field.ts` at 868 lines.
- **`ribbon/`, 4 files.** `ribbon`, `ribbon-geometry`, `cartoon-geometry` and
  `ribbon-dssp` (after F2).
- **`bonds/`, 3 or 4 files.** `bonds`, `bond-columns`, `bond-positions`, and
  possibly `ball-and-stick`.

Leave single-file representations flat. This keeps the rule of no folder per
component while still grouping the features that own several files.

### F5. The alternatives table needs a baseline row

Add these options so the decision records why they were rejected:

- **Option 0: no move.** Add only a source reading guide to the viewer README: a
  topic-to-file map generated from the inventory. Cost is near zero, with no
  churn in `git blame`, no risk to the 69 path-sensitive consumers, and no
  conflict with PR #91.
- **Option 0.5: partial move.** Create only `trajectory/`, `volume/` and
  `representations/surface/`. Leave everything else flat.

Choose the hybrid only if the trajectory pilot shows a navigation benefit that
the guide alone would not give. That needs a stated criterion (see F7).

### F6. `internal/` already fails to mark what is private

`advanced.ts` already exports from `internal/coordinate-kernel.ts` and
`internal/structure-resource.ts`. In the new layout, public and private files
sit side by side, for example `coordinates/coordinate-kernel.ts` and
`coordinates/elastic-bindings.ts`. The reading guide should state the actual
rule: a file is public only if `index.ts` or `advanced.ts` can reach it. It
should list the public files for each folder, generated from the inventory.

### F7. Migration gates need to be concrete

- **Pilot decision.** Before the trajectory pilot, write down what success
  means. For example: every trajectory-owned symbol is reachable from
  `trajectory/`, the pilot needs no more than N edits outside the folder, and a
  reviewer prefers the result to Option 0. If it fails, stop.
- **Hard gates on every batch.**
  - `api.txt` is byte-identical.
  - The `deno publish --dry-run` file list differs only by the renamed paths.
  - `deno task check:hardening` passes.
- **Browser suites.** List the suites for each batch, generated from
  `candidate_path_sensitive_consumers` filtered to the moved files. "Relevant
  suites" is not specific enough. Vite `/@fs` URLs and dynamic imports fail only
  at runtime, so `deno check` will not catch them.
- **Commit hygiene.** Keep each batch rename-only and add it to
  `.git-blame-ignore-revs`. Do not mix renames with edits beyond import
  specifiers.
- **Example.** The JSX example correctly shows that the public API does not
  change, but it says nothing about the layout. Call it an API invariance check,
  not the acceptance example for the move.

## Answers to the bead's review questions

- **Hybrid versus strict dataset nesting:** Hybrid, with F1's caveat. Strict
  nesting would put most molecular code under `structure/` and hide the
  coordinate and attribute streams.
- **Representations under Structure:** No. Six folders already depend on one
  another in a cycle, and nesting under Structure would imply ownership that the
  imports do not show.
- **Homes for EField, UnitCell, ribbon-DSSP and immutable attributes:**
  - EField in `volume/` and UnitCell in `representations/` are correct.
  - Ribbon-DSSP and the immutable-attribute cache should move (F2).
- **Twelve sibling directories:** Acceptable. The count stays at 12 after the
  corrections and the `field-binding` rename. The real crowding is inside
  `representations/` (F4).
- **Misleading selection and field coupling in `rendering/`:** Yes, partly.
  - `representation.ts` mixes several concerns, as the proposal says. Keep the
    extraction as a separate follow-up.
  - Moving the instance files into `rendering/` makes the
    `representation.ts → instance-*` edges internal to the folder.
  - The `rendering ↔ structure` cycle remains because
    `structure-context → column-source`.
- **Coverage of path-sensitive fixtures and API stability:** Not yet. See F7.
  The 69 text-scan candidates must become an exact list of suites for each
  batch.

## Follow-ups (only after the layout is chosen)

1. Amend the proposal's file map with F2 and F3. Add Option 0 and Option 0.5 to
   the alternatives.
2. Write the pilot's success criterion and the gate script for each batch before
   moving any files.
3. Splitting `StructureProvider` from `StructureContext` and extracting
   `representation.ts` stay out of scope. Each needs its own issue and evidence.
