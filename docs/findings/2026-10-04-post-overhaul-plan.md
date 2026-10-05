# Post-overhaul architecture diligence plan

Date: 2026-10-04. Baseline: freshly fetched `origin/main` at `8bf1005`. Tracking
epic: `molgpu-sept-0vs`.

## Scope

Review all eight packages after the completed `crj` architecture gate and `ktr`
second-pass fixes. Preserve the original dirty checkout by using the attached
`architecture-second-pass` worktree. This pass produces evidence, documentation
corrections and bounded implementation issues; it does not refactor production
code or publish anything. Read current source before repeating historical
claims.

## Sequence recorded before diligence

1. Establish manifests, public entries, package edges, current findings and
   Beads.
2. Delegate table/select/fields/geo source, imports, exports and layout
   diligence (`0vs.1`).
3. Delegate io/dynamics/timeline diligence, scientific distinctions, lazy
   loading and applicable upstream reuse (`0vs.2`).
4. Delegate viewer adapter comparison with installed use.gpu 0.20.0 primitives,
   resource ownership and duplicate mechanics (`0vs.3`).
5. Primary reviewer traces Structure, Trajectory and Volume scope contracts,
   specialized transforms and visuals, import directions and public API
   (`0vs.4`).
6. Counter-check candidates and existing issue ownership, run proportional
   checks, consolidate current documentation and record prioritized bounded
   follow-ups.

Agents own separate dated reports; the primary reviewer owns Beads mutations,
the integrated report and current documentation. Existing `s5o.11` browser
coverage and `s5o.22` ordered-native-kernel work are in progress elsewhere and
remain references rather than duplicated or reassigned work.

## Evidence and acceptance

Every package gets a retain/simplify/follow-up assessment. Minimal exports means
supported entry discipline, not deleting useful CPU scientific APIs or private
module exports. Reducing imports must remove coupling rather than duplicate
contracts. Upstream substitutions require actual contract equivalence.

Separate reproduced failures, source-reviewed risks, passing checks and
historical evidence. No benchmark or full GPU-gate claim without fresh
execution. Documentation receives formatting and local-link checks. Findings
needing implementation receive executable acceptance examples and proportionate
unit/type/API/browser checks in Beads. Close review tasks only after integrating
evidence; implementation remains explicitly open.
