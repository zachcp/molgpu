# Public export coverage audit (molgpu-sept-s5o.11)

Date: 2026-10-04. Base: main c429c1c. Deno 2.9.7, Chrome 154, run locally on a
Mac.

## Method

Executable coverage per public export, not name searches:

- **Unit**: `deno test -A --coverage` over `packages/*/test/*.test.ts`,
  `test/selection` and `test/hardening` (all passing), exported as lcov.
- **Browser**: every Playwright suite run with
  `--preload scripts/browser-coverage-hook.mjs` and
  `MOLGPU_BROWSER_COVERAGE=<dir>`. The hook wraps `chromium.launch`, records V8
  precise JS coverage per page and keeps workspace-source entries. All 25 suites
  passed (`run-jsr-consumer.mjs` excluded: it needs published tarballs).
- **Report**:
  `deno run -A scripts/browser-coverage-report.mjs <dir> --lcov
  <unit.lcov> [--json f] [--md f]`
  resolves exports with `deno doc --json`, maps V8 block coverage back through
  inline source maps, and prints per export the lines executed by browser pages,
  by unit tests, and whether any browser page names it. 209 export rows (12 are
  load-time constants or shader strings).

Bundled fixtures (trajectory, efield, elastic, volume, ses-field, gpu-dssp,
tsx/components) are Vite builds, not served modules. Their Vite configs now wrap
`build` in `coverageBuild()` (`scripts/workspace-aliases.mjs`), which only when
`MOLGPU_BROWSER_COVERAGE` is set emits inline source maps with absolute
`sources`. Without it, builds are unchanged. Before this the report saw no
coverage at all from those suites and wrongly showed `UnitCell`, `FieldArrows`
and `NormalMode` at 0%.

## Result

Of 197 scorable exports, 158 run in a browser page, 144 under unit tests and 191
under either. Six run under neither:

| Export                                                       | Verdict                                                                                                                                                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewer/advanced` `useCoordinateSelection`                   | **Real gap.** Documented in the viewer README (position-dependent `within` queries against a published snapshot) but no browser page or unit test names it; only module load runs (5/17 lines). |
| `viewer` `projectToPointer`                                  | Unit-tested (5/5), never named by a browser page. Pure math; low risk.                                                                                                                          |
| `dynamics/wgsl` `SUPERPOSE_FIT_BYTES`, `UNWRAP_PARAMS_BYTES` | Constants; the report cannot score a declaration with no body. Their consumers (`Superpose`, `Unwrap`) run at 71% and 99%.                                                                      |
| `select` `supportedSymbols`, `table` `MAX_VOLUME_SAMPLES`    | Constants, same reason.                                                                                                                                                                         |
| `timeline` `createCurve`                                     | Report artefact (overloaded declaration, no span); `timeline.test.ts` exercises it.                                                                                                             |

Composed viewer components are well covered in browsers (e.g. `Trajectory` 91%,
`Unwrap` 99%, `Surface` 99%, `Spacefill` 100%, `Volume` 82%, `NormalMode` 90%).
Lines below ~75% in browsers are error and option paths: `Superpose` (71%),
`NormalMode` (63% of the export, 90% of the file), `TimelineProvider` and the
`use*` context hooks (67%: the hook's no-provider throw). Dynamics CPU kernels
(`gasteigerCharges`, `langevinStep`, `solveElasticModes`, `minimumImage`) show
0% in browsers by design: their oracles are unit tests.

## Decision

Keep V8 coverage as an opt-in report, not a CI gate: percentages cannot tell an
unsupported composition from an untested line, and a full run is about 15
minutes locally. Re-run the audit by hand before a release. The one actionable
gap is a smoke test for `useCoordinateSelection` (a composed behaviour, so a
browser or component test, not a unit test). Existing scientific and lifetime
oracles are unchanged.

## Reproduce

```bash
deno test -A --coverage=/tmp/unitcov packages/*/test/*.test.ts test/selection/*.test.ts test/hardening/*.test.ts
deno coverage /tmp/unitcov --lcov --output=/tmp/unit.lcov
MOLGPU_BROWSER_COVERAGE=/tmp/browsercov deno test -A --preload scripts/browser-coverage-hook.mjs packages/viewer/test/run-trajectory.mjs  # repeat per suite
deno run -A scripts/browser-coverage-report.mjs /tmp/browsercov --lcov /tmp/unit.lcov --md /tmp/report.md
```

Browser suites rewrite `docs/findings/evidence/*.json` as a side effect; discard
those changes.
