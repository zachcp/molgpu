# Contributor Guide

## Start Here

This is a TypeScript molecular visualization library built on use.gpu, organized
as eight Deno workspace packages targeting JSR. The application owns its canvas,
device, camera, lights and render passes. Molecular components compose beneath
them.

Read the root README, the relevant package README and its `deno.json`, then
[the current architecture guide](docs/ARCHITECTURE.md). The
[September 28 review](docs/findings/2026-09-28-stack-architecture-review.md)
records the original findings; consult completion notes before treating them as
open. `docs/DESIGN.md` records intent; dated findings and Beads record evidence
and open work. Historical phase gates do not prove every composition works
today. `docs/HARDENING.md` defines the Deno/JSR checks. Use actual Deno
manifests; do not introduce package.json files to satisfy historical npm-era
findings.

## Work Tracking

Use `BD_ROUTING_MODE=maintainer bd ...` for this repository, as directed by the
orientation bead `molgpu-sept-634`; verify the `molgpu-sept-` issue prefix. Do
not change global routing. Inspect the relevant issue, dependencies and current
source before starting. Reuse existing issues; do not duplicate or close another
contributor's work based only on stale descriptions. Reference decisions remain
references. The completed architecture epics are `molgpu-sept-crj` and
`molgpu-sept-ktr`. The post-overhaul review and its open follow-ups are
`molgpu-sept-0vs`.

Respect the requested scope: review/planning tasks produce evidence and bounded
issues, not unsolicited implementation. For architectural uncertainty, a spike
should end with a decision, alternatives, an executable acceptance example and
small follow-ups. Routine fixes do not require a new design process.

## Package Boundaries

- `table`: renderer-free data contracts, validation, identity/revisions and
  molecular table operations. Typed arrays are read-only by contract.
- `io`: transport, format decoding and the only production Mol* imports, loaded
  lazily. It currently also contains the Mol* molecular-surface adapter.
- `select`: renderer-free selection values and evaluation over table data.
- `fields`: renderer-free field values, CPU evaluation and WGSL generation.
- `geo`: pure geometry kernels and attribution with typed-array inputs/outputs.
- `dynamics`: renderer-free scientific calculations; shader sources use its
  `./wgsl` export. No use.gpu imports.
- `timeline`: scrubbable curves and seconds-based time; pinned use.gpu core math
  is isolated behind `src/internal`.
- `viewer`: Live orchestration, GPU adaptation, resources and representations.
  Workbench, Live and shader runtime imports belong here.

Use public workspace entries across packages. Keep Mol* test oracles in tests.
Do not add packages, a second scene graph, or generic resource frameworks merely
to organize files. Prefer existing contracts and remove duplicated mechanics
when their behavior is proven equivalent.

## Composition and GPU Work

- Ordinary JSX should use molecular values and props. Keep row packing, shader
  bindings, resource owners and revision bookkeeping inside adapters. Advanced
  extension APIs may expose use.gpu types; lower packages must not.
- Coordinate providers preserve topology row count/order, write their own output
  and leave siblings' input untouched. Resolve data from the nearest applicable
  scope. Never substitute root positions for live coordinates implicitly.
- Document each consumer as live or snapshot-based. A generation is local to its
  provider; asynchronous publication must also identify the owner/source and
  layout. Do not use timers as proof that GPU computation has completed.
- Read the installed pinned use.gpu implementation before replacing a primitive.
  Prefer its data/shader/compute machinery where it meets the requirement.
  Record the concrete reason and test for a raw WebGPU exception.
- Give each allocation one clear owner and teardown path. Verify retirement
  against the last draw/dispatch that can reference it. Mount/unmount counters
  alone do not prove correct lifetime during replacement.
- Style changes must not rebuild molecular geometry or upload coordinates. First
  use of a previously unused immutable attribute can require one upload;
  distinguish that from redundant uploads and unsafe buffer destruction.
- CPU scientific references remain useful even when rendering is GPU-driven.
  Preserve units, precision, model/altloc rules, provenance and oracle
  tolerances. Do not replace a scientific algorithm solely for code uniformity.

The review tracks places where current code falls short of these contracts. Do
not silently treat those gaps as accepted behavior or fix unrelated ones.

## Deno, JSR and Verification

Use Deno 2.9+ tasks and TypeScript source, with `.ts` relative imports. Package
`deno.json` files define JSR exports and publish contents; the root defines the
workspace and shared dependency resolution. Keep use.gpu at the reviewed exact
pin. JSR package compatibility must not depend on an assumed npm peer mechanism.

Run checks proportional to the change:

- Pure behavior: relevant `deno test -A ...` tests and type checking.
- Public API: `deno task check:hardening`, reviewed `api.txt` changes,
  README/API updates, and `deno task jsr:check` (dry run only).
- JSX: `deno task typecheck:components`; keep examples using real public
  exports.
- GPU/context/lifetime behavior: the relevant `packages/viewer/test/run-*.mjs`
  browser suite, including uncaptured WebGPU errors and replacement/unmount.
- Before handing off changed files: formatting and lint for their scope.

`deno task test:gpu` runs only `run-browser.mjs`, not every GPU suite.
`run-gate2.mjs` is included in CI; its earlier failure (`molgpu-sept-19s`) is
closed. Do not claim a clean full GPU gate without running its relevant suites.
Distinguish a source-reviewed risk, a reproduced failure, an environment
limitation and a passing check. Do not publish or deploy as part of validation.
