# Library hardening standard (Phase 6)

The acceptance bar for epic `molgpu-sept-x24`. Every `@molgpu/*` package meets
**H1–H7**. The cross-cutting items **X1–X3** are met once, for the whole workspace.
A per-package bead is done when each H-item below is checked for that package
and the shared checks (`npm run check:hardening`) pass for it.

Tests are not introduced here. The golden-file harness and the existing suites
already exist; hardening only requires that they keep passing.

## Per-package criteria

**H1 — Manifest.** `package.json` has: `name`, a semver `version` (the `0.1.0` bump itself happens in X3), `license` (`MIT`),
`description`, `"type": "module"`,
`"sideEffects": false` (or an explicit list), and an `exports` map of the form
`{ ".": { "types", "import" } }`. It has no `private: true`, and `files` is set
to `src` (npm adds README and LICENSE itself; each package
keeps a copy of the root MIT `LICENSE`). Every bare import in `src/` is declared in
`dependencies` or `peerDependencies`. `@use-gpu/*` versions are pinned exactly
(risk R3), and `molstar` is a peer range. A `deno.json` (the JSR manifest)
matches `package.json` in name, version, license, exports and dependency
ranges, as written by `npm run sync:deno`, and publishes `src`.

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
  *advanced*. Anything internal is removed from `index.mjs`. The checker reads
  this from a `## API` section containing a table whose rows start
  `` | `name` | stable | `` (further columns are free-form).
- A committed snapshot, `packages/<pkg>/api.txt`, holds the sorted export names
  and their d.ts signatures. The check fails when the snapshot and the source
  disagree, so an API change always shows up in the diff.
- Public declarations name only types the package exports from some entry. A
  private alias would show up in the generated docs with nothing to link to.

**H6 — Packs and imports cleanly.**
- `npm pack --dry-run` lists only the intended files.
- In a clean temp directory, laying out the packed files as
  `node_modules/@molgpu/<pkg>` and running `import('@molgpu/<pkg>')` succeeds in
  Node. Other dependencies are linked from the workspace root, so this proves
  the tarball and its exports map, not a registry install. `viewer` is
  browser-only, so the checker only resolves its entries. It also needs a
  documented browser smoke page, which is checked by hand.
- `deno publish --dry-run` succeeds for the package: it type-checks, passes
  JSR's no-slow-types rule, and resolves every import as JSR will. Packages
  whose entries are TypeScript are imported under Deno instead of from the
  npm tarball, because Node won't strip types under `node_modules`.
- No import has to reach into `/src/internal`.

**H7 — README.**
- Covers purpose (one paragraph), install, peer dependencies, and a minimal
  runnable example.
- Lists the API with its stability level.
- Notes where the package sits in the dependency graph and what it must not
  import.

## Cross-cutting criteria

**X1 — Shared check tooling.** `npm run check:hardening [pkg]` automates H1–H6
(`--update` rewrites `api.txt`; `--json` for machine output). A per-package bead
is verified by running this script. `npm run test:hardening` proves that each
criterion fails on a deliberately broken copy of `test/hardening/fixture`. The
repo has no CI or remote yet; wiring both scripts into CI is part of X3.

**X2 — Invalidation and resource audit.** The change→work table in
`docs/findings/2026-09-17-architecture-review.md` is enforced by tests, not just
described:
- The viewer exposes dev-only counters for topology builds, geometry builds,
  gathers, allocations, upload bytes and binding updates.
- For each representation (Spacefill, Bonds, BallAndStick, Tube, Ribbon, Surface
  and annotations), a test drives each table row and asserts which counters move.
  A color or opacity edit moves no geometry or position counters.
- Mounting and unmounting a `<Structure>` with every representation N times
  returns the viewer-owned live GPU buffer count to its baseline. After a
  forced GC, no device buffer created during the cycles is still referenced.
  use.gpu 0.20.0 drops some small per-draw buffers without calling destroy();
  the browser frees them on GC, so they don't count as a leak.
- The selection cache stays bounded under churn.
- Any violation found becomes its own bug bead. It is not fixed silently inside
  the audit.

**X3 — Release.**
- CI runs `npm test`, `npm run test:hardening` and `npm run check:hardening`.
- Every package moves to `0.1.0` and gains a top-level `CHANGELOG.md`, managed by
  changesets or a documented manual procedure.
- `repository` (with `directory`) is added once a remote exists.
- `LICENSE` is present, and the upstream attribution for the Mol*-ported `geo`
  code is preserved.
- The docs and examples gallery link to each package README.
- A dry-run publish of the whole workspace succeeds in dependency order.
  Actually publishing to npm is a separate human decision.

Status (2026-09-25): all packages are at `0.1.0` with a `CHANGELOG.md`
(manual procedure in [RELEASING.md](RELEASING.md)). `geo`, `io` and `table`
carry the Mol* MIT notice in `LICENSE`. The root [README](../README.md) and
the examples gallery link every package README. `npm run release:dry-run`
passes in dependency order. `.github/workflows/ci.yml` runs the three scripts
plus the dry-run. Still open until a remote exists: the `repository` fields and
a first green CI run.
