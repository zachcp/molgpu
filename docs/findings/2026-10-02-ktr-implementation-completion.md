# Second-pass implementation completion

Tracking: `molgpu-sept-ktr`. All four review tasks and the 14 implementation
follow-ups (`ktr.5`–`ktr.18`) are complete. Each implementation issue has its
own commit; unrelated working-tree edits were excluded.

| Issue    | Result                                                              | Commit      |
| -------- | ------------------------------------------------------------------- | ----------- |
| `ktr.5`  | Owned pending/failed trajectory references and Superpose recovery   | `001bef2`   |
| `ktr.6`  | Owner-checked metadata reader moved out of playback                 | `1e5f40b`   |
| `ktr.7`  | Export rules reconciled with useful shared types and inline props   | `b8fd253`   |
| `ktr.8`  | Shared private native dispatch observation                          | `f341a3b`   |
| `ktr.9`  | Identity wrappers removed; independent gather oracle moved to tests | `2959677`   |
| `ktr.10` | Original guide rows validated before integer packing                | `7a5289f`   |
| `ktr.11` | Public surface input and sample-budget preflight                    | `dbe23c1`   |
| `ktr.12` | Download ceilings validated before transport                        | `73ded24`   |
| `ktr.13` | Unused timeline sample copy removed                                 | `a4faaea`   |
| `ktr.14` | Normal-mode constructor owns vectors and mapping                    | `e73ff4b`   |
| `ktr.15` | CPU/WGSL linear wrap endpoint parity                                | `d6a7286`   |
| `ktr.16` | Finite field inputs and valid f32 literals                          | `3db69ac`   |
| `ktr.17` | Spacing and affine marching-cubes normal/winding parity             | `fa1e3bd`   |
| `ktr.18` | Bounded pure-package layout cleanup                                 | This commit |

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
