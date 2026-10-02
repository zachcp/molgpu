# Architecture gate: public composition and package independence

Date: 2026-10-02. Bead: `molgpu-sept-crj.13` (final gate of `molgpu-sept-crj`).
Base: `main` at `f4884a6`, plus the native compute audit (`molgpu-sept-s5o.7`,
PR #77) and this gate's consumer suite.

## Required blockers

All 26 dependencies of the gate are closed or closing:

- **The architecture decisions and repairs** (crj.1–crj.12, crj.14–crj.17,
  crj.20–crj.24, crj.26) and **19s** (Gate 2).
- **The source and loading work:** s5o.1, s5o.2, s5o.3, s5o.18.
- **The native compute audit, s5o.7**
  ([audit](2026-10-02-native-compute-audit.md)).

The decision spikes' required follow-ups are merged:

- crj.9 → crj.20/21/22/23;
- crj.10 → crj.24;
- crj.8 → crj.26.

## Isolated-consumer gate (new)

`packages/viewer/test/run-jsr-consumer.mjs` (`deno task gate:consumer`) turns
the crj.11 exploratory runner into assertions. It runs in CI's viewer WebGPU
group.

**Setup.** Each package's real publish tarball is uploaded to a local stand-in
registry; nothing is sent to jsr.io. A consumer in the OS temp directory,
outside the workspace and without aliases, resolves `jsr:@molgpu/*` from those
tarballs.

**Assertions:**

- **Entries:** all ten public entries type-check from their published form. io,
  table, geo, select, fields and dynamics have no static npm dependencies; Mol*
  stays behind `import()`.
- **JSX scene:** a scene written only against public entries type-checks,
  bundles with code splitting and draws in WebGPU Chrome.
  - The preloaded scene draws and fetches no Mol* chunk.
  - The BCIF scene draws, loads Mol* lazily, and reports no load failure or
    browser error. The scene now passes `<Structure error>` into its error list,
    so a failed load can no longer show up as a silent blank canvas.
- **Copies:**
  - Compatible copies of `table` and `timeline` deduplicate to one module, and
    every cross-package case succeeds.
  - Divergent copies fail only with the documented "another copy of
    @molgpu/table|timeline" identity errors.
- **Documented limitations,** asserted so that any change in them fails:
  - the viewer loads only through a bundler, not by a direct Deno import
    (use.gpu's CommonJS `main`);
  - a consumer on use.gpu 0.19 does not type-check (the exact 0.20.0 pin).

**Regression it would have caught.** The first full run of this gate's evidence
found a real one. After fch.1 (#68), the bundled BCIF scene drew 0 pixels:
separate dynamic Mol* imports broke `mmcif.js`'s initialisation order in
code-split bundles. #76 fixed it and added an io bundle test. With #76's fix
reverted, the new suite fails with "Structure load failed: IoError: Unable to
build the Mol* mmCIF model". With the fix, it passes in about 22 s locally.

## Acceptance evidence

`main` with #77 applied, Apple silicon Chrome. CI runs the same suites with
SwiftShader.

| Acceptance item                                   | Evidence                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full unit suite green                             | `deno task test`: 508 passed (439 was the historical baseline)                                                                                                                                                                                   |
| Static and published-form checks                  | `fmt`, `lint`, `typecheck`, `typecheck:components`, `typecheck:site`, `check:hardening`, `jsr:check` (dry run)                                                                                                                                   |
| Published-equivalent consumers compile and render | `run-jsr-consumer` (above)                                                                                                                                                                                                                       |
| Actual Live JSX compiles and renders              | `typecheck:components`, `run-components`, `run-selection`, `run-trajectory`, `run-volume`, `run-efield` (Vite-built JSX consumers), `site/test/run-browser.mjs`                                                                                  |
| Nested and sibling sources                        | `run-components` (sibling isolation), `run-selection` (nested structure sources stay isolated)                                                                                                                                                   |
| Model/altloc                                      | `activeAtoms` model/altloc tests in `packages/table/test/table.test.ts` (crj.4 policy); `selection-resolution.test.ts`; `run-invalidation` (altloc rows)                                                                                         |
| Coordinate, attribute and volume composition      | `run-components` (provider chains), `run-trajectory`, `run-efield` (provider and trajectory, no CPU round trip), `run-volume`, `run-surface` (live GPU surface), `run-gpu-dssp`                                                                  |
| Reload and cancellation                           | `run-components` (replaced and unmounted sources), `run-trajectory` (`src` over HTTP Range), io cancellation and Range tests (`packages/io/test/transport.test.ts`, `trajectory.test.ts`; crj.12), `run-surface` (generation burst, latest wins) |
| Held compilation                                  | `run-retirement` (held draws and held compute: crj.7 attribute/coordinate cases)                                                                                                                                                                 |
| Buffer replacement, resize and unmount            | `run-retirement` (passes, same-size, in-flight DSSP, readbacks, status, coordinate and field memory churn), `run-readback-identity`, `run-surface`, `run-trajectory` (unmount releases every buffer)                                             |
| Gate 2 under first-demand column upload           | `run-gate2` passes and runs in CI (19s)                                                                                                                                                                                                          |
| Retention bounds and native-memory limits         | crj.15 evidence (`docs/findings/evidence/2026-10-01-*retirement*.json`), reproduced by `run-retirement`                                                                                                                                          |
| Preserved crj.2/3/6 regressions                   | Their unit and browser regressions remain in `deno task test` and `run-invalidation`                                                                                                                                                             |
| No publication or deployment as validation        | The local registry only; `jsr:check` is a dry run                                                                                                                                                                                                |

## Deferrals

Each deferral below has its supported claim narrowed:

- **s5o.22** (P3, non-blocking): an ordered native-kernel experiment for
  Superpose/Unwrap. Both paths stay raw with their reason recorded.
- **Direct Deno import of `@molgpu/viewer`:** unsupported. The viewer is
  browser-only and must be bundled. This is asserted by the consumer gate and
  documented by crj.11.
- **Consumers on another use.gpu version:** unsupported (exact pin), asserted.
- **s5o.21** (CI Playwright install retry): needs a token with `workflow` scope.
  It is CI hygiene, not an architecture claim.
