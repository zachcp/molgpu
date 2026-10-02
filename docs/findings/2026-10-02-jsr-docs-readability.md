# JSR documentation readability review

Date: 2026-10-02. Local baseline: `origin/main` at `9b1c5b1`. Branch:
`codex/jsr-docs-readability`. Tracking: `molgpu-sept-c4g`. Scope: documentation,
examples and exported API comments; no runtime changes.

## User and repository perspectives

The [JSR search](https://jsr.io/packages?search=molgpu) listed eight published
packages, all at `0.1.0`. Reviewed each overview and generated API index, then
retrieved its published README, changelog and public source definitions using
registry version metadata. Three subagents reviewed disjoint package groups
against current source and exports. The full ten-entry surface includes
`viewer/advanced` and `dynamics/wgsl`, not only the eight main entries.

[Baseline evidence](evidence/2026-10-02-jsr-docs-baseline.json) records registry
versions, publication timestamps, URLs and README hashes. Dynamics and timeline
READMEs matched main byte-for-byte; the other six differed. A difference is not
itself a bug: published sources have canonicalized imports, and main already
contains later ownership, validation and source-layout changes.

The September architecture review was used to identify contracts to inspect.
Current source and later completion records determine whether those findings
still apply. Historical investigation notes were preserved. The current
architecture guide now reflects the repaired pending trajectory/Superpose path;
release guidance now describes eight packages and the actual browser CI groups.

## Findings and edits

| Package  | Review result and local edit                                                                                                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| table    | Keep the explicit constructor example; make bounds access null-safe. Correct attribute updates, same-copy identity and immutable array contracts. Replace internal module maps and dated decisions with caller-facing chemical/display policies.                                                                     |
| select   | Replace a full duplicated topology fixture with a working loader/query example. Distinguish query builders from resolved set operations; clarify model/conformer scope. Correct outdated Mol* mass differences and duplicated builder descriptions.                                                                  |
| fields   | Shorten onboarding, add a real annotation join, and explain CPU volume context, broadcast domains, custom residue lifting and retained annotation values. Preserve numeric overflow and CPU/WGSL limitations.                                                                                                        |
| io       | Lead with supported formats. Correct obsolete no-bonds and all-errors claims. Add complete selection/trajectory guidance, real radii in the surface example, and explicit subset atom mapping; retain transport/cancellation, units and provenance.                                                                  |
| geo      | Replace an undefined curve sketch with complete public imports and controls. Clarify mutable reusable state, segment placement, x-fastest grids and affine normal/winding behavior.                                                                                                                                  |
| dynamics | Replace phase-plan links and a stateless-simulation claim with executable fitting, periodic and Langevin examples. Retain scientific tolerances, state mutation/replay rules, temperature bias, and unique GPU uniform/budget contracts.                                                                             |
| timeline | Replace unavailable viewer helpers with `sample`, `CameraCurve` and `useCameraCurve`. Add fractional frame timing and playback examples, same-copy curve identity, and resource/snapshot guidance.                                                                                                                   |
| viewer   | Fix required WebGPU fallback, missing install dependency and charge-column descriptor. Repair source/example links; organize live/snapshot consumers in a table. Clarify scopes, pending/empty selection, assembly copies and current hooks. Remove unavailable helper references and unqualified benchmark numbers. |

Every package's full README, changelog, export map and public definition
comments were reviewed. Added module summaries for all ten generated API entries
and concise missing/misattached public JSDoc. Removed internal issue/phase
shorthand from public prose while retaining scientific attribution and
limitations. Kept API tables for complete export discovery. Longer references
now have smaller sections and practical examples; boilerplate was not added for
self-evident members. Each package changelog records the documentation update.

A second read-only subagent integration review caught three additional issues:
optional atom radii in the IO example, unnamed trajectory mapping helpers, and
incorrect curve-segment placement. All three were corrected before handoff.

## Verification

- Actual README examples were checked against public exports. Root loading and
  selection ran successfully on RCSB 1crn; table/select/fields primary examples,
  IO loading/surface/selection/charges, geometry extraction/curves and dynamics
  fitting/periodic/Langevin examples also ran successfully.
- Viewer/timeline scene examples type-check against the pinned use.gpu API.
  Trajectory URLs are explicitly illustrative; their signatures and atom-order
  contracts were inspected rather than claiming a downloaded trajectory run.
- Timeline unit tests: 14 passed. Public JSX consumers type-check.
- `deno doc --json` generated all ten entries with module summaries. It emitted
  type-resolution warnings from the installed use.gpu declaration files; this is
  a warning-bearing generation result, not a clean documentation lint claim.
- Parsed TypeScript output with comments removed matches the baseline for every
  edited source file. API snapshot diffs contain only embedded comment updates;
  exports and signatures are unchanged.
- Final formatting: 70 changed Markdown/JSON/TypeScript files passed. Lint: 49
  edited TypeScript files passed. Whitespace check passed.
- Final `deno task check:hardening`: all eight packages passed H1–H6.
  `deno task jsr:check`: whole-workspace dry run passed.
- All 49 edited TypeScript files have identical parsed code after removing
  comments; four API snapshots were regenerated and reviewed as comment-only
  changes.

No GPU behavior changed, so browser GPU suites were not rerun and no full GPU
gate is claimed. No package was published or deployed. Published `0.1.0` pages
remain unchanged until a separate release; local improvements are for the next
release. Original checkout changes were left intact in their existing branch.
