# Architecture review: molecular values composed through Live JSX

Review date: 2026-09-17. This is a proposed implementation contract, grounded in
this checkout's spikes and the 66 existing beads; it is not a claim that the
library, benchmarks, or phase gates are complete. Where earlier design notes
conflict, use the refinements below for the next implementation slice.

## Keep the public abstraction small

Use Live JSX directly: Structure provides a molecular dataset, representations
consume it, and hooks create/retrieve selections and fields. Do not create one
component per atom/bond, another scene graph, a custom JSX runtime, or a generic
renderer backend. BallAndStick composing Spacefill and Bonds is the right shape.
Components own resource lifetimes and orchestration; pure functions own molecular
calculation. Context is an adapter concern, not part of the table schema.

The existing code is native Live `use(...)` in .mjs, so JSX ergonomics are still
unproven. Add one actual TSX consumer early. Live and React JSX have distinct
runtimes; configure the pinned Live factory explicitly and keep any React host
bridge separate. See the upstream [Live guide](https://usegpu.live/docs/guides-live-vs-react).

Illustrative target (new APIs below are proposals):

```tsx
import React from '@use-gpu/live';

const ProteinView = () => {
  const site = useSelection(residues({ chain: 'A', authSeq: [42, 43] }));
  return <>
    <Spacefill select={site} color={byElement} />
    <BallAndStick select={site} color={byElement} />
    <Focus on={site} />
  </>;

// Fits inside an existing use.gpu scene; Molecule may supply convenient defaults.
const Scene = () => <Structure data={dataset}><ProteinView /></Structure>;
```

`useSelection` runs in a descendant component, after Structure provides context.
Offer mutually exclusive `data` and `src` inputs. `src` delegates to a loader with
loading/error state, cancellation, and stale-result protection. Keep fetch and
parse out of representation bodies. A supplied dataset must work without Mol*.

## A dataset, with explicit domains

Retain columnar arrays, but define a StructureData containing atom, residue,
chain, bond, and instance domains plus positions. Row count means logical rows,
not scalar array length: an atom vec3 column has 3N CPU scalars. Preserve original
Angstrom coordinates. Keep CPU packed layout distinct from GPU padded layout.

Retain atom-to-residue and residue-to-chain indices; model identity; author and
label identifiers; insertion code; altloc/occupancy; bond endpoints/order/source;
and assembly instance transforms. Do not identify residues by sequence number
alone or flatten assembly instances into duplicated chemical identities. Define
an explicit default model/altloc policy. Future trajectory playback stays out of
scope, but positions have their own revision from topology.

Colors are presentation fields, not required chemical columns. Default radii
are physical metadata; display scale is styling. Topology is shared per dataset:
prefer imported connectivity, then a documented inference fallback with spatial
indexing and element/altloc/model rules. A uniform 1.9A all-pairs cutoff is a spike,
not a scientific bond model.

## Separate queries from resolved selections

A reusable SelectionQuery is independent of a structure. A resolved Selection
contains dataset identity, domain, dependency revisions, sorted unique in-range
indices, and an implementation-owned identity. Caller-provided strings are labels,
not cache keys. Set operations reject mismatched datasets/domains/revisions.
Structural queries depend on topology/attributes; `within` also depends on positions.

Make conversions explicit: residues to atoms, atoms to bonds (both/either endpoint),
and residues to trace samples. Every gathered/expanded representation retains a
mapping back to source identity for picking and field lookup. Empty selections
render nothing and have an explicit empty-bounds result. Focus across structures
uses an explicit structure handle plus query; nearest context handles the ordinary
case. Do not add a global registry before a cross-structure use case needs it.

## Invalidation is the central contract

Cache by dataset identity, relevant revisions, resolved selection identity, and
geometry parameters. `(selection, geometry params)` alone omits source data.
Treat typed arrays as immutable between revisions; document and validate updates.

| Change | Work permitted |
|---|---|
| Color/opacity/clock uniform | Update style bindings; no geometry or position upload |
| Selection membership | Rebuild mapping and gather affected columns if needed |
| Coordinates | Update positions/bounds and coordinate-dependent selections/geometry |
| Connectivity/model/altloc policy | Rebuild affected topology and downstream derivations |
| Surface probe radius/resolution | Recompute surface field/mesh |
| Tube display radius | Shader style update when the backend supports it |
| CPU ribbon profile/width baked into vertices | Geometry rebuild; classify as a geometry parameter |

Count topology builds, geometry builds, gathers, allocations, upload bytes, and
binding updates separately. A component re-evaluation is not a geometry rebuild.
An impostor path with no CPU geometry is not sufficient alone to prove the invariant.

The current Spacefill gathers positions, colors, and sizes together on `scale`,
and ignores Structure's uploaded sources. That duplicates storage and makes a
style edit copy coordinates. Share raw columns and selection mappings within the
Structure resource scope; split geometry from style derivations. Release resources
on scope disposal and bound any multi-selection cache. Correct gather remains the
baseline on 0.20.0; indirect access is an optimization, not a correctness gate.

## Package boundaries without a framework project

Keep the planned logical modules; implement only those needed by the next gate.
No new generic graph/compiler/service packages are needed.

- table: pure domain schemas, identities, validation, and topology/trace values.
- io: only production runtime Mol* import boundary; lower to owned plain data.
- select: pure queries, resolution, domain conversions, set operations.
- fields: typed field descriptions and pure CPU evaluation for tests/labels/joins.
  Numeric/vector fields lower to GPU bindings inside viewer. Strings and tooltip
  formatting are CPU work; do not promise arbitrary JS/string compilation to WGSL.
- geo: pure kernels and attributed ports; no runtime Mol* imports. Preserve licenses
  and pinned source provenance. Mol* dev-only oracle imports are allowed in tests.
- timeline: pure `sample(curve, t)` contract. Reuse verified pure upstream interpolation
  helpers behind a private adapter; no workbench component dependency in the core.
- viewer: Live components, providers, field lowering, and a small internal use.gpu
  adapter for column packing, lengths, source versions, units, and empty draws.
  Use.gpu sources may be exposed through an explicitly advanced viewer API only.

The alternative of allowing Mol* runtime imports from geo would be a deliberate
change to the import-wall decision, not an incidental deep import during a port.
Test the chosen wall. Likewise, the old fields/timeline dependencies need explicit
containment, rather than claiming all use.gpu dependencies already live in viewer.

## Adapter tests before more representations

The RawData/useRawSource mismatch is an observed failure, not a proven segment
shader defect. Installed code shows RawData repacks through CPU/GPU dimensions
and emits a reconciler signal; useRawSource uploads `array.buffer` directly.
Audit vec3 padding, typed-array byte offsets, length semantics, versions, and
reconciliation as well as segments before assigning root cause. No browser rerun
was performed during this review. Keep the working component path meanwhile.

Test three isolated strokes, multiple trace runs, vec3 attributes with distinct
values, empty inputs, and updates after first render. Derive world-size semantics
for points AND tubes across FOV, viewport, DPR, and projection type. Existing
empirical width clamps and the factor 296 must not become public units.

## Representation sequencing and correctness

Build segmented trace values first (chain/model breaks, missing residues, altloc
policy, protein and nucleic guides, stable frames, sample-to-residue mapping).
Spline each run independently. Then tube/worm, then CPU ribbon/arrow extrusion.
Share traversal between them. The current CA-only trace concatenates all retained
residues; it is a shape proof, not the general traversal implementation.

Surface uses the validated scalar-field lift plus a licensed marching-cubes port
and FaceLayer. Keep DualContourLayer optional until its regressions pass. Schedule
expensive surface work off the UI thread with cancellation, request revisions,
memory limits, and stale-result rejection; style edits must not restart the job.

Use exact/tolerant array goldens only for equivalent ported kernels with stable
ordering. For independent traces or different tessellations compare molecular
identity, run boundaries, bounds, finite normals, and sampled geometry within a
stated tolerance. Pin corpus bytes/checksums and import policies, not only PDB IDs.
Add browser images and WebGPU validation checks for rendering. Do not treat visual
similarity as chemical correctness or infer that every Mol* output can be compared
by vertex index.

## Execution order

Finish S1 timings and S2's measured invalidation experiment; S3 reuse passed but
its initial renderer failed. Preserve this split result rather than marking Gate 0
passed. S4 must inform the importer before its production implementation.

Then land domain contracts and adapter probes, a real TSX static slice with corpus
checks, fields/selections with a shared gather fallback, and a scrubbed timeline.
Do not wait for ribbon/surface breadth to demonstrate the thesis. Gate 2 can use
Spacefill, Bonds, and BallAndStick to check selection agreement across component
consumers (two primitive render paths); it need not wait for Phase 4. The stronger
no-extra-upload optimization is tracked separately from no-geometry-rebuild.

Existing beads are refined in place with acceptance criteria and dependency edges.
Implementation remains future work, suitable for bounded agent assignments once
their prerequisites are satisfied.

## Bead handoff

Updated 43 existing beads (including prerequisite changes); added `molgpu-sept-0sj.7` for cancellable geometry jobs. Added 40 concrete blocking edges. Existing phase ordering remains; the Phase 0 acceptance text distinguishes gate evidence from optional follow-ups.

Primary implementation contracts:

- `molgpu-sept-jy6.1`: @molgpu/table: columnar atom table schema and buffers
- `molgpu-sept-jy6.8`: Build and verify internal GPU source adapter: packing, versions, structural sources
- `molgpu-sept-jy6.7`: Implement Structure resource ownership, revision invalidation and selection caching
- `molgpu-sept-jy6.3`: @molgpu/viewer: <Molecule>, <Structure>, <Spacefill>
- `molgpu-sept-urn.1`: @molgpu/select: selection compiler to sorted index buffers
- `molgpu-sept-urn.2`: @molgpu/fields: field abstraction and WGSL codegen
- `molgpu-sept-urn.5`: useField: compose derived style fields shader-side instead of re-uploading
- `molgpu-sept-jy6.10`: Bond topology provider instead of per-representation inferBonds
- `molgpu-sept-0sj.4`: Residue-level trace table for cartoon
- `molgpu-sept-0sj.7`: Schedule expensive geometry jobs with cancellation and bounded memory

Use `BD_ROUTING_MODE=maintainer bd ready` for the local project backlog. The override is per command; global routing was not changed. Reference orientation bead `molgpu-sept-634` is now deferred rather than a task to close each time it is read.
