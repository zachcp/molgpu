# Assembly instance semantics decision

Date: 2026-10-01. Baseline: `4dd3e0e`, use.gpu `0.20.0`, Deno `2.9.7`. Spike:
`molgpu-sept-crj.8`. Production code and exports are unchanged. Executable
acceptance: `packages/viewer/test/assembly-instances.test.ts`; its ignored case
is owned by `molgpu-sept-crj.26`.

## Decision

**molgpu draws the asymmetric unit.** Biological assemblies are not supported
today, and support claims are narrowed to say so. A rendering prototype is not
warranted now. No importer produces non-identity operators, and drawing copies
would need per-instance matrices in every representation, picking and labels.
That work is deferred to `molgpu-sept-fch` under the policy below.

Today's contract:

- `topology.instances` stays a validated, renderer-free data contract in
  `table`: one row per (chain, column-major affine operator), with atoms never
  duplicated. `io` emits one identity row per chain for BCIF and PQR.
- No representation, selection, label or picking path consumes `instances`.
  Everything drawn is the deposited rows (default view: first model, primary
  conformers) in model space.
- Camera framing must cover exactly what is drawn. Today it expands bounds
  through instance transforms, so it frames copies that are never drawn
  (`crj.26` removes that until assemblies render).
- `PickResult.instance` is the GPU draw-instance index (`pick-resolve.ts`), not
  an assembly instance. Its docs say so; whether to rename it before first
  publish belongs to `s5o.14`.

## Policy for future assembly rendering (`fch`)

| Concern         | Rule                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy          | Asymmetric unit by default. An explicit assembly id opts in; it never changes silently with the file.                                             |
| Parser          | `io` lowers `pdbx_struct_assembly`/`_gen`/`oper_list` (operator expressions composed as Mol* does) into `Instances` rows; `table` only validates. |
| Transform order | Upstream positions → coordinate providers (Trajectory, Transform, Superpose, Unwrap) in model space → instance operator at draw → scene camera.   |
| Snapshots       | Coordinate and attribute snapshots stay in model space and one copy; operators never feed back into providers or selection inputs.                |
| Chain filtering | Only chains with rows are drawn, per row. An empty table means no explicit instances: draw the deposited rows once.                               |
| Bounds          | Framing and bounds cover each drawn copy (per-chain operators, not every operator over the whole selection).                                      |
| Labels          | One label per drawn copy, positioned with that copy's operator.                                                                                   |
| Selection       | Membership stays in topology rows; an operator filter, if added, is a separate dimension and not new atom rows.                                   |
| Pick identity   | A pick returns the atom row and the instance row (with `operatorId`), so two copies of one atom are distinguishable.                              |
| Never           | Flatten copies into duplicate topology rows, or merge operators into positions.                                                                   |

## Evidence from current source

- `io/src/bcif.ts:483` and `io/src/pqr.ts:282` emit `count = chainCount`,
  `chain[i] = i`, `operatorId = "identity"` and identity matrices. No assembly
  category is read. The acceptance test pins this for `1crn` and `4c7r`.
- `table/src/structure.ts:238-247` validates chain references, operator ids,
  finite values and affine shape. The acceptance test builds a hand-built
  two-copy structure (identity plus +100 Å) and rejects a projective matrix.
- Representations and selection: `grep instances` over `viewer/src`, `select`,
  `fields` and `dynamics` finds no consumer besides framing.
- Framing is inconsistent with drawing and with itself:
  - `camera-curve.ts` `displayBounds` applies each operator to its own chain.
    `camera-curve.test.ts` asserts that a +10 Å copy widens the bounds to
    `max = 13`, though nothing draws that copy.
  - `use-coordinate-focus.ts` applies every operator to the whole selection's
    bounds and ignores `instances.chain`.
  - The ignored acceptance case fails today: two-copy framing differs from
    identity-only framing.
- `table/README.md` describes instances as assembly rows, and `viewer/README.md`
  says `useCoordinateFocus()` applies "assembly padding". Both imply support
  that drawing does not provide.

## Alternatives considered

- **Bounded two-copy rendering prototype now.** Would prove the matrices, but
  every representation (Spacefill, BallAndStick, Bonds, Ribbon, Tube, Surface,
  labels) and picking would need instanced variants. Without an importer
  producing operators, it would only render hand-built data. Deferred to `fch`.
- **Flatten an assembly into duplicate topology rows at import.** Simple to
  render, but it breaks atom identity, selections, trajectories (atom counts)
  and coordinate providers. Rejected permanently.
- **Keep instance-aware framing as preparation.** It frames empty space today,
  and the two framing paths disagree. Rejected until drawing catches up.
- **Remove `instances` from the table schema.** That would churn a validated,
  harmless contract that the future work needs. Rejected.

## Follow-ups

- `molgpu-sept-crj.26` (P2, blocks crj.13): drop instance expansion from both
  framing paths, update `camera-curve.test.ts` and the README claims, and
  un-ignore the acceptance case.
- `molgpu-sept-fch` (P4, deferred feature): render biological assemblies with
  atom+operator picking under the policy above.
- `s5o.14` note: consider renaming `PickResult.instance` before first publish.
