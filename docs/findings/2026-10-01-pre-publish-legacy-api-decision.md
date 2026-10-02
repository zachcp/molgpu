# Pre-publish legacy API decision

Date: 2026-10-01. Baseline: `2fdd777`. Bead: `molgpu-sept-s5o.14`.

## Decision

Every package is at `0.1.0` and has only been published as a dry run, so there
are no consumers to migrate. Remove deprecated paths outright instead of
shipping them with a removal version. Fix misleading public names now, while a
rename costs nothing.

| Item                                                        | Decision                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Atoms.formalCharge`, `Residues.secondaryStructure` columns | Removed, with their validation, built-in attribute views and `legacySsCodes`. `@molgpu/io` already writes the `formalCharge`/`ssCode` attributes; hand-built structures use `withAttributes`.                                      |
| Attribute provenance `"legacy"`                             | Renamed `"topology"`. Once the deprecated columns are gone, it only marks built-in views of topology columns (bfactor, occupancy, element, …).                                                                                     |
| `StructureSources.positions`                                | Kept and no longer deprecated. It is the root dataset's source, which internal adapters need for root identity. Below a coordinate provider it already throws in development, so it cannot silently stand in for live coordinates. |
| `PickHit.instance`                                          | Renamed `drawIndex`: the drawn primitive's index in its layer. "Instance" stays free for assembly instances (`molgpu-sept-fch`).                                                                                                   |
| Tracker IDs and phase numbers in published source           | Removed; `test/hardening/published-source-references.test.ts` keeps them out.                                                                                                                                                      |

Test fixtures that built the removed columns now set the same values through
`withAttributes` with `user` provenance. The assertions are unchanged: Mol* DSSP
parity, MolQL secondary-structure flags and formal-charge queries.
