# Library hardening standard (Phase 6)

The acceptance bar for epic `molgpu-sept-x24`. Every `@molgpu/*` package meets
**H1–H7**. The cross-cutting items **X1–X3** are met once, for the whole workspace.
A per-package bead is done when each H-item below is checked for that package
and the shared checks (`npm run check:hardening`) pass for it.

Tests are not introduced here. The golden-file harness and the existing suites
already exist; hardening only requires that they keep passing.

## Per-package criteria

**H1 — Manifest.** `package.json` has: `name`, a real `version`, `license`,
`repository` (with `directory`), `description`, `"type": "module"`,
`"sideEffects": false` (or an explicit list), and an `exports` map of the form
`{ ".": { "types", "import" } }`. It has no `private: true`, and `files` is set
to `src`, README and LICENSE. Every bare import in `src/` is declared in
`dependencies` or `peerDependencies`. `@use-gpu/*` versions are pinned exactly
(risk R3), and `molstar` is a peer range.

**H2 — Types match the runtime.** `src/index.d.ts` exists, and the set of
exported names is identical between `index.mjs` and `index.d.ts`, as checked by
script. It has no `any` in public signatures, except where a comment explains
why.

**H3 — No leaked dependency types.** For every package except `viewer`,
`index.d.ts` (and anything it re-exports) mentions neither `@use-gpu/*` nor
`molstar`. `viewer` may expose use.gpu types only from a separately named
advanced entry (`@molgpu/viewer/advanced`), never from `.`.

**H4 — Import walls.**
- The only package that imports `molstar` at runtime is `io`. Other packages may
  use Mol* only in test oracles, as dev dependencies.
- The only package that imports `@use-gpu/live`, `@use-gpu/workbench` or
  `@use-gpu/shader` is `viewer`.
- A lower package (`geo`, `timeline`) may import `@use-gpu/core` only from
  `src/internal/`. It must re-export what it needs under its own name, not pass
  the upstream binding straight through.

**H5 — Reviewed public API.**
- Each export is classified in the README as *stable*, *experimental* or
  *advanced*. Anything internal is removed from `index.mjs`.
- A committed snapshot, `packages/<pkg>/api.txt`, holds the sorted export names
  and their d.ts signatures. The check fails when the snapshot and the source
  disagree, so an API change always shows up in the diff.

**H6 — Packs and imports cleanly.**
- `npm pack --dry-run` lists only the intended files.
- In a clean temp directory, installing the packed tarball and running
  `import('@molgpu/<pkg>')` succeeds in Node. `viewer` and anything browser-only
  instead get a documented browser smoke page.
- No import has to reach into `/src/internal`.

**H7 — README.**
- Covers purpose (one paragraph), install, peer dependencies, and a minimal
  runnable example.
- Lists the API with its stability level.
- Notes where the package sits in the dependency graph and what it must not
  import.

## Cross-cutting criteria

**X1 — Shared check tooling.** `npm run check:hardening [pkg]` automates H1–H6
and runs in CI next to `npm test`. A per-package bead is verified by running
this script.

**X2 — Invalidation and resource audit.** The change→work table in
`docs/findings/2026-09-17-architecture-review.md` is enforced by tests, not just
described:
- The viewer exposes dev-only counters for topology builds, geometry builds,
  gathers, allocations, upload bytes and binding updates.
- For each representation (Spacefill, Bonds, BallAndStick, Tube, Ribbon, Surface
  and annotations), a test drives each table row and asserts which counters move.
  A color or opacity edit moves no geometry or position counters.
- Mounting and unmounting a `<Structure>` with every representation N times
  returns the live GPU buffer count to its baseline.
- The selection cache stays bounded under churn.
- Any violation found becomes its own bug bead. It is not fixed silently inside
  the audit.

**X3 — Release.**
- Every package moves to `0.1.0` and gains a top-level `CHANGELOG.md`, managed by
  changesets or a documented manual procedure.
- `LICENSE` is present, and the upstream attribution for the Mol*-ported `geo`
  code is preserved.
- The docs and examples gallery link to each package README.
- A dry-run publish of the whole workspace succeeds in dependency order.
  Actually publishing to npm is a separate human decision.
