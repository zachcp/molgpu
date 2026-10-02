# Second-pass implementation completion

Tracking: `molgpu-sept-ktr`. All four review tasks and the 14 implementation
follow-ups (`ktr.5`–`ktr.18`) are complete. Each implementation issue has its
own commit; unrelated working-tree edits were excluded.

| Issue    | Result                                                              | Commit    |
| -------- | ------------------------------------------------------------------- | --------- |
| `ktr.5`  | Owned pending/failed trajectory references and Superpose recovery   | `0790d30` |
| `ktr.6`  | Owner-checked metadata reader moved out of playback                 | `eab8e25` |
| `ktr.7`  | Export rules reconciled with useful shared types and inline props   | `6ce9571` |
| `ktr.8`  | Shared private native dispatch observation                          | `e5ca497` |
| `ktr.9`  | Identity wrappers removed; independent gather oracle moved to tests | `6e59ee4` |
| `ktr.10` | Original guide rows validated before integer packing                | `c60d6cc` |
| `ktr.11` | Public surface input and sample-budget preflight                    | `0277617` |
| `ktr.12` | Download ceilings validated before transport                        | `299b6be` |
| `ktr.13` | Unused timeline sample copy removed                                 | `22408dc` |
| `ktr.14` | Normal-mode constructor owns vectors and mapping                    | `512438b` |
| `ktr.15` | CPU/WGSL linear wrap endpoint parity                                | `0f65df1` |
| `ktr.16` | Finite field inputs and valid f32 literals                          | `c19248c` |
| `ktr.17` | Spacing and affine marching-cubes normal/winding parity             | `9725130` |
| `ktr.18` | Bounded pure-package layout cleanup                                 | `587d077` |

The final layout change removes table's unused compatibility type barrel, leaves
select's public entry as explicit exports with selection implementation and
revision state in `selection.ts`, and separates fields into construction, CPU
evaluation and WGSL lowering. Function bodies, singleton value types, volume
identities and public exports are preserved. Private cross-module helpers remain
outside the published entry API. No runtime dependency, package or public
subpath was added.

Validation is recorded in each issue's close reason. Final layout checks: 162
table/select/fields tests, 39 field browser parity cases, public JSX checking,
scoped formatting/lint, all three affected packages' H1–H6 checks with unchanged
API snapshots, and the whole-workspace JSR dry run passed. Before the final
mechanical move, all eight packages passed hardening, and the dispatch change
passed trajectory, electric-field, invalidation and all 11 retirement subruns
(84 passing browser tests; 28 inapplicable cases ignored). Retirement output is
retained at `/tmp/molgpu-ktr8-evidence`; the existing evidence edits were
restored.

This is scoped acceptance, not a clean full GPU-gate claim. The known gate2
failure remains tracked separately by `molgpu-sept-19s`. The reference decisions
and other architecture epics remain independently tracked; no publication or
deployment was performed.

PR #83's first full CI run (`37070874403`) passed every browser suite except
elastic, including gate2. Elastic's 4C7R stability case advanced to step 55,000
before its two-minute deadline; the suite later hit the shared 15-minute process
limit after both RMSF oracles passed. `molgpu-sept-ahc.13` gives the
100,000-step cases a ten-minute deadline and elastic a 30-minute suite budget on
software GPUs. Scientific steps, samples, tolerances and retirement assertions
are unchanged. The complete local elastic suite passed all 15 steps, including
re-thermalisation and replacement/unmount, in 96 seconds. Scoped formatting,
lint, component type checking, shell syntax and suite partition checks passed.
