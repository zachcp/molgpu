# Public Export Audit

Date: 2026-10-05. `molgpu-sept-9es.4`, decision only. Baseline: branch
`cleanup/9es` after the 9es.3/9es.10 private pruning, with every package's
`api.txt` unchanged from origin/main `8bf1005`.

## Question

Which public JSR exports have no caller outside their own package (another
package's `src` or `site/src`), and should any be deprecated? Missing workspace
callers do not show that an API is unused: these are libraries whose consumers
live outside the repository.

## Method

For each symbol listed in `packages/*/api.txt`, the audit recorded its kind
(from the snapshot signature), whether another package or the site references
it, the number of test files that reference it, and whether the package README
documents it. The scan is a word-boundary text match, so it can over-count
references, never under-count them.

## Results

154 of 358 public symbols have no caller outside their own package:

| Package  | Types | Values | Values with tests | Documented in README |
| -------- | ----: | -----: | ----------------: | -------------------: |
| dynamics |    23 |     14 |                13 |                  all |
| fields   |     3 |      7 |                 7 |                  all |
| geo      |     3 |      0 |                 — |                  all |
| io       |    10 |      2 |                 2 |                  all |
| select   |     0 |      9 |                 9 |                  all |
| table    |     5 |      1 |                 1 |                  all |
| timeline |     5 |      1 |                 1 |                  all |
| viewer   |    50 |     21 |                21 |                  all |

- **Types (99).** These name props, options, results and statuses of public
  functions and components. They are retained: removing them would leave public
  signatures referencing names consumers cannot import.
- **Values (55).** Every value is documented in its package README's API table.
  They are end-user components (`Superpose`, `Transform`, `Unwrap`, `UnitCell`,
  `FieldArrows`, `GpuDssp`, `Label`), advanced hooks (`useCoordinateBounds`,
  `useAttributeSnapshot`, `useField`, ...), selection and field builders, and
  scientific functions (`solveElasticModes`, `gasteigerCharges`, `langevinStep`,
  ...). Applications rather than sibling packages are their intended callers.
- **Untested value (1).** `@molgpu/dynamics/wgsl` `COULOMB_MODEL_CODE` maps
  dielectric model names to uniform codes and is used internally by
  `coulombParams`. It is a documented extension constant and is retained.

## Decision

Retain all ten public entries and every listed symbol. No deprecation is
proposed: no symbol is undocumented, and no evidence shows any symbol is
unsupported or misleading. Revisit only with a concrete consumer case (for
example, an API whose behavior cannot be supported or that duplicates a better
entry), following the hardening, `api.txt` review and `jsr:check` procedure.
