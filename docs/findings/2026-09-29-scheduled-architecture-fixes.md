# Scheduled architecture fixes

Date: 2026-09-29. Branch: `codex/architecture-scheduled-fixes`. Beads: `crj.16`,
`crj.17`, `crj.19`, `crj.18`, `s5o.1`, `crj.12` (all prefixed `molgpu-sept-`).
No design spike or final gate is closed by this work.

## Dependency contract and checks

Docs describe caret JSR dependencies and module-private identity, exact matching
use.gpu dependencies, and the viewer bundler requirement. IO publishes Mol*
5.11.0 exactly: parser/oracle validation establishes that version, not an
untested future 5.x release. Duplicate table/curve errors name their package
copy and explain aligning dependency versions/ranges. A true copied-module
regression exercises those errors.

H1 reads the unfurled source files that Deno uploads to the existing local
registry. It checks caret internal specifiers, exact reviewed use.gpu/Mol* pins,
absence of bare specifiers, and Mol*'s IO-only dynamic runtime wall. Type-only
Mol* references inside IO remain valid. Fabricated npm fields and dead npm
packing checks are removed. The public registry is never used for publication.
Injected bare imports, exact internal ranges, loose use.gpu/Mol* versions and
static/runtime foreign-package Mol* imports fail the focused guard tests.

CI decision: do not add the exploratory `test/spikes/jsr-consumer/run.ts` report
runner wholesale. It intentionally measures unsupported Deno viewer linking and
divergent use.gpu, and reports findings without failing on every unexpected
result. Existing CI `check:hardening` now captures the actual upload; the
standard pure test task includes `test/hardening/*.test.ts` for strict
dependency and copied-module regressions. Run the full isolated-consumer runner
on package/API changes as additional evidence; a standalone consumer CI gate
remains final-gate work rather than treating a report as an assertion suite.

## Reload and cancellation

The new browser regression failed on the original source: while the second
trajectory opened, descendants still saw the first trajectory's metadata.
Inspection of installed use.gpu 0.20.0 `useAwait` also found that a cancelled
promise clears its shared loading flag, even while a successor is pending.

A small internal request hook owns pending/results/errors with an
AbortController per dependency tuple. It uses pinned Live resource cleanup and
state hooks; replacement/unmount aborts the request and suppresses late
results/errors. This is confined to source/first-frame requests, not a
replacement for GPU scheduling. Structure/Volume/Trajectory loaders receive an
optional third signal argument; existing two-argument loaders remain compatible.
Data/source transitions are request dependencies. Superpose first-frame reads
take the signal. Frame errors are attached to the player that produced them.

IO forwards signals through fetch and header scans, checks cached and custom
ByteSource reads around awaits, and observes cooperative Mol* parser/model task
abort. Synchronous lowering and custom loaders ignoring signals cannot be
preempted; stale publication suppression remains separate from stopping work.

Range responses must match exact offsets, total and body length. Strong ETags
use If-Match, else Last-Modified uses If-Unmodified-Since, with matching
response validators required. Without validators callers must use immutable
URLs: size checks cannot detect same-size changes. A 200 fallback still
downloads once under its cap; bytes/Blob/custom sources retain the same scan
interface.

## Validation

- Pure suite: 464 passed; subsequently added copied-module diagnostic regression
  and published renderer-wall regression passed separately.
- Hardening H1-H6: all eight packages passed with actual local-upload
  inspection.
- JSR dry run passed; public API snapshots reviewed for optional loader signals,
  whole-file signal/fetch options and trajectory fetch options.
- Component type checking, source/test type checking, repository formatting and
  lint passed.
- Trajectory reload matrix and existing trajectory suite passed; Structure and
  Volume browser suites passed, including uncaptured GPU error checks.
- Isolated consumer runner without browser: all public entries and real JSX
  scene type-check, scene bundles, compatible copies deduplicate, divergent
  identities reject with the updated diagnostics. Direct Deno viewer linking
  remains the documented upstream CommonJS limitation.

Existing browser build warnings about @std/path config resolution and the core
interpolation ESM fallback remain. No full GPU gate is claimed.
