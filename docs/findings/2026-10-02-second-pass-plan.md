# Second architecture and package diligence pass

Date: 2026-10-02. Source baseline: `e2b4df7`, use.gpu `0.20.0`. Tracking epic:
`molgpu-sept-ktr`; review tasks `ktr.1`–`ktr.4`.

## Scope and approach

Review and planning, with documentation corrections and bounded Beads
follow-ups. No production refactor, publication or deployment is part of this
pass. Preserve pre-existing dirty retirement evidence and browser coverage
scripts. The completed `crj` architecture gate and `s5o.7` compute audit are
evidence, not assumptions that every composition or simplification has been
settled.

1. Establish current decisions, issue status, public entries and dependency
   graph.
2. Review table/select/fields/geo for ownership, redundant helpers, imports and
   minimal public surfaces; preserve scientific distinctions.
3. Review io/dynamics/timeline for the same concerns, lazy dependencies and the
   boundary between source data, scientific transforms and rendering.
4. Review viewer adapters against installed pinned Live/data/shader/compute
   primitives, identifying equivalent upstream mechanics and justified
   exceptions.
5. Review Structure/Trajectory/Volume scope, specialized transforms and visuals,
   import directions, internal file organization and main versus advanced
   exports.
6. Counter-check findings against current source and existing Beads, consolidate
   current documentation navigation, and record small follow-ups with
   acceptance.

Steps 2–4 use delegated, disjoint review reports. The primary reviewer owns step
5, documentation integration, Beads mutations and final reconciliation. Agents
read root/relevant package READMEs and manifests plus the September 28
architecture review before inspecting source. Reports distinguish source risk,
reproduced failure, passing check and historical evidence. No unsupported
performance claims.

## Deliverables and completion

A consolidated review with a package-by-package matrix, dependency and
composition maps, prioritized findings, retained decisions, validation
requirements and explicit deferrals. Each actionable finding references an
existing or new bounded issue; review tasks close only when their evidence is
integrated. Minimal exports means fewer necessary supported entry points, not
deleting useful scientific APIs or moving runtime imports into lower packages to
reduce counts.

Documentation changes receive scoped formatting and link checks. Source probes
receive proportional type/unit checks; no full GPU gate is claimed unless run.
Implementation follow-ups specify appropriate browser lifetime/composition
tests, public API hardening, API snapshots and JSR dry-run requirements.
